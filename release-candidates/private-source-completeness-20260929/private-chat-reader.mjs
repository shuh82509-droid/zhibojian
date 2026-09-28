import {createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, rename, open, unlink, rmdir, lstat} from 'node:fs/promises';
import {dirname} from 'node:path';

export const requiredScopes = Object.freeze(['im:chat:read', 'im:message:readonly', 'im:message.p2p_msg:get_as_user', 'offline_access']);
// Feishu's v1 authorize page currently documents PKCE compatibility with v2.
// Keep S256 enabled; do not retry consumed codes at another token endpoint.
const tokenEndpoint = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const userInfoEndpoint = 'https://open.feishu.cn/open-apis/authen/v1/user_info';

export function createPrivateChatReader({appId, appSecret, expectedOpenId, peerOpenId, ownerLabel, redirectUri, storePath, encryptionKey, fetchImpl = fetch, now = Date.now}) {
  // Never log OAuth responses, credentials, or private messages.
  const key = typeof encryptionKey === 'string' && /^[A-Za-z0-9+/]{43}=$/u.test(encryptionKey) ? Buffer.from(encryptionKey, 'base64') : Buffer.alloc(0);
  const configured = [appId, appSecret, peerOpenId, expectedOpenId, redirectUri, storePath]
    .every(value => typeof value === 'string' && value.length > 0)
    && peerOpenId !== expectedOpenId && key.length === 32;
  const pending = new Map();
  const context = Buffer.from(JSON.stringify(['private-chat-v1', appId, expectedOpenId, peerOpenId, requiredScopes]));
  const refreshIntentPath = `${storePath}.refresh-intent.json`;
  const codeIntentPath = `${storePath}.code-intent.json`;
  const lockPath = `${storePath}.lock`;
  const contextSha256 = createHash('sha256').update(context).digest('hex');
  let locallyBlocked = false;
  const safeErrors = new WeakMap();
  const error = (code, message) => {
    const failure = Object.freeze(Object.assign(new Error(message), {code}));
    safeErrors.set(failure, Object.freeze({code, message}));
    return failure;
  };
  const held = () => error('private_chat_authorization_held', '私聊授权处理意图或结果待核验，已停止访问及重复授权，请勿刷新回调页；需独立恢复核验。');
  const busy = () => error('private_chat_authorization_busy', '私聊授权正在处理或上次结果待核验，请勿重复授权。');
  const unavailable = () => error('private_chat_unavailable', '指定私聊暂时无法核验，未自动重试。');
  const publicFailure = cause => {
    const known = cause && typeof cause === 'object' ? safeErrors.get(cause) : null;
    return known ? error(known.code, known.message) : unavailable();
  };
  const safeTimestamp = value => Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000;
  const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const tokenString = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\s\p{Cc}]/u.test(value);
  const scopesValid = value => typeof value === 'string' && value.length <= 4096
    && /^[A-Za-z0-9_:.-]+(?:[ \t\r\n]+[A-Za-z0-9_:.-]+)*$/u.test(value)
    && requiredScopes.every(scope => value.split(/\s+/u).includes(scope));
  const same = (left, right) => {
    if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const encrypt = value => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(context);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({version:2, iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), ciphertext:ciphertext.toString('base64')});
  };
  const decrypt = raw => {
    const item = JSON.parse(raw);
    if (item.version !== 2) throw error('private_chat_store_invalid', '私聊授权存储格式不可识别，请重新授权。');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(item.iv, 'base64'));
    decipher.setAAD(context);
    decipher.setAuthTag(Buffer.from(item.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(item.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  };
  function validStoredGrant(record) {
    return plainObject(record) && typeof record.openId === 'string' && same(record.openId, expectedOpenId)
      && tokenString(record.accessToken) && tokenString(record.refreshToken)
      && safeTimestamp(record.accessExpiresAt) && safeTimestamp(record.refreshExpiresAt)
      && scopesValid(record.scopes)
      && (record.verifiedAt === undefined || (typeof record.verifiedAt === 'string'
        && safeTimestamp(Date.parse(record.verifiedAt)) && new Date(record.verifiedAt).toISOString() === record.verifiedAt));
  }
  async function pathInfo(path) {
    try { return await lstat(path); }
    catch (cause) { if (cause?.code === 'ENOENT') return null; throw held(); }
  }
  async function assertAvailable({insideLock = false} = {}) {
    if (locallyBlocked || await pathInfo(codeIntentPath) || await pathInfo(refreshIntentPath)) throw held();
    if (!insideLock) {
      const lock = await pathInfo(lockPath);
      if (lock) {
        if (lock.isSymbolicLink() || !lock.isDirectory()) throw held();
        throw busy();
      }
    }
  }
  async function syncDirectory() {
    // A Windows-only fixture is not a Linux durability acceptance result.
    if (process.platform !== 'win32') {
      const directory = await open(dirname(storePath), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  }
  function validIntent(value, kind) {
    const fields = ['schemaVersion', 'kind', 'contextSha256', 'attemptId', 'createdAt'];
    return plainObject(value) && Object.keys(value).length === fields.length
      && fields.every(field => Object.hasOwn(value, field)) && value.schemaVersion === 1
      && value.kind === kind && value.contextSha256 === contextSha256
      && typeof value.attemptId === 'string' && /^[a-f0-9]{32}$/u.test(value.attemptId)
      && typeof value.createdAt === 'string' && safeTimestamp(Date.parse(value.createdAt))
      && new Date(value.createdAt).toISOString() === value.createdAt;
  }
  async function readOwnIntent(path, expected) {
    try {
      const info = await pathInfo(path);
      if (!info || info.isSymbolicLink() || !info.isFile()) throw held();
      const raw = await readFile(path, 'utf8');
      if (typeof raw !== 'string' || raw.length > 1024 || raw !== JSON.stringify(expected)
          || !validIntent(JSON.parse(raw), expected.kind)) throw held();
      return expected;
    } catch { throw held(); }
  }
  async function writeIntent(path, intent) {
    const temp = `${path}.${intent.attemptId}.tmp`;
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(intent), 'utf8'); await file.sync(); }
    finally { await file.close(); }
    await rename(temp, path);
    await syncDirectory();
    await readOwnIntent(path, intent);
  }
  async function persistIntent(control, kind) {
    const timestamp = now();
    if (!safeTimestamp(timestamp)) throw held();
    control.intentPath = kind === 'private_chat_refresh_intent' ? refreshIntentPath : codeIntentPath;
    control.intent = {schemaVersion:1, kind, contextSha256, attemptId:randomBytes(16).toString('hex'),
      createdAt:new Date(timestamp).toISOString()};
    // Before any one-use POST, persist a no-secret intent and read it back.
    // Uncertain preparation also preserves the exclusive lock.
    control.risk = true;
    try { await writeIntent(control.intentPath, control.intent); }
    catch { locallyBlocked = true; throw held(); }
  }
  async function clearIntent(control) {
    await readOwnIntent(control.intentPath, control.intent);
    await unlink(control.intentPath);
    await syncDirectory();
    // Keep the exclusive lock as the last anchor through unlink/fsync.
    control.risk = false;
  }
  async function load() {
    if (!configured) return null;
    try {
      const info = await lstat(storePath);
      if (info.isSymbolicLink() || !info.isFile()) throw held();
      const record = decrypt(await readFile(storePath, 'utf8'));
      if (!validStoredGrant(record)) throw error('private_chat_store_invalid', '指定私聊授权存储无法核验，已停止访问。');
      return record;
    }
    catch (cause) {
      if (cause?.code === 'ENOENT') return null;
      throw error('private_chat_store_unreadable', '指定私聊授权无法读取，已停止私聊访问。');
    }
  }
  async function save(value) {
    await mkdir(dirname(storePath), {recursive:true, mode:0o700});
    const temp = `${storePath}.${randomBytes(8).toString('hex')}.tmp`;
    let created = false, renamed = false;
    const encrypted = encrypt(value);
    try {
      const file = await open(temp, 'wx', 0o600);
      created = true;
      try {
        await file.writeFile(encrypted, 'utf8');
        await file.sync();
      } finally { await file.close(); }
      await rename(temp, storePath);
      renamed = true;
      // Refresh tokens rotate after one use. Do not return the new access token
      // until both the encrypted file and its rename are durable on Linux.
      await syncDirectory();
      const readback = await readFile(storePath, 'utf8');
      if (readback !== encrypted || JSON.stringify(await load()) !== JSON.stringify(value)) throw held();
    } catch (cause) {
      if (created && !renamed) {
        try { await unlink(temp); }
        catch { /* Keep the original error; no API read may follow. */ }
      }
      throw cause;
    }
  }
  // Never steal a stale lock: a crashed refresh may already have rotated the
  // one-use refresh token. Recovery must verify the original credential first.
  async function exclusive(operation) {
    if (!configured) throw error('private_chat_auth_not_configured', '指定私聊的用户授权尚未配置。');
    await assertAvailable();
    await mkdir(dirname(storePath), {recursive:true, mode:0o700});
    try { await mkdir(lockPath, {mode:0o700}); }
    catch {
      // A concurrent caller may have entered a durable hold after our preflight.
      await assertAvailable();
      throw busy();
    }
    const control = {risk:false, intent:null, intentPath:null};
    try {
      // A crash before a POST still leaves a durable, non-stealable lock.
      control.risk = true;
      await syncDirectory();
      control.risk = false;
      await assertAvailable({insideLock:true});
      return await operation(control);
    } catch (cause) {
      if (control.risk) { locallyBlocked = true; throw held(); }
      throw publicFailure(cause);
    } finally {
      if (!control.risk) {
        try { await rmdir(lockPath); await syncDirectory(); }
        catch {
          locallyBlocked = true;
          // If cleanup removed an anchor before reporting failure, restore a
          // no-secret hold best-effort. Persistent disk faults need independent
          // recovery; never automatically clear or steal a lock/intent.
          try {
            if (!await pathInfo(lockPath)) await mkdir(lockPath, {mode:0o700});
            if (control.intent) await writeIntent(control.intentPath, control.intent);
            else await syncDirectory();
          } catch { /* Local quarantine remains even if disk repair fails. */ }
          throw held();
        }
      }
    }
  }
  function statusFrom(record) {
    if (!configured) return {configured:false, authorized:false, status:'unconfigured', recoveryRequired:false, retryAllowed:false, reason:'私聊用户授权配置不完整'};
    const timestamp = now();
    const authorized = validStoredGrant(record) && safeTimestamp(timestamp) && record.refreshExpiresAt > timestamp;
    return {configured:true, authorized:Boolean(authorized), status:authorized ? 'authorized' : 'unauthorized',
      recoveryRequired:false, retryAllowed:true, ...(authorized ? {} : {reason:'等待指定本人完成有效飞书用户授权'})};
  }
  async function status() {
    if (!configured) return statusFrom(null);
    try {
      await assertAvailable();
      const record = await load();
      await assertAvailable();
      return statusFrom(record);
    } catch (cause) {
      const code = cause && typeof cause === 'object' ? safeErrors.get(cause)?.code : null;
      if (code === 'private_chat_authorization_busy') return {configured:true, authorized:false,
        status:'busy', recoveryRequired:false, retryAllowed:false, reason:busy().message};
      // Unreadable grants/barriers are not a trustworthy permission to retry.
      return {configured:true, authorized:false, status:'recovery_required', recoveryRequired:true,
        retryAllowed:false, reason:held().message};
    }
  }
  function begin() {
    if (!configured) throw error('private_chat_auth_not_configured', '私聊用户授权尚未配置。');
    if (locallyBlocked) throw held();
    let redirect;
    try { redirect = new URL(redirectUri); } catch { throw error('private_chat_redirect_invalid', '正式私聊授权回调必须使用固定 HTTPS 地址。'); }
    if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.hash || redirect.search) throw error('private_chat_redirect_invalid', '正式私聊授权回调必须使用固定 HTTPS 地址。');
    const state = 'pchat_' + randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const createdAt = now();
    if (!safeTimestamp(createdAt)) throw error('private_chat_oauth_state_invalid', '私聊授权安全时钟无法核验，未发起请求。');
    for (const [id, value] of pending) if (createdAt - value.createdAt > 600_000) pending.delete(id);
    pending.set(state, {verifier, challenge, createdAt});
    const url = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
    for (const [name, value] of Object.entries({client_id:appId,response_type:'code',redirect_uri:redirectUri,scope:requiredScopes.join(' '),state,code_challenge:challenge,code_challenge_method:'S256'})) url.searchParams.set(name, value);
    return {url:url.toString(), state};
  }
  async function tokenRequest(body) {
    // The documented v2 endpoint expects JSON, including the original verifier.
    const requestBody = {client_id:appId,client_secret:appSecret,...body};
    const response = await fetchImpl(tokenEndpoint, {method:'POST',redirect:'error',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(requestBody),signal:AbortSignal.timeout(12_000)});
    const data = await response.json();
    if (response.ok !== true || !plainObject(data) || data.code !== 0
        || !tokenString(data.access_token) || !tokenString(data.refresh_token))
      throw error('private_chat_oauth_exchange_failed', '飞书私聊授权交换未能完整核验，未自动重试或发起其他交换。');
    if (!scopesValid(data.scope)) throw error('private_chat_scope_missing', '飞书私聊授权未包含所需的只读与离线权限。');
    const timestamp = now();
    if (!safeTimestamp(timestamp) || ![data.expires_in, data.refresh_token_expires_in]
      .every(value => Number.isSafeInteger(value) && value > 0 && safeTimestamp(timestamp + value * 1000)))
      throw error('private_chat_token_expiry_invalid', '私聊授权有效期无法核验，凭据未保存。');
    return data;
  }
  async function getUserInfo(accessToken) {
    const response = await fetchImpl(userInfoEndpoint, {redirect:'error',headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(12_000)});
    const data = await response.json();
    if (response.ok !== true || !plainObject(data) || data.code !== 0
        || !plainObject(data.data) || !tokenString(data.data.open_id))
      throw error('private_chat_identity_unverified', '无法核验私聊授权用户身份。');
    return data.data.open_id;
  }
  async function api(accessToken, path, body) {
    let response, data;
    try {
      response = await fetchImpl('https://open.feishu.cn/open-apis'+path, {
        method:body ? 'POST' : 'GET', redirect:'error',
        headers:{Authorization:'Bearer '+accessToken, ...(body ? {'Content-Type':'application/json'} : {})},
        ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(12000),
      });
      data = await response.json();
    } catch { throw error('private_chat_unavailable','飞书会话核验暂时失败，请稍后重试。'); }
    if (response.ok !== true || !plainObject(data) || data.code !== 0) {
      const code = Number.isSafeInteger(data.code) ? data.code : null;
      const reason = code === 231204 ? '应用开启了对外共享或关联组织，不支持以用户身份读取消息。'
        : code === 231203 ? '该会话设置不支持读取消息。'
        : [230027,99991672,99991679].includes(code) ? '请管理员核对用户身份的单聊、消息和会话读取权限，并由本人重新授权。'
        : code === 230013 ? '请管理员核对两位当事人是否在应用可用范围内。'
        : '指定私聊暂时无法读取，请核对应用权限和本人授权。';
      throw error('private_chat_access_failed', reason+(code===null?'':`（飞书错误码 ${code}）`));
    }
    return data.data || {};
  }
  async function verifyPair(accessToken) {
    // Protocol follows the official larksuite/cli resolveP2PChatID helper.
    // Neither participant nor chat ID is accepted from a browser request.
    const found = await api(accessToken, '/im/v1/chat_p2p/batch_query?chatter_id_type=open_id', {chatter_ids:[peerOpenId]});
    const chats = found.p2p_chats;
    if (!Array.isArray(chats) || chats.length !== 1 || !/^oc_[A-Za-z0-9]+$/.test(chats[0]?.chat_id || '')
        || (chats[0].chatter_id && chats[0].chatter_id !== peerOpenId))
      throw error('private_chat_pair_unverified','未找到两位当事人之间唯一的私聊，未保存新授权。');
    const chatId = chats[0].chat_id;
    const end = Math.floor(now()/1000), start=end-7*86400;
    const query = new URLSearchParams({container_id_type:'chat',container_id:chatId,start_time:String(start),end_time:String(end),page_size:'1',sort_type:'ByCreateTimeDesc'});
    const page = await api(accessToken, '/im/v1/messages?'+query);
    if (!Array.isArray(page.items) || page.items.some(item=>item.chat_id!==chatId ||
        (item.sender?.sender_type==='user' && ![expectedOpenId,peerOpenId].includes(item.sender.id))))
      throw error('private_chat_pair_unverified','返回消息的会话或参与人不匹配，已停止核验。');
    // Inspect permission only. Do not retain or return message content.
    return {verified:true,verifiedAt:new Date(now()).toISOString(),sampleAvailable:page.items.length>0};
  }
  function recordFrom(data, openId) {
    const timestamp = now();
    const record = {openId, accessToken:data.access_token, accessExpiresAt:timestamp + data.expires_in * 1000,
      refreshToken:data.refresh_token, refreshExpiresAt:timestamp + data.refresh_token_expires_in * 1000, scopes:data.scope};
    if (!safeTimestamp(timestamp) || !validStoredGrant(record)) throw error('private_chat_token_expiry_invalid', '私聊授权凭据无法核验，未保存。');
    return record;
  }
  async function complete({code, state, cookieState}) {
    const attempt = pending.get(state);
    pending.delete(state);
    const timestamp = now();
    if (!attempt || !safeTimestamp(timestamp) || timestamp < attempt.createdAt
        || timestamp - attempt.createdAt > 600_000 || !same(state, cookieState) || !tokenString(code) || code.length > 2048)
      throw error('private_chat_oauth_state_invalid', '私聊授权校验失败或已过期，未提交交换请求。');
    if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(attempt.verifier) || !same(createHash('sha256').update(attempt.verifier).digest('base64url'),attempt.challenge)) throw error('private_chat_pkce_local_invalid','私聊授权安全参数校验失败，未提交凭据请求。');
    return exclusive(async control => {
    await load(); // Never overwrite an unreadable old grant as implicit recovery.
    await persistIntent(control, 'private_chat_code_exchange_intent');
    const beforePost = now();
    if (!safeTimestamp(beforePost) || beforePost < timestamp || beforePost - attempt.createdAt > 600_000)
      throw held();
    const data = await tokenRequest({grant_type:'authorization_code',code,redirect_uri:redirectUri,code_verifier:attempt.verifier,scope:requiredScopes.join(' ')});
    const openId = await getUserInfo(data.access_token);
    if (!same(openId, expectedOpenId)) throw error('private_chat_oauth_wrong_user', `授权账号不是指定的${ownerLabel}账号，凭据未保存。`);
    const verification = await verifyPair(data.access_token);
    const record = {...recordFrom(data, openId),verifiedAt:verification.verifiedAt};
    await save(record);
    await clearIntent(control);
    return statusFrom(record);
    });
  }
  async function accessToken(control) {
    if (!configured) throw error('private_chat_auth_not_configured', '指定私聊的用户授权尚未配置。');
    await assertAvailable({insideLock:true});
    const record = await load();
    const timestamp = now();
    if (!validStoredGrant(record) || !safeTimestamp(timestamp) || record.refreshExpiresAt <= timestamp)
      throw error('private_chat_authorization_required', '指定私聊需本人有效授权。');
    if (record.accessExpiresAt > timestamp + 300_000) return record.accessToken;
    await persistIntent(control, 'private_chat_refresh_intent');
    const beforePost = now();
    if (!safeTimestamp(beforePost) || beforePost < timestamp || record.refreshExpiresAt <= beforePost)
      throw held();
    const data = await tokenRequest({grant_type:'refresh_token',refresh_token:record.refreshToken,scope:requiredScopes.join(' ')});
    const openId = await getUserInfo(data.access_token);
    if (!same(openId, expectedOpenId)) throw error('private_chat_oauth_wrong_user', '续期返回的授权账号不是指定本人，凭据未保存。');
    const rotated = {...recordFrom(data, openId), ...(record.verifiedAt === undefined ? {} : {verifiedAt:record.verifiedAt})};
    await save(rotated);
    await clearIntent(control);
    return rotated.accessToken;
  }
  async function verify() {
    return exclusive(async control => verifyPair(await accessToken(control)));
  }
  async function readMessages({startTime,endTime}) {
    if(!Number.isSafeInteger(startTime)||!Number.isSafeInteger(endTime)||startTime<=0||endTime<startTime||endTime-startTime>120*86400||endTime>Math.floor(now()/1000)+60)
      throw error('private_chat_range_invalid','仅允许读取最近120天内指定时间段的考核消息。');
    // Request times are seconds; provider create_time is a decimal millisecond
    // string. Include the entire requested final second, never adjacent seconds.
    const startMs = startTime * 1000, endExclusiveMs = (endTime + 1) * 1000;
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endExclusiveMs))
      throw error('private_chat_range_invalid', '考核消息时间范围无法核验。');
    return exclusive(async control => {
    const token=await accessToken(control);
    const found=await api(token,'/im/v1/chat_p2p/batch_query?chatter_id_type=open_id',{chatter_ids:[peerOpenId]});
    const chats=found.p2p_chats;
    if(!Array.isArray(chats)||chats.length!==1||!plainObject(chats[0])
        ||typeof chats[0].chat_id!=='string'||!/^oc_[A-Za-z0-9]+$/u.test(chats[0].chat_id)
        ||chats[0].chatter_id!==peerOpenId)
      throw error('private_chat_pair_unverified','指定双人会话无法唯一核验。');
    const chatId=chats[0].chat_id;
    const query=new URLSearchParams({container_id_type:'chat',container_id:chatId,start_time:String(startTime),end_time:String(endTime),page_size:'50',sort_type:'ByCreateTimeAsc'});
    const items=[],seen=new Map(),cursors=new Set();
    let lastCreateTime = null;
    // Structural fingerprints compare all JSON fields without depending on
    // object key order. Conflicting repeated IDs are not silently discarded.
    const stable = value => Array.isArray(value) ? value.map(stable)
      : plainObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
    for(let page=0;page<100;page++){
      const result=await api(token,'/im/v1/messages?'+query);
      if(!plainObject(result)||!Array.isArray(result.items)||result.items.length>50
          ||typeof result.has_more!=='boolean')
        throw error('private_chat_incomplete','消息列表或分页状态无法核验。');
      if(result.has_more&&(typeof result.page_token!=='string'||result.page_token.trim().length===0
          ||/\p{Cc}/u.test(result.page_token)||cursors.has(result.page_token)))
        throw error('private_chat_incomplete','消息分页未完成。');
      if(result.has_more===false&&Object.hasOwn(result,'page_token')&&result.page_token!=='')
        throw error('private_chat_incomplete','消息终页分页状态不一致。');
      for(const item of result.items){
        if(!plainObject(item)||item.chat_id!==chatId||!plainObject(item.sender)
            ||item.sender.sender_type!=='user'||item.sender.id_type!=='open_id'
            ||![expectedOpenId,peerOpenId].includes(item.sender.id))
          throw error('private_chat_pair_unverified','消息参与人无法核验，考核来源待核验。');
        if(typeof item.message_id!=='string'||!/^om_[A-Za-z0-9_-]+$/u.test(item.message_id)
            ||typeof item.create_time!=='string'||!/^[1-9][0-9]*$/u.test(item.create_time)
            ||typeof item.deleted!=='boolean'||typeof item.updated!=='boolean'
            ||typeof item.msg_type!=='string'||item.msg_type.length===0
            ||!plainObject(item.body)||typeof item.body.content!=='string')
          throw error('private_chat_incomplete','消息标识、时间或内容状态无法核验。');
        const created = Number(item.create_time);
        if(!Number.isSafeInteger(created)||created<startMs||created>=endExclusiveMs)
          throw error('private_chat_incomplete','消息超出请求时间范围，考核来源待核验。');
        // chat-container listing only returns thread roots. Do not pretend to
        // have read a complete discussion or silently expand the approved read.
        if(Object.hasOwn(item,'thread_id')&&item.thread_id!=='')
          throw error('private_chat_incomplete','消息含未完整读取的话题，考核来源待核验。');
        const fingerprint = createHash('sha256').update(JSON.stringify(stable(item))).digest('hex');
        if(seen.has(item.message_id)) {
          if(seen.get(item.message_id)!==fingerprint)
            throw error('private_chat_incomplete','同一消息的分页内容发生变化，考核来源待核验。');
        } else {
          if(lastCreateTime!==null&&created<lastCreateTime)
            throw error('private_chat_incomplete','消息分页时间顺序无法核验。');
          lastCreateTime=created;seen.set(item.message_id,fingerprint);items.push(item);
        }
      }
      if(result.has_more===false)return {items,complete:true};
      cursors.add(result.page_token);query.set('page_token',result.page_token);
    }
    throw error('private_chat_incomplete','消息超过本次完整读取上限，考核统计待核验。');
    });
  }
  return {status, begin, complete, verify, readMessages};
}
