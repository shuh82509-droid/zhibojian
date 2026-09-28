import {createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, rename, open, unlink, rmdir, stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {buildNativeCalendarRequest} from './native-calendar-source.mjs';

const requiredScopes = ['calendar:calendar:read', 'calendar:calendar.event:read', 'offline_access'];
// Feishu's authorize-v1 PKCE contract explicitly pairs with token v2.
// Refreshes retain v3; a rejected code exchange is never retried or downgraded.
const codeTokenEndpoint = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const refreshTokenEndpoint = 'https://accounts.feishu.cn/oauth/v3/token';
const userInfoEndpoint = 'https://open.feishu.cn/open-apis/authen/v1/user_info';
const readerFileSystem = Object.freeze({mkdir, readFile, rename, open, unlink, rmdir, stat});

export function createCalendarUserReader({appId, appSecret, calendarId, additionalCalendarIds = [], expectedOpenId, ownerLabel = '舒豪', requireOwnPrimaryCalendar = false, allowInstanceView = false, allowNativeSource = false, redirectUri, storePath, encryptionKey, fetchImpl = fetch, now = Date.now, diagnostic = item => console.warn('[calendar-oauth]', JSON.stringify(item)), fsImpl = readerFileSystem, directorySyncImpl = null}) {
  // Injection is only for isolated filesystem fault fixtures; runtime defaults
  // remain the same approved store and native filesystem, not a recovery API.
  const {mkdir, readFile, rename, open, unlink, rmdir, stat} = fsImpl;
  const key = /^[A-Za-z0-9+/]{43}=$/u.test(encryptionKey || '') ? Buffer.from(encryptionKey, 'base64') : Buffer.alloc(0);
  const configured = Boolean(appId && appSecret && calendarId && expectedOpenId && redirectUri && storePath && key.length === 32);
  const pending = new Map();
  const context = Buffer.from(JSON.stringify([appId, calendarId, expectedOpenId]));
  const permittedCalendars = new Set([calendarId, ...(Array.isArray(additionalCalendarIds) ? additionalCalendarIds : [])].filter(value => typeof value === 'string' && /^[A-Za-z0-9_@.\-]{3,256}$/u.test(value)));
  const refreshHoldPath = `${storePath}.refresh-hold.json`;
  const operationLockPath = `${storePath}.lock`;
  const contextSha256 = createHash('sha256').update(context).digest('hex');
  let locallyBlocked = false;
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
    if (item.version !== 2) throw error('calendar_store_invalid', '日历授权存储格式不可识别，请重新授权。');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(item.iv, 'base64'));
    decipher.setAAD(context);
    decipher.setAuthTag(Buffer.from(item.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(item.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  };
  const recoveryRequired = () => error('calendar_refresh_recovery_required', '日历续期意图或上次处理结果待核验，已停止访问与自动重试；需独立恢复核验。');
  const safeTimestamp = value => Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000;
  const tokenString = value => typeof value === 'string' && value.length > 0 && value.trim() === value && !/[\s\p{Cc}]/u.test(value);
  function validStoredGrant(record) {
    return record && typeof record.openId === 'string' && same(record.openId,expectedOpenId)
      && tokenString(record.accessToken) && tokenString(record.refreshToken)
      && safeTimestamp(record.accessExpiresAt) && safeTimestamp(record.refreshExpiresAt)
      && typeof record.scopes === 'string' && requiredScopes.every(scope=>record.scopes.split(/\s+/u).includes(scope));
  }
  function sameStoredGrant(actual,expected) {
    const fields = ['openId','accessToken','accessExpiresAt','refreshToken','refreshExpiresAt','scopes'];
    return validStoredGrant(actual) && validStoredGrant(expected)
      && Object.keys(actual).length === fields.length && Object.keys(expected).length === fields.length
      && fields.every(field=>Object.hasOwn(actual,field) && Object.hasOwn(expected,field) && actual[field] === expected[field]);
  }
  async function exists(path) {
    try { await stat(path); return true; }
    catch (cause) { if (cause?.code === 'ENOENT') return false; throw recoveryRequired(); }
  }
  async function assertNoRefreshHold({insideLock = false} = {}) {
    if (locallyBlocked || await exists(refreshHoldPath)) throw recoveryRequired();
    if (!insideLock && await exists(operationLockPath))
      throw error('calendar_authorization_busy', '日历授权正在处理或上次结果待核验，请勿重复授权。');
  }
  async function syncDirectory(path) {
    if (directorySyncImpl) return directorySyncImpl(path);
    if (process.platform !== 'win32') {
      const directory = await open(path, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  }
  function validRefreshIntent(item) {
    const keys = ['schemaVersion','kind','contextSha256','attemptId','createdAt'];
    return item && typeof item === 'object' && !Array.isArray(item)
      && Object.keys(item).length === keys.length && keys.every(name => Object.hasOwn(item,name))
      && item.schemaVersion === 1 && item.kind === 'calendar_refresh_intent'
      && item.contextSha256 === contextSha256 && /^[a-f0-9]{32}$/u.test(item.attemptId || '')
      && typeof item.createdAt === 'string' && new Date(item.createdAt).toISOString() === item.createdAt;
  }
  async function readOwnRefreshIntent(expected) {
    let item;
    try {
      const raw = await readFile(refreshHoldPath, 'utf8');
      if (typeof raw !== 'string' || raw.length > 1024) throw recoveryRequired();
      item = JSON.parse(raw);
      if (!validRefreshIntent(item) || raw !== JSON.stringify(expected)) throw recoveryRequired();
    } catch { throw recoveryRequired(); }
    return item;
  }
  async function writeRefreshIntent(intent) {
    const temp = `${refreshHoldPath}.${intent.attemptId}.tmp`;
    const file = await open(temp,'wx',0o600);
    try { await file.writeFile(JSON.stringify(intent),'utf8'); await file.sync(); }
    finally { await file.close(); }
    await rename(temp,refreshHoldPath);
    await syncDirectory(dirname(storePath));
    await readOwnRefreshIntent(intent);
    return intent;
  }
  async function persistRefreshIntent() {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) throw recoveryRequired();
    const intent = {schemaVersion:1,kind:'calendar_refresh_intent',contextSha256,
      attemptId:randomBytes(16).toString('hex'),createdAt:new Date(timestamp).toISOString()};
    // This is a durable intent, not a claim that POST has already happened.
    return writeRefreshIntent(intent);
  }
  async function clearRefreshIntent(intent) {
    await readOwnRefreshIntent(intent);
    await unlink(refreshHoldPath);
    await syncDirectory(dirname(storePath));
    // The operation lock remains the fail-closed anchor through unlink/fsync.
  }
  async function load() {
    if (!configured) return null;
    try { return decrypt(await readFile(storePath, 'utf8')); }
    catch (cause) {
      if (cause?.code === 'ENOENT') return null;
      throw error('calendar_store_unreadable', '正式面试日历授权无法读取，已停止日历访问。');
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
      await syncDirectory(dirname(storePath));
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
    await assertNoRefreshHold();
    await mkdir(dirname(storePath), {recursive:true, mode:0o700});
    try { await mkdir(operationLockPath, {mode:0o700}); }
    catch { throw error('calendar_authorization_busy', '日历授权正在处理或上次结果待核验，请勿重复授权。'); }
    const control = {refreshRisk:false,refreshIntent:null};
    try {
      await assertNoRefreshHold({insideLock:true});
      return await operation(control);
    } finally {
      // Never erase the last persistent anchor after intent/POST/save/cleanup
      // uncertainty. Normal GET failures do not rotate tokens and release it.
      if (!control.refreshRisk) {
        try { await rmdir(operationLockPath); }
        catch {
          locallyBlocked = true;
          // If removal took effect before reporting an error, restore the
          // no-secret hold before exposing cleanup failure. Never reuse a grant.
          if (control.refreshIntent) {
            try {
              if (!await exists(operationLockPath)) await mkdir(operationLockPath,{mode:0o700});
              await writeRefreshIntent(control.refreshIntent);
            } catch { /* Local quarantine remains; disk repair needs human verification. */ }
          }
          throw recoveryRequired();
        }
      }
    }
  }
  function statusFrom(record) {
    if (!configured) return {configured:false, authorized:false, reason:'日历用户授权配置不完整'};
    if (!record) return {configured:true, authorized:false, reason:`等待${ownerLabel}完成飞书用户授权`};
    const timestamp = now();
    const authorized = validStoredGrant(record) && safeTimestamp(timestamp) && record.refreshExpiresAt > timestamp;
    return {configured:true, authorized, ...(authorized ? {} : {reason:`${ownerLabel}用户授权已过期或账号不匹配`}), openId:record.openId, refreshExpiresAt:record.refreshExpiresAt};
  }
  async function status() {
    if (!configured) return statusFrom(null);
    try {
      await assertNoRefreshHold();
      const record = await load();
      await assertNoRefreshHold();
      return statusFrom(record);
    } catch (cause) {
      if (!['calendar_refresh_recovery_required','calendar_authorization_busy'].includes(cause?.code)) throw cause;
      return {configured:true,authorized:false,status:'recovery_required',recoveryRequired:true,reason:cause.message};
    }
  }
  function begin() {
    if (!configured) throw error('calendar_auth_not_configured', '日历用户授权尚未配置。');
    const redirect = new URL(redirectUri);
    if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.hash || redirect.search) throw error('calendar_redirect_invalid', '正式日历授权回调必须使用固定 HTTPS 地址。');
    const state = randomBytes(32).toString('base64url');
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
    const codeExchange = body.grant_type === 'authorization_code';
    const tokenEndpoint = codeExchange ? codeTokenEndpoint : refreshTokenEndpoint;
    const payload = {client_id:appId,client_secret:appSecret,...body};
    const encoding = codeExchange ? 'json' : 'form';
    const requestBody = codeExchange ? JSON.stringify(payload) : new URLSearchParams(payload).toString();
    const response = await fetchImpl(tokenEndpoint, {method:'POST',redirect:'error',headers:{'Content-Type':codeExchange?'application/json; charset=utf-8':'application/x-www-form-urlencoded'},body:requestBody,signal:AbortSignal.timeout(12_000)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0 || !data.access_token || !data.refresh_token) {
      // Never expose the response body, authorization code, verifier, or tokens.
      const upstreamCode = Number.isSafeInteger(data.code) ? data.code : null;
      const rawId = response.headers?.get?.('x-tt-logid') || '';
      const requestId = /^[A-Za-z0-9_-]{1,96}$/u.test(rawId) ? rawId : null;
      const detail = {stage:'token_exchange',grant:body.grant_type === 'refresh_token' ? 'refresh_token' : 'authorization_code',encoding,tokenVersion:codeExchange?'v2':'v3',httpStatus:response.status,upstreamCode,requestId,hasAccessToken:Boolean(data.access_token),hasRefreshToken:Boolean(data.refresh_token),...(body.grant_type === 'authorization_code' ? {pkceMethod:'S256',verifierLength:body.code_verifier.length,pkceLocallyVerified:true} : {})};
      diagnostic(detail);
      const hints = {20002:'应用凭据校验失败',20003:'授权码无效或已使用',20004:'授权码已过期',20049:'PKCE 安全校验未通过',20065:'授权码已使用',20068:'授权范围不匹配',20071:'回调地址不匹配'};
      const hint = hints[upstreamCode] || (!data.refresh_token && data.access_token ? '未返回可续期的只读授权' : '授权接口返回异常');
      throw Object.assign(error('calendar_oauth_exchange_failed', `飞书日历授权换取失败：${hint}${upstreamCode === null ? '' : `（飞书错误码 ${upstreamCode}）`}。请勿刷新回调页，请返回中枢重新发起。`), {diagnostic:detail});
    }
    const scopes = String(data.scope || '').split(/\s+/u).filter(Boolean);
    if (!requiredScopes.every(scope => scopes.includes(scope))) throw error('calendar_scope_missing', '飞书日历授权未包含所需的只读与离线权限。');
    if (![data.expires_in, data.refresh_token_expires_in].every(v => Number.isFinite(Number(v)) && Number(v) > 0)) throw error('calendar_token_expiry_invalid', '日历授权有效期无法核验，凭据未保存。');
    return data;
  }
  async function getUserInfo(accessToken) {
    const response = await fetchImpl(userInfoEndpoint, {redirect:'error',headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(12_000)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0 || !data.data?.open_id) throw error('calendar_identity_unverified', '无法核验日历授权用户身份。');
    return data.data.open_id;
  }
  async function verifyCalendarAccess(accessToken, targetCalendarId = calendarId) {
    if (!permittedCalendars.has(targetCalendarId)) throw error('calendar_path_denied','此日历未列入已核验的只读来源。');
    if (requireOwnPrimaryCalendar) {
      if (targetCalendarId !== calendarId) throw error('calendar_path_denied','仅允许核验本人预置的主日历。');
      const primaryResponse = await fetchImpl('https://open.feishu.cn/open-apis/calendar/v4/calendars/primary?user_id_type=open_id',
        {method:'POST',redirect:'error',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json; charset=utf-8'},body:'{}',signal:AbortSignal.timeout(12000)});
      const primary = await primaryResponse.json().catch(() => ({}));
      if (!primaryResponse.ok || primary.code !== 0 || !Array.isArray(primary.data?.calendars))
        throw error('calendar_primary_unverified','无法核验本人主日历，未读取或保存日历资料。');
      const matches = primary.data.calendars.filter(item => item?.user_id === expectedOpenId
        && item.calendar?.calendar_id === calendarId && item.calendar?.type === 'primary' && item.calendar?.is_deleted !== true);
      if (matches.length !== 1) throw error('calendar_primary_unverified','日历与当前教练本人主日历不一致，未读取或保存日历资料。');
    }
    const response=await fetchImpl(`https://open.feishu.cn/open-apis/calendar/v4/calendars/${encodeURIComponent(targetCalendarId)}`,{redirect:'error',headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(12000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.code!==0||!['reader','writer','owner'].includes(data.data?.calendar?.role||data.data?.role))throw error('calendar_detail_permission_missing','当前授权用户对指定日历尚无详情读取权限，请由日历所有者授予“订阅者（可查看详情）”。');
  }
  function refreshedRecord(data, openId) {
    const timestamp = now();
    if (!safeTimestamp(timestamp) || !tokenString(data?.access_token) || !tokenString(data?.refresh_token)
      || typeof data?.scope !== 'string' || data.scope.trim() !== data.scope || !data.scope
      || ![data?.expires_in,data?.refresh_token_expires_in].every(value=>Number.isSafeInteger(value) && value > 0
        && value <= Math.floor((8640000000000000 - timestamp) / 1000))) throw recoveryRequired();
    const record = {openId,accessToken:data.access_token,accessExpiresAt:timestamp + data.expires_in * 1000,
      refreshToken:data.refresh_token,refreshExpiresAt:timestamp + data.refresh_token_expires_in * 1000,
      scopes:data.scope};
    if (!validStoredGrant(record)) throw recoveryRequired();
    return record;
  }
  async function complete({code, state, cookieState}) {
    const attempt = pending.get(state);
    pending.delete(state);
    if (!attempt || now() - attempt.createdAt > 600_000 || !same(state, cookieState) || !code) throw error('calendar_oauth_state_invalid', '日历授权校验失败或已过期，请重新发起。');
    if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(attempt.verifier) || !same(createHash('sha256').update(attempt.verifier).digest('base64url'),attempt.challenge)) throw error('calendar_pkce_local_invalid','日历授权安全参数校验失败，未提交凭据请求。');
    return exclusive(async control => {
    const data = await tokenRequest({grant_type:'authorization_code',code,redirect_uri:redirectUri,code_verifier:attempt.verifier,scope:requiredScopes.join(' ')});
    // Validate the whole grant before the first identity/calendar GET. This
    // staging record is not an authorization claim; identity is checked next.
    const grant = refreshedRecord(data, expectedOpenId);
    const openId = await getUserInfo(grant.accessToken);
    if (typeof openId !== 'string' || !same(openId, expectedOpenId)) throw error('calendar_oauth_wrong_user', `授权账号不是指定的${ownerLabel}账号，凭据未保存。`);
    await verifyCalendarAccess(grant.accessToken);
    const record = {...grant,openId};
    control.refreshRisk = true;
    try {
      await save(record);
      const readback = await load();
      if (!sameStoredGrant(readback,record)) throw recoveryRequired();
      const result = statusFrom(readback);
      if (!result.authorized) throw recoveryRequired();
      control.refreshRisk = false;
      return result;
    } catch { locallyBlocked = true; throw recoveryRequired(); }
    });
  }
  async function accessTokenWithinLock(control) {
    if (!configured) throw error('calendar_auth_not_configured', '正式面试日历的用户授权尚未配置。');
    await assertNoRefreshHold({insideLock:true});
    const record = await load();
    await assertNoRefreshHold({insideLock:true});
    if (!validStoredGrant(record) || !safeTimestamp(now()) || record.refreshExpiresAt <= now()) throw error('calendar_authorization_required', `${ownerLabel}日历需本人重新授权。`);
    if (record.accessExpiresAt > now() + 300_000) return record.accessToken;
    if (!record.refreshToken || record.refreshExpiresAt <= now()) throw error('calendar_authorization_required', '正式面试日历授权已过期。');
    control.refreshRisk = true;
    try {
      const intent = await persistRefreshIntent();
      control.refreshIntent = intent;
      await readOwnRefreshIntent(intent);
      const data = await tokenRequest({grant_type:'refresh_token',refresh_token:record.refreshToken,scope:requiredScopes.join(' ')});
      const rotated = refreshedRecord(data, record.openId);
      await save(rotated);
      const readback = await load();
      if (!sameStoredGrant(readback,rotated)) throw recoveryRequired();
      await clearRefreshIntent(intent);
      control.refreshRisk = false;
      return rotated.accessToken;
    } catch { locallyBlocked = true; throw recoveryRequired(); }
  }
  async function withReadableCredential(operation) {
    if (!configured) throw error('calendar_auth_not_configured', '正式面试日历的用户授权尚未配置。');
    return exclusive(async control => {
      const token = await accessTokenWithinLock(control);
      await assertNoRefreshHold({insideLock:true});
      return operation(token);
    });
  }
  async function get(path) {
    const url = new URL(`https://open.feishu.cn/open-apis${path}`);
    const eventPaths = new Set([...permittedCalendars].map(id => `/open-apis/calendar/v4/calendars/${encodeURIComponent(id)}/events`));
    const instancePaths = new Set(allowInstanceView ? [...permittedCalendars].map(id => `/open-apis/calendar/v4/calendars/${encodeURIComponent(id)}/events/instance_view`) : []);
    const instance = instancePaths.has(url.pathname);
    const permitted = instance ? ['start_time','end_time'] : ['start_time','end_time','page_size','page_token'];
    if ((!eventPaths.has(url.pathname) && !instance) || url.hash || [...url.searchParams.keys()].some(k => !permitted.includes(k))) throw error('calendar_path_denied', '用户授权仅可读取已列入清单的日历事件。');
    if (instance) {
      const start=Number(url.searchParams.get('start_time')),end=Number(url.searchParams.get('end_time'));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end < start || end-start >= 8*86400) throw error('calendar_path_denied','复盘实例仅允许读取指定的单个绩效周。');
    }
    return withReadableCredential(async token => {
      const response = await fetchImpl(url.href, {redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12_000)});
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.code !== 0) throw error('calendar_read_failed', '正式面试日历读取失败，请核验用户授权及日历权限。');
      return data.data || {};
    });
  }
  // Private, opt-in native source reads. Never accept an HTTP path/host/method,
  // actor, token or allowlist from a request. The default public API is unchanged.
  async function getNative(request, options = {}) {
    if (allowNativeSource !== true) throw error('calendar_native_source_disabled','原生日历来源接入未启用。');
    if (options === null || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some(key => key !== 'signal')
      || options.signal !== undefined && !(options.signal instanceof AbortSignal))
      throw error('calendar_native_query_denied','原生日历只读参数未通过核验。');
    const signal = options.signal;
    if (signal?.aborted) throw error('calendar_native_read_aborted','原生日历只读已取消。');
    const url = buildNativeCalendarRequest(request, [...permittedCalendars]);
    if (requireOwnPrimaryCalendar && request.calendarId !== calendarId)
      throw error('calendar_native_query_denied','仅可读取当前教练本人预置日历。');
    return withReadableCredential(async token => {
      if (signal?.aborted) throw error('calendar_native_read_aborted','原生日历只读已取消。');
      const combined = signal ? AbortSignal.any([signal,AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000);
      let onAbort, activeStream = null, cancelIssued = false;
      const cancelledRead = () => error('calendar_native_read_aborted','原生日历只读已取消或超时。');
      const cancelAndRelease = stream => {
        if (!cancelIssued) {
          cancelIssued = true;
          try { void Promise.resolve(stream.cancel()).catch(() => {}); } catch {}
        }
        if (activeStream === stream) {
          // Standard byte-stream cancellation settles pending reads immediately;
          // do not await an untrusted underlying cancel promise without a bound.
          try { stream.releaseLock(); } catch {}
          activeStream = null;
        }
      };
      const cancelUnacquiredBody = response => {
        try { void Promise.resolve(response.body?.cancel?.()).catch(() => {}); } catch {}
      };
      const stopped = new Promise((_,reject) => {
        onAbort = () => {
          if (activeStream) cancelAndRelease(activeStream);
          reject(cancelledRead());
        };
        combined.addEventListener('abort',onAbort,{once:true});
        if (combined.aborted) onAbort();
      });
      const limit = 8 * 1024 * 1024;
      const operation = async () => {
        if (combined.aborted) throw cancelledRead();
        const response = await fetchImpl(url,{method:'GET',redirect:'error',
          headers:{Authorization:`Bearer ${token}`},signal:combined});
        // A late fetch adapter may ignore AbortSignal. Never acquire/read its
        // returned body after the exclusive read has already been cancelled.
        if (combined.aborted) { cancelUnacquiredBody(response); throw cancelledRead(); }
        if (!response.ok) {
          cancelUnacquiredBody(response);
          throw error('calendar_native_read_failed','原生日历只读来源暂不可核验。');
        }
        let raw;
        if (response.body?.getReader) {
          const stream = response.body.getReader(), chunks = [];
          activeStream = stream;
          let size = 0, complete = false;
          try {
            for (;;) {
              if (combined.aborted) throw cancelledRead();
              const item = await stream.read();
              if (combined.aborted) throw cancelledRead();
              if (item.done) { complete = true; break; }
              if (!(item.value instanceof Uint8Array)) throw error('calendar_native_read_failed','原生日历响应格式不可核验。');
              size += item.value.byteLength;
              if (size > limit) throw error('calendar_native_read_failed','原生日历响应超过只读上限。');
              chunks.push(Buffer.from(item.value));
            }
            raw = new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));
          } finally {
            if (!complete) cancelAndRelease(stream);
            else if (activeStream === stream) { stream.releaseLock(); activeStream = null; }
          }
        } else {
          // Only trusted string-only fetch adapters/fixtures may use this branch.
          // It is not proof of pre-buffer byte caps or fatal UTF-8 decoding.
          // Default Node fetch uses a byte stream; never downgrade an opaque body.
          if (response.body != null || typeof response.text !== 'function') {
            cancelUnacquiredBody(response);
            throw error('calendar_native_read_failed','原生日历响应字节流不可核验。');
          }
          raw = await response.text();
        }
        if (combined.aborted) throw cancelledRead();
        if (typeof raw !== 'string' || !raw || Buffer.byteLength(raw,'utf8') > limit)
          throw error('calendar_native_read_failed','原生日历响应大小不可核验。');
        return raw; // Original JSON string, not parsed/truncated/normalized.
      };
      try { return await Promise.race([operation(),stopped]); }
      catch (cause) {
        if (cause?.code === 'calendar_native_read_aborted') throw cause;
        throw error('calendar_native_read_failed','原生日历只读来源暂不可核验。');
      } finally { combined.removeEventListener('abort',onAbort); }
    });
  }
  async function verifyCalendar(targetCalendarId) { return withReadableCredential(token => verifyCalendarAccess(token, targetCalendarId)); }
  return {calendarId, status, begin, complete, get, verifyCalendar,
    ...(allowNativeSource === true ? {getNative} : {})};
}
