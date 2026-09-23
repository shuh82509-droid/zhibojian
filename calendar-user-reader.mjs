import {createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

const requiredScopes = ['calendar:calendar:read', 'calendar:calendar.event:read', 'offline_access'];
const tokenEndpoint = 'https://accounts.feishu.cn/oauth/v3/token';
const userInfoEndpoint = 'https://open.feishu.cn/open-apis/authen/v1/user_info';

export function createCalendarUserReader({appId, appSecret, calendarId, expectedOpenId, redirectUri, storePath, encryptionKey, fetchImpl = fetch, now = Date.now}) {
  const key = /^[A-Za-z0-9+/]{43}=$/u.test(encryptionKey || '') ? Buffer.from(encryptionKey, 'base64') : Buffer.alloc(0);
  const configured = Boolean(appId && appSecret && calendarId && expectedOpenId && redirectUri && storePath && key.length === 32);
  const pending = new Map();
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
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({version:1, iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), ciphertext:ciphertext.toString('base64')});
  };
  const decrypt = raw => {
    const item = JSON.parse(raw);
    if (item.version !== 1) throw error('calendar_store_invalid', '日历授权存储格式不可识别。');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(item.iv, 'base64'));
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
  function statusFrom(record) {
    if (!configured) return {configured:false, authorized:false, reason:'日历用户授权配置不完整'};
    if (!record) return {configured:true, authorized:false, reason:'等待舒豪完成飞书用户授权'};
    const authorized = same(record.openId, expectedOpenId) && record.refreshExpiresAt > now();
    return {configured:true, authorized, ...(authorized ? {} : {reason:'舒豪用户授权已过期或账号不匹配'}), openId:record.openId, refreshExpiresAt:record.refreshExpiresAt};
  }
  async function status() { return statusFrom(await load()); }
  function begin() {
    if (!configured) throw error('calendar_auth_not_configured', '日历用户授权尚未配置。');
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const createdAt = now();
    for (const [id, value] of pending) if (createdAt - value.createdAt > 600_000) pending.delete(id);
    pending.set(state, {verifier, createdAt});
    const url = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
    for (const [name, value] of Object.entries({client_id:appId,response_type:'code',redirect_uri:redirectUri,scope:requiredScopes.join(' '),state,code_challenge:challenge,code_challenge_method:'S256'})) url.searchParams.set(name, value);
    return {url:url.toString(), state};
  }
  async function tokenRequest(body) {
    const response = await fetchImpl(tokenEndpoint, {method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({client_id:appId,client_secret:appSecret,...body}),signal:AbortSignal.timeout(12_000)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0 || !data.access_token || !data.refresh_token) throw error('calendar_oauth_exchange_failed', '飞书日历授权换取失败，请重新授权。');
    const scopes = String(data.scope || '').split(/\s+/u).filter(Boolean);
    if (!requiredScopes.every(scope => scopes.includes(scope))) throw error('calendar_scope_missing', '飞书日历授权未包含所需的只读与离线权限。');
    return data;
  }
  async function getUserInfo(accessToken) {
    const response = await fetchImpl(userInfoEndpoint, {headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(12_000)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0 || !data.data?.open_id) throw error('calendar_identity_unverified', '无法核验日历授权用户身份。');
    return data.data.open_id;
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
    const data = await tokenRequest({grant_type:'authorization_code',code,redirect_uri:redirectUri,code_verifier:attempt.verifier,scope:requiredScopes.join(' ')});
    const openId = await getUserInfo(data.access_token);
    if (!same(openId, expectedOpenId)) throw error('calendar_oauth_wrong_user', '授权账号不是指定的舒豪账号，凭据未保存。');
    await save(recordFrom(data, openId));
    return status();
  }
  async function accessToken() {
    if (!configured) throw error('calendar_auth_not_configured', '正式面试日历的用户授权尚未配置。');
    const record = await load();
    if (!record || !same(record.openId, expectedOpenId) || record.refreshExpiresAt <= now()) throw error('calendar_authorization_required', '正式面试日历需舒豪重新授权。');
    if (record.accessExpiresAt > now() + 300_000) return record.accessToken;
    if (!refreshInFlight) refreshInFlight = (async () => {
      const latest = await load();
      if (latest?.accessExpiresAt > now() + 300_000) return latest.accessToken;
      if (!latest?.refreshToken || latest.refreshExpiresAt <= now()) throw error('calendar_authorization_required', '正式面试日历授权已过期。');
      const data = await tokenRequest({grant_type:'refresh_token',refresh_token:latest.refreshToken,scope:requiredScopes.join(' ')});
      const rotated = recordFrom(data, latest.openId);
      await save(rotated);
      return rotated.accessToken;
    })().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }
  async function get(path) {
    const response = await fetchImpl(`https://open.feishu.cn/open-apis${path}`, {headers:{Authorization:`Bearer ${await accessToken()}`},signal:AbortSignal.timeout(12_000)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0) throw error('calendar_read_failed', '正式面试日历读取失败，请核验用户授权及日历权限。');
    return data.data || {};
  }
  return {calendarId, status, begin, complete, get};
}
