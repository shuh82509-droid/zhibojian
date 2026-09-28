import {createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, rename, open, unlink, rmdir} from 'node:fs/promises';
import {dirname} from 'node:path';

export const requiredScopes = ['im:chat:read', 'im:message:readonly', 'im:message.p2p_msg:get_as_user', 'offline_access'];
// Feishu's v1 authorize page currently documents PKCE compatibility with v2.
// Keep S256 enabled; do not retry consumed codes at another token endpoint.
const tokenEndpoint = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const userInfoEndpoint = 'https://open.feishu.cn/open-apis/authen/v1/user_info';

export function createPrivateChatReader({appId, appSecret, expectedOpenId, peerOpenId, ownerLabel, redirectUri, storePath, encryptionKey, fetchImpl = fetch, now = Date.now}) {
  const diagnostic = () => {}; // Never log OAuth responses or private messages.
  const key = /^[A-Za-z0-9+/]{43}=$/u.test(encryptionKey || '') ? Buffer.from(encryptionKey, 'base64') : Buffer.alloc(0);
  const configured = Boolean(appId && appSecret && peerOpenId && expectedOpenId && peerOpenId !== expectedOpenId && redirectUri && storePath && key.length === 32);
  const pending = new Map();
  const context = Buffer.from(JSON.stringify(['private-chat-v1', appId, expectedOpenId, peerOpenId, requiredScopes]));
  let refreshInFlight = null;
  const error = (code, message) => Object.assign(new Error(message), {code});
  const same = (left, right) => {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
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
  async function load() {
    if (!configured) return null;
    try { return decrypt(await readFile(storePath, 'utf8')); }
    catch (cause) {
      if (cause?.code === 'ENOENT') return null;
      throw error('private_chat_store_unreadable', '指定私聊授权无法读取，已停止私聊访问。');
    }
  }
  async function save(value) {
    await mkdir(dirname(storePath), {recursive:true, mode:0o700});
    const temp = `${storePath}.${randomBytes(8).toString('hex')}.tmp`;
    let created = false, renamed = false;
    try {
      const file = await open(temp, 'wx', 0o600);
      created = true;
      try {
        await file.writeFile(encrypt(value), 'utf8');
        await file.sync();
      } finally { await file.close(); }
      await rename(temp, storePath);
      renamed = true;
      // Refresh tokens rotate after one use. Do not return the new access token
      // until both the encrypted file and its rename are durable on Linux.
      if (process.platform !== 'win32') {
        const directory = await open(dirname(storePath), 'r');
        try { await directory.sync(); }
        finally { await directory.close(); }
      }
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
    await mkdir(dirname(storePath), {recursive:true, mode:0o700});
    const lock = `${storePath}.lock`;
    try { await mkdir(lock, {mode:0o700}); }
    catch { throw error('private_chat_authorization_busy', '私聊授权正在处理或上次结果待核验，请勿重复授权。'); }
    try { return await operation(); } finally { await rmdir(lock); }
  }
  function statusFrom(record) {
    if (!configured) return {configured:false, authorized:false, reason:'私聊用户授权配置不完整'};
    if (!record) return {configured:true, authorized:false, reason:`等待${ownerLabel}完成飞书用户授权`};
    const authorized = same(record.openId, expectedOpenId) && record.refreshExpiresAt > now() && requiredScopes.every(s => String(record.scopes).split(/\s+/u).includes(s));
    return {configured:true, authorized, verifiedAt:record.verifiedAt || null, ...(authorized ? {} : {reason:`${ownerLabel}用户授权已过期或账号不匹配`}), openId:record.openId, refreshExpiresAt:record.refreshExpiresAt};
  }
  async function status() { return statusFrom(await load()); }
  function begin() {
    if (!configured) throw error('private_chat_auth_not_configured', '私聊用户授权尚未配置。');
    const redirect = new URL(redirectUri);
    if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.hash || redirect.search) throw error('private_chat_redirect_invalid', '正式私聊授权回调必须使用固定 HTTPS 地址。');
    const state = 'pchat_' + randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const createdAt = now();
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
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0 || !data.access_token || !data.refresh_token) {
      // Never expose the response body, authorization code, verifier, or tokens.
      const upstreamCode = Number.isSafeInteger(data.code) ? data.code : null;
      const rawId = response.headers?.get?.('x-tt-logid') || '';
      const requestId = /^[A-Za-z0-9_-]{1,96}$/u.test(rawId) ? rawId : null;
      const detail = {stage:'token_exchange',grant:body.grant_type === 'refresh_token' ? 'refresh_token' : 'authorization_code',encoding:'json',httpStatus:response.status,upstreamCode,requestId,hasAccessToken:Boolean(data.access_token),hasRefreshToken:Boolean(data.refresh_token),...(body.grant_type === 'authorization_code' ? {pkceMethod:'S256',verifierLength:body.code_verifier.length,pkceLocallyVerified:true} : {})};
      diagnostic(detail);
      const hints = {20002:'应用凭据校验失败',20003:'授权码无效或已使用',20004:'授权码已过期',20049:'PKCE 安全校验未通过',20065:'授权码已使用',20068:'授权范围不匹配',20071:'回调地址不匹配'};
      const hint = hints[upstreamCode] || (!data.refresh_token && data.access_token ? '未返回可续期的只读授权' : '授权接口返回异常');
      throw Object.assign(error('private_chat_oauth_exchange_failed', `飞书私聊授权换取失败：${hint}${upstreamCode === null ? '' : `（飞书错误码 ${upstreamCode}）`}。请勿刷新回调页，请返回中枢重新发起。`), {diagnostic:detail});
    }
    const scopes = String(data.scope || '').split(/\s+/u).filter(Boolean);
    if (!requiredScopes.every(scope => scopes.includes(scope))) throw error('private_chat_scope_missing', '飞书私聊授权未包含所需的只读与离线权限。');
    if (![data.expires_in, data.refresh_token_expires_in].every(v => Number.isFinite(Number(v)) && Number(v) > 0)) throw error('private_chat_token_expiry_invalid', '私聊授权有效期无法核验，凭据未保存。');
    return data;
  }
  async function getUserInfo(accessToken) {
    const response = await fetchImpl(userInfoEndpoint, {redirect:'error',headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(12_000)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0 || !data.data?.open_id) throw error('private_chat_identity_unverified', '无法核验私聊授权用户身份。');
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
    if (!response.ok || data.code !== 0) {
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
    return {openId, accessToken:data.access_token, accessExpiresAt:now() + Number(data.expires_in || 0) * 1000,
      refreshToken:data.refresh_token, refreshExpiresAt:now() + Number(data.refresh_token_expires_in || 0) * 1000,
      scopes:String(data.scope || '')};
  }
  async function complete({code, state, cookieState}) {
    const attempt = pending.get(state);
    pending.delete(state);
    if (!attempt || now() - attempt.createdAt > 600_000 || !same(state, cookieState) || !code) throw error('private_chat_oauth_state_invalid', '私聊授权校验失败或已过期，请重新发起。');
    if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(attempt.verifier) || !same(createHash('sha256').update(attempt.verifier).digest('base64url'),attempt.challenge)) throw error('private_chat_pkce_local_invalid','私聊授权安全参数校验失败，未提交凭据请求。');
    return exclusive(async () => {
    const data = await tokenRequest({grant_type:'authorization_code',code,redirect_uri:redirectUri,code_verifier:attempt.verifier,scope:requiredScopes.join(' ')});
    const openId = await getUserInfo(data.access_token);
    if (!same(openId, expectedOpenId)) throw error('private_chat_oauth_wrong_user', `授权账号不是指定的${ownerLabel}账号，凭据未保存。`);
    const verification = await verifyPair(data.access_token);
    await save({...recordFrom(data, openId),verifiedAt:verification.verifiedAt});
    return status();
    });
  }
  async function accessToken() {
    if (!configured) throw error('private_chat_auth_not_configured', '指定私聊的用户授权尚未配置。');
    const record = await load();
    if (!record || !same(record.openId, expectedOpenId) || record.refreshExpiresAt <= now()) throw error('private_chat_authorization_required', `${ownerLabel}私聊需本人重新授权。`);
    if (record.accessExpiresAt > now() + 300_000) return record.accessToken;
    if (!refreshInFlight) refreshInFlight = exclusive(async () => {
      const latest = await load();
      if (latest?.accessExpiresAt > now() + 300_000) return latest.accessToken;
      if (!latest?.refreshToken || latest.refreshExpiresAt <= now()) throw error('private_chat_authorization_required', '指定私聊授权已过期。');
      const data = await tokenRequest({grant_type:'refresh_token',refresh_token:latest.refreshToken,scope:requiredScopes.join(' ')});
      const rotated = {...recordFrom(data, latest.openId), verifiedAt:latest.verifiedAt};
      await save(rotated);
      return rotated.accessToken;
    }).finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }
  async function verify() {
    const result = await verifyPair(await accessToken());
    return result;
  }
  async function readMessages({startTime,endTime}) {
    if(!Number.isSafeInteger(startTime)||!Number.isSafeInteger(endTime)||startTime<=0||endTime<startTime||endTime-startTime>120*86400||endTime>Math.floor(now()/1000)+60)
      throw error('private_chat_range_invalid','仅允许读取最近120天内指定时间段的考核消息。');
    const token=await accessToken();
    const found=await api(token,'/im/v1/chat_p2p/batch_query?chatter_id_type=open_id',{chatter_ids:[peerOpenId]});
    const chats=found.p2p_chats;
    if(!Array.isArray(chats)||chats.length!==1||!/^oc_[A-Za-z0-9]+$/.test(chats[0]?.chat_id||'')||(chats[0].chatter_id&&chats[0].chatter_id!==peerOpenId))
      throw error('private_chat_pair_unverified','指定双人会话无法唯一核验。');
    const chatId=chats[0].chat_id;
    const query=new URLSearchParams({container_id_type:'chat',container_id:chatId,start_time:String(startTime),end_time:String(endTime),page_size:'50',sort_type:'ByCreateTimeAsc'});
    const items=[],seen=new Set(),cursors=new Set();
    for(let page=0;page<100;page++){
      const result=await api(token,'/im/v1/messages?'+query);
      if(!Array.isArray(result.items))throw error('private_chat_incomplete','消息列表无法核验。');
      for(const item of result.items){
        if(item.chat_id!==chatId||(item.sender?.sender_type==='user'&&![expectedOpenId,peerOpenId].includes(item.sender.id)))throw error('private_chat_pair_unverified','消息参与人不匹配。');
        if(!seen.has(item.message_id)){seen.add(item.message_id);items.push(item)}
      }
      if(!result.has_more)return {items,complete:true};
      if(!result.page_token||cursors.has(result.page_token))throw error('private_chat_incomplete','消息分页未完成。');
      cursors.add(result.page_token);query.set('page_token',result.page_token);
    }
    throw error('private_chat_incomplete','消息超过本次完整读取上限，考核统计待核验。');
  }
  return {status, begin, complete, verify, readMessages};
}
