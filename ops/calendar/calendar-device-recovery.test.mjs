import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createDecipheriv} from 'node:crypto';
import {createDeviceRecovery,scopes} from './calendar-device-recovery.mjs';

const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const grant={code:0,access_token:'private_access',refresh_token:'private_refresh',expires_in:7200,refresh_token_expires_in:604800,scope:scopes.join(' ')};
async function fixture(run,{identity='ou_expected',role='reader',token=grant,override}={}){
 const dir=await mkdtemp(join(tmpdir(),'live-device-test-'));let clock=1000000;const calls=[];
 const config={appId:'cli_fixture',appSecret:'private_secret',calendarId:'exact_calendar',expectedOpenId:'ou_expected',storePath:join(dir,'calendar.enc'),encryptionKey:randomBytes(32).toString('base64'),now:()=>clock,fetchImpl:async(url,options)=>{
  calls.push({url,options});if(override){const r=await override(url,options);if(r)return r;}
  if(url.endsWith('/device_authorization'))return reply({device_code:'private_device',user_code:'ABCD-EFGH',verification_uri_complete:'https://accounts.feishu.cn/device?user_code=ABCD-EFGH',expires_in:600,interval:5});
  if(url.endsWith('/oauth/token'))return reply(token);
  if(url.endsWith('/user_info'))return reply({code:0,data:{open_id:identity}});
  if(url.endsWith('/exact_calendar'))return reply({code:0,data:{calendar_id:'exact_calendar',role}});
  throw Error('unexpected request');
 }};
 try{await run({r:createDeviceRecovery(config),config,dir,calls,advance:n=>clock+=n});}finally{await rm(dir,{recursive:true,force:true});}
}
function decrypt(raw,config,aad=[config.appId,config.calendarId,config.expectedOpenId]){const b=JSON.parse(raw),d=createDecipheriv('aes-256-gcm',Buffer.from(config.encryptionKey,'base64'),Buffer.from(b.iv,'base64'));d.setAAD(Buffer.from(JSON.stringify(aad)));d.setAuthTag(Buffer.from(b.tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(b.ciphertext,'base64')),d.final()]).toString());}

