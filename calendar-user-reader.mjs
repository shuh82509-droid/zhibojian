import {createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, rename, writeFile, rmdir} from 'node:fs/promises';
import {dirname} from 'node:path';

const requiredScopes = ['calendar:calendar:read', 'calendar:calendar.event:read', 'offline_access'];
const tokenEndpoint = 'https://accounts.feishu.cn/oauth/v3/token';
const userInfoEndpoint = 'https://open.feishu.cn/open-apis/authen/v1/user_info';

export function createCalendarUserReader({appId, appSecret, calendarId, additionalCalendarIds = [], expectedOpenId, ownerLabel = '舒豪', requireOwnPrimaryCalendar = false, allowInstanceView = false, redirectUri, storePath, encryptionKey, fetchImpl = fetch, now = Date.now, diagnostic = item => console.warn('[calendar-oauth]', JSON.stringify(item))}) {
  const key = /^[A-Za-z0-9+/]{43}=$/u.test(encryptionKey || '') ? Buffer.from(encryptionKey, 'base64') : Buffer.alloc(0);
  const configured = Boolean(appId && appSecret && calendarId && expectedOpenId && redirectUri && storePath && key.length === 32);
  const pending = new Map();
  const context = Buffer.from(JSON.stringify([appId, calendarId, expectedOpenId]));
  const permittedCalendars = new Set([calendarId, ...(Array.isArray(additionalCalendarIds) ? additionalCalendarIds : [])].filter(value => typeof value === 'string' && /^[A-Za-z0-9_@.\-]{3,256}$/u.test(value)));
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
    if (item.version !== 2) throw error('calendar_store_invalid', '日历授权存储格式不可识别，请重新授权。');
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
      throw error('calendar_store_unreadable', '正式面试日历授权无法读取，已停止日历访问。');
    }
  }
  async function save(value) {
    await mkdir(dirname(storePath), {recursive:true, mode:0o700});
    const temp = `${storePath}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temp, encrypt(value), {mode:0o600, flag:'wx'});
    await rename(temp, storePath);
  }
  // Never steal a stale lock: a crashed refresh may already have rotated the
  // one-use refresh token. Recovery must verify the original credential first.
  async function exclusive(operation) {
    await mkdir(dirname(storePath), {recursive:true, mode:0o700});
    const lock = `${storePath}.lock`;
    try { await mkdir(lock, {mode:0o700}); }
    catch { throw error('calendar_authorization_busy', '日历授权正在处理或上次结果待核验，请勿重复授权。'); }
    try { return await operation(); } finally { await rmdir(lock); }
  }
  function statusFrom(record) {
    if (!configured) return {configured:false, authorized:false, reason:'日历用户授权配置不完整'};
    if (!record) return {configured:true, authorized:false, reason:`等待${ownerLabel}完成飞书用户授权`};
    const authorized = same(record.openId, expectedOpenId) && record.refreshExpiresAt > now() && requiredScopes.every(s => String(record.scopes).split(/\s+/u).includes(s));
    return {configured:true, authorized, ...(authorized ? {} : {reason:`${ownerLabel}用户授权已过期或账号不匹配`}), openId:record.openId, refreshExpiresAt:record.refreshExpiresAt};
  }
  async function status() { return statusFrom(await load()); }
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
    // v3 recommends RFC 6749 form encoding. Preserve PKCE and scope narrowing.
    const requestBody = new URLSearchParams({client_id:appId,client_secret:appSecret,...body});
    const response = await fetchImpl(tokenEndpoint, {method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:requestBody.toString(),signal:AbortSignal.timeout(12_000)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0 || !data.access_token || !data.refresh_token) {
      // Never expose the response body, authorization code, verifier, or tokens.
      const upstreamCode = Number.isSafeInteger(data.code) ? data.code : null;
      const rawId = response.headers?.get?.('x-tt-logid') || '';
      const requestId = /^[A-Za-z0-9_-]{1,96}$/u.test(rawId) ? rawId : null;
      const detail = {stage:'token_exchange',grant:body.grant_type === 'refresh_token' ? 'refresh_token' : 'authorization_code',encoding:'form',httpStatus:response.status,upstreamCode,requestId,hasAccessToken:Boolean(data.access_token),hasRefreshToken:Boolean(data.refresh_token),...(body.grant_type === 'authorization_code' ? {pkceMethod:'S256',verifierLength:body.code_verifier.length,pkceLocallyVerified:true} : {})};
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
  function recordFrom(data, openId) {
    return {openId, accessToken:data.access_token, accessExpiresAt:now() + Number(data.expires_in || 0) * 1000,
      refreshToken:data.refresh_token, refreshExpiresAt:now() + Number(data.refresh_token_expires_in || 0) * 1000,
      scopes:String(data.scope || '')};
  }
  async function complete({code, state, cookieState}) {
    const attempt = pending.get(state);
    pending.delete(state);
    if (!attempt || now() - attempt.createdAt > 600_000 || !same(state, cookieState) || !code) throw error('calendar_oauth_state_invalid', '日历授权校验失败或已过期，请重新发起。');
    if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(attempt.verifier) || !same(createHash('sha256').update(attempt.verifier).digest('base64url'),attempt.challenge)) throw error('calendar_pkce_local_invalid','日历授权安全参数校验失败，未提交凭据请求。');
    return exclusive(async () => {
    const data = await tokenRequest({grant_type:'authorization_code',code,redirect_uri:redirectUri,code_verifier:attempt.verifier,scope:requiredScopes.join(' ')});
    const openId = await getUserInfo(data.access_token);
    if (!same(openId, expectedOpenId)) throw error('calendar_oauth_wrong_user', `授权账号不是指定的${ownerLabel}账号，凭据未保存。`);
    await verifyCalendarAccess(data.access_token);
    await save(recordFrom(data, openId));
    return status();
    });
  }
  async function accessToken() {
    if (!configured) throw error('calendar_auth_not_configured', '正式面试日历的用户授权尚未配置。');
    const record = await load();
    if (!record || !same(record.openId, expectedOpenId) || record.refreshExpiresAt <= now()) throw error('calendar_authorization_required', `${ownerLabel}日历需本人重新授权。`);
    if (record.accessExpiresAt > now() + 300_000) return record.accessToken;
    if (!refreshInFlight) refreshInFlight = exclusive(async () => {
      const latest = await load();
      if (latest?.accessExpiresAt > now() + 300_000) return latest.accessToken;
      if (!latest?.refreshToken || latest.refreshExpiresAt <= now()) throw error('calendar_authorization_required', '正式面试日历授权已过期。');
      const data = await tokenRequest({grant_type:'refresh_token',refresh_token:latest.refreshToken,scope:requiredScopes.join(' ')});
      const rotated = recordFrom(data, latest.openId);
      await save(rotated);
      return rotated.accessToken;
    }).finally(() => { refreshInFlight = null; });
    return refreshInFlight;
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
    const response = await fetchImpl(url.href, {redirect:'error',headers:{Authorization:`Bearer ${await accessToken()}`},signal:AbortSignal.timeout(12_000)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0) throw error('calendar_read_failed', '正式面试日历读取失败，请核验用户授权及日历权限。');
    return data.data || {};
  }
  async function verifyCalendar(targetCalendarId) { return verifyCalendarAccess(await accessToken(), targetCalendarId); }
  return {calendarId, status, begin, complete, get, verifyCalendar};
}
