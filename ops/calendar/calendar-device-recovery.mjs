// Operator-only recovery using the official larksuite/cli RFC 8628 flow.
// No HTTP route, bot permission change, browser cookie or CLI user token import.
import {createCipheriv, createDecipheriv, randomBytes, createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, rename, rmdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

export const scopes = ['calendar:calendar:read','calendar:calendar.event:read','offline_access'];
const inherentScopes = new Set([...scopes,'user_profile','auth:user.id:read']);
const fail = code => Object.assign(new Error(code), {code});
export function createDeviceRecovery({appId,appSecret,calendarId,expectedOpenId,storePath,encryptionKey,requireOwnPrimaryCalendar=false,fetchImpl=fetch,now=Date.now}) {
  const key=Buffer.from(encryptionKey||'', 'base64');
  if (!appId||!appSecret||!calendarId||!expectedOpenId||!storePath||key.length!==32) throw fail('configuration_incomplete');
  const pendingPath=storePath+'.device-recovery.enc';
  const context=Buffer.from(JSON.stringify([appId,calendarId,expectedOpenId]));
  const deviceContext=Buffer.from(JSON.stringify([appId,calendarId,expectedOpenId,'device-recovery-v1']));
  const digest=raw=>raw===null?null:createHash('sha256').update(raw).digest('hex');
  async function raw(path) { try{return await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw fail('private_store_unreadable');} }
  function encrypt(value,aad) {
    const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(aad);
    const ciphertext=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);
    return JSON.stringify({version:2,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')});
  }
  function decrypt(text,aad) {
    try {const x=JSON.parse(text);if(x.version!==2)throw Error();const d=createDecipheriv('aes-256-gcm',key,Buffer.from(x.iv,'base64'));d.setAAD(aad);d.setAuthTag(Buffer.from(x.tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(x.ciphertext,'base64')),d.final()]).toString('utf8'));}
    catch{throw fail('private_store_integrity_failed');}
  }
  async function save(path,value,aad) {
    const temp=path+'.'+randomBytes(8).toString('hex')+'.tmp';
    await writeFile(temp,encrypt(value,aad),{mode:0o600,flag:'wx'});await rename(temp,path);
  }
  async function locked(fn) {
    await mkdir(dirname(storePath),{recursive:true,mode:0o700});
    try{await mkdir(storePath+'.lock',{mode:0o700});}catch{throw fail('calendar_authorization_busy');}
    try{return await fn();}finally{await rmdir(storePath+'.lock');}
  }
  const authorized=r=>r?.openId===expectedOpenId&&r.refreshExpiresAt>now()&&scopes.every(s=>String(r.scopes).split(/\s+/u).includes(s));
  async function request(url,options) {
    try {
      const r=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});
      const data=await r.json();return {ok:r.ok,status:r.status,data};
    }catch{throw fail('provider_result_uncertain');}
  }
  async function issue() {return locked(async()=>{
    const before=await raw(storePath);if(before&&authorized(decrypt(before,context)))return {authorized:true};
    const old=await raw(pendingPath);if(old){const p=decrypt(old,deviceContext);if(p.phase!=='complete'&&p.phase!=='denied'&&p.expiresAt>now())throw fail('device_attempt_active');}
    // Exact request used by the official larksuite CLI, app credential stays here.
    const {ok,data}=await request('https://accounts.feishu.cn/oauth/v1/device_authorization',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(appId+':'+appSecret).toString('base64')},body:new URLSearchParams({client_id:appId,scope:scopes.join(' ')}).toString()});
    if(!ok||data.error||!data.device_code||!data.verification_uri_complete||!(Number(data.expires_in)>0))throw fail('device_issue_failed');
    let url;try{url=new URL(data.verification_uri_complete);}catch{throw fail('device_url_invalid');}
    if(url.protocol!=='https:'||url.hostname!=='accounts.feishu.cn'||url.username||url.password||url.hash)throw fail('device_url_invalid');
    const interval=Math.max(5000,Math.min(60000,Number(data.interval||5)*1000));
    const expiresAt=now()+Math.min(1800,Number(data.expires_in))*1000;
    await save(pendingPath,{phase:'pending',deviceCode:data.device_code,expiresAt,interval,nextPoll:now()+interval,beforeHash:digest(before)},deviceContext);
    return {authorized:false,verificationUrl:data.verification_uri_complete,userCode:data.user_code||null,expiresAt,intervalMs:interval};
  });}
  function tokenRecord(data,receivedAt) {
    if(!data.access_token||!data.refresh_token||![data.expires_in,data.refresh_token_expires_in].every(n=>Number.isFinite(Number(n))&&Number(n)>0))throw fail('device_token_invalid');
    const granted=String(data.scope||'').split(/\s+/u).filter(Boolean);
    if(!scopes.every(s=>granted.includes(s)))throw fail('device_scope_missing');
    return {openId:expectedOpenId,accessToken:data.access_token,refreshToken:data.refresh_token,accessExpiresAt:receivedAt+Number(data.expires_in)*1000,refreshExpiresAt:receivedAt+Number(data.refresh_token_expires_in)*1000,scopes:granted.join(' ')};
  }
  async function validateAndCommit(p) {
    let record=tokenRecord(p.token,p.receivedAt);
    if(String(record.scopes).split(/\s+/u).some(s=>!inherentScopes.has(s))) {
      // Never retain broader business permissions from historic consent.
      p.phase='narrowing';await save(pendingPath,p,deviceContext);
      const r=await request('https://accounts.feishu.cn/oauth/v3/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:appId,client_secret:appSecret,grant_type:'refresh_token',refresh_token:record.refreshToken,scope:scopes.join(' ')}).toString()});
      if(!r.ok||r.data.code!==0)throw fail('device_scope_narrowing_failed');
      p.token=r.data;p.receivedAt=now();p.phase='received';await save(pendingPath,p,deviceContext);record=tokenRecord(p.token,p.receivedAt);
      if(String(record.scopes).split(/\s+/u).some(s=>!inherentScopes.has(s))){await save(pendingPath,{phase:'failed',expiresAt:p.expiresAt},deviceContext);throw fail('device_scope_too_broad');}
    }
    if(record.accessExpiresAt<=now()+30000)throw fail('device_token_expired_before_verification');
    const headers={Authorization:'Bearer '+record.accessToken};
    const identity=await request('https://open.feishu.cn/open-apis/authen/v1/user_info',{headers});
    if(!identity.ok||identity.data.code!==0||identity.data.data?.open_id!==expectedOpenId)throw fail('device_wrong_user_or_unverified');
    if(requireOwnPrimaryCalendar){
      const primary=await request('https://open.feishu.cn/open-apis/calendar/v4/calendars/primary?user_id_type=open_id',
        {method:'POST',headers:{...headers,'Content-Type':'application/json; charset=utf-8'},body:'{}'});
      const matches=Array.isArray(primary.data?.data?.calendars)?primary.data.data.calendars.filter(item=>
        item?.user_id===expectedOpenId&&item.calendar?.calendar_id===calendarId&&item.calendar?.type==='primary'&&item.calendar?.is_deleted!==true):[];
      if(!primary.ok||primary.data?.code!==0||matches.length!==1)throw fail('device_primary_calendar_unverified');
    }
    const calendar=await request('https://open.feishu.cn/open-apis/calendar/v4/calendars/'+encodeURIComponent(calendarId),{headers});
    const c=calendar.data.data?.calendar||calendar.data.data;
    if(!calendar.ok||calendar.data.code!==0||c?.calendar_id!==calendarId||!['reader','writer','owner'].includes(c?.role))throw fail('device_calendar_details_denied');
    const current=await raw(storePath);
    if(digest(current)!==p.beforeHash)throw fail('calendar_store_changed');
    if(current!==null)await writeFile(storePath+'.before-device-'+now()+'.enc',current,{mode:0o600,flag:'wx'});
    await save(storePath,record,context);
    const readback=decrypt(await raw(storePath),context);
    if(!authorized(readback))throw fail('calendar_store_readback_failed');
    await save(pendingPath,{phase:'complete',expiresAt:0,completedAt:now()},deviceContext);
    return {authorized:true,identityVerified:true,calendarId,calendarRole:c.role,scopes:record.scopes,refreshExpiresAt:record.refreshExpiresAt};
  }
  async function poll() {return locked(async()=>{
    const current=await raw(storePath);if(current&&authorized(decrypt(current,context)))return {authorized:true,existingAuthorization:true};
    const text=await raw(pendingPath);if(!text)throw fail('device_attempt_missing');const p=decrypt(text,deviceContext);
    if(p.phase==='received')return validateAndCommit(p);
    if(p.phase!=='pending')throw fail('device_attempt_requires_review');
    if(p.expiresAt<=now())throw fail('device_attempt_expired');
    if(now()<p.nextPoll)return {authorized:false,pending:true,retryAfterMs:p.nextPoll-now()};
    // Mark before sending: a transport failure must not cause blind grant replay.
    p.phase='polling';await save(pendingPath,p,deviceContext);
    const {ok,data,status}=await request('https://open.feishu.cn/open-apis/authen/v2/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:p.deviceCode,client_id:appId,client_secret:appSecret}).toString()});
    if(['authorization_pending','slow_down'].includes(data.error)){
      if(data.error==='slow_down')p.interval=Math.min(60000,p.interval+5000);
      p.phase='pending';p.nextPoll=now()+p.interval;await save(pendingPath,p,deviceContext);return {authorized:false,pending:true,retryAfterMs:p.interval};
    }
    if(!ok||data.error||data.code&&data.code!==0){
      await save(pendingPath,{phase:data.error==='access_denied'?'denied':'failed',expiresAt:p.expiresAt},deviceContext);
      throw Object.assign(fail('device_grant_rejected'),{httpStatus:status,upstreamCode:Number.isSafeInteger(data.code)?data.code:null});
    }
    p.phase='received';p.token=data;p.receivedAt=now();delete p.deviceCode;await save(pendingPath,p,deviceContext);
    return validateAndCommit(p);
  });}
  return {issue,poll};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const e=process.env;
  try {
    const r=createDeviceRecovery({appId:e.FEISHU_APP_ID,appSecret:e.FEISHU_APP_SECRET,calendarId:e.RECRUITMENT_CALENDAR_ID,expectedOpenId:e.RECRUITMENT_CALENDAR_READER_OPEN_ID,storePath:e.RECRUITMENT_CALENDAR_OAUTH_STORE_PATH,encryptionKey:e.RECRUITMENT_CALENDAR_OAUTH_KEY});
    const action=process.argv[2];if(!['issue','poll'].includes(action))throw fail('unknown_action');
    console.log(JSON.stringify({ok:true,...await r[action]()}));
  }catch(e){console.log(JSON.stringify({ok:false,code:e.code||'device_recovery_failed',...(e.httpStatus?{httpStatus:e.httpStatus,upstreamCode:e.upstreamCode}:{})}));process.exitCode=1;}
}