test('official device request is minimal, encrypted, rate limited, and commits compatible verified credentials',()=>fixture(async({r,config,calls,advance})=>{
 const issued=await r.issue();assert.equal(issued.authorized,false);assert.equal(issued.verificationUrl,'https://accounts.feishu.cn/device?user_code=ABCD-EFGH');
 const start=new URLSearchParams(calls[0].options.body);assert.equal(start.get('scope'),scopes.join(' '));assert.equal(calls[0].options.redirect,'error');
 let stored=await readFile(config.storePath+'.device-recovery.enc','utf8');assert.doesNotMatch(stored,/private_device|private_secret/);
 assert.deepEqual(await r.poll(),{authorized:false,pending:true,retryAfterMs:5000});assert.equal(calls.length,1);
 advance(5000);const result=await r.poll();assert.equal(result.authorized,true);assert.equal(result.calendarRole,'reader');
 const tokenBody=new URLSearchParams(calls[1].options.body);assert.equal(tokenBody.get('grant_type'),'urn:ietf:params:oauth:grant-type:device_code');assert.equal(tokenBody.get('device_code'),'private_device');
 stored=await readFile(config.storePath,'utf8');assert.doesNotMatch(stored,/private_access|private_refresh|ou_expected/);assert.equal(decrypt(stored,config).accessToken,'private_access');
 if(process.platform!=='win32')assert.equal((await stat(config.storePath)).mode&0o777,0o600);
 const count=calls.length;assert.equal((await r.poll()).existingAuthorization,true);assert.equal((await r.issue()).authorized,true);assert.equal(calls.length,count);
}));
for(const[title,options,code]of[
 ['wrong identity',{identity:'ou_other'},'device_wrong_user_or_unverified'],
 ['busy-only calendar',{role:'free_busy_reader'},'device_calendar_details_denied'],
 ['missing offline permission',{token:{...grant,scope:'calendar:calendar:read calendar:calendar.event:read'}},'device_scope_missing'],
 ['missing refresh token',{token:{...grant,refresh_token:''}},'device_token_invalid'],
 ['invalid lifetime',{token:{...grant,expires_in:0}},'device_token_invalid']
])test(title+' cannot write production credentials',()=>fixture(async({r,config,advance})=>{
 await r.issue();advance(5000);await assert.rejects(r.poll(),{code});await assert.rejects(readFile(config.storePath),{code:'ENOENT'});
},options));
test('duplicate starts, expired attempts and concurrent ownership fail closed',()=>fixture(async({r,config,advance})=>{
 await r.issue();await assert.rejects(r.issue(),{code:'device_attempt_active'});advance(600001);await assert.rejects(r.poll(),{code:'device_attempt_expired'});
 await mkdir(config.storePath+'.lock');await assert.rejects(r.issue(),{code:'calendar_authorization_busy'});
}));
test('authorization pending and slow_down honor provider timing',()=>fixture(async({r,advance,calls})=>{
 await r.issue();advance(5000);assert.equal((await r.poll()).retryAfterMs,10000);const count=calls.length;await r.poll();assert.equal(calls.length,count);
 advance(10000);assert.equal((await r.poll()).retryAfterMs,15000);
},{override:url=>url.endsWith('/oauth/token')?reply({error:'slow_down'},400):null}));
test('denial is final and no credential is stored or leaked',()=>fixture(async({r,config,advance})=>{
 await r.issue();advance(5000);await assert.rejects(r.poll(),e=>{assert.equal(e.code,'device_grant_rejected');assert.doesNotMatch(JSON.stringify(e),/private_secret/);return true;});await assert.rejects(r.poll(),{code:'device_attempt_requires_review'});await assert.rejects(readFile(config.storePath),{code:'ENOENT'});
},{override:url=>url.endsWith('/oauth/token')?reply({error:'access_denied',error_description:'private_secret'},400):null}));
test('uncertain exchange never blindly replays a potentially consumed grant',()=>fixture(async({r,advance,calls})=>{
 await r.issue();advance(5000);await assert.rejects(r.poll(),{code:'provider_result_uncertain'});const count=calls.length;await assert.rejects(r.poll(),{code:'device_attempt_requires_review'});assert.equal(calls.length,count);
},{override:url=>{if(url.endsWith('/oauth/token'))throw Error('private_secret');}}));
test('verification failure resumes encrypted received grant, not token exchange',()=>{
 let reads=0;return fixture(async({r,advance,calls})=>{await r.issue();advance(5000);await assert.rejects(r.poll(),{code:'provider_result_uncertain'});assert.equal((await r.poll()).authorized,true);assert.equal(calls.filter(c=>c.url.endsWith('/oauth/token')).length,1);},
 {override:url=>{if(url.endsWith('/user_info')&&reads++===0)throw Error('temporary network');}});
});
test('broader historic scopes are narrowed before being saved',()=>fixture(async({r,config,advance,calls})=>{
 await r.issue();advance(5000);assert.equal((await r.poll()).authorized,true);const c=calls.find(c=>c.url.endsWith('/oauth/v3/token'));assert.equal(new URLSearchParams(c.options.body).get('scope'),scopes.join(' '));assert.equal(decrypt(await readFile(config.storePath,'utf8'),config).scopes,scopes.join(' '));
},{token:{...grant,scope:grant.scope+' im:message:send_as_bot'},override:url=>url.endsWith('/oauth/v3/token')?reply(grant):null}));
test('still broad token fails closed after one narrowing attempt',()=>fixture(async({r,config,advance})=>{
 await r.issue();advance(5000);await assert.rejects(r.poll(),{code:'device_scope_too_broad'});await assert.rejects(readFile(config.storePath),{code:'ENOENT'});
},{token:{...grant,scope:grant.scope+' im:message:send_as_bot'},override:url=>url.endsWith('/oauth/v3/token')?reply({...grant,scope:grant.scope+' im:message:send_as_bot'}):null}));
test('changed production store is never overwritten',()=>fixture(async({r,config,advance})=>{
 await r.issue();advance(5000);
 // Change while provider verification is in flight, after initial status read.
 const original=config.fetchImpl;config.fetchImpl=async(url,options)=>{const response=await original(url,options);if(url.endsWith('/exact_calendar'))await writeFile(config.storePath,'other-owner-update');return response;};
 const recovery=createDeviceRecovery(config);await assert.rejects(recovery.poll(),{code:'calendar_store_changed'});assert.equal(await readFile(config.storePath,'utf8'),'other-owner-update');
}));
test('untrusted authorization URL is not exposed',()=>fixture(async({r})=>{await assert.rejects(r.issue(),{code:'device_url_invalid'});},
 {override:url=>url.endsWith('/device_authorization')?reply({device_code:'private_device',verification_uri_complete:'https://evil.invalid/steal',expires_in:600}):null}));
test('wrong calendar identifier is rejected despite reader role',()=>fixture(async({r,advance})=>{await r.issue();advance(5000);await assert.rejects(r.poll(),{code:'device_calendar_details_denied'});},
 {override:url=>url.endsWith('/exact_calendar')?reply({code:0,data:{calendar_id:'other_calendar',role:'reader'}}):null}));
