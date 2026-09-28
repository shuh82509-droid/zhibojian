// Independent local-only refresh quarantine attacks. All credentials are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,sep,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const modulePath=process.env.WIS_READER_REFRESH_MODULE || 'H:/codex输出/直播五环节工作流-20260923/calendar-reader-safe-exact-20260928/candidate-2205/calendar-user-reader.mjs';
const moduleSha=createHash('sha256').update(readFileSync(modulePath)).digest('hex');
if(process.env.WIS_READER_REFRESH_SHA)assert.equal(moduleSha,process.env.WIS_READER_REFRESH_SHA,'reader source pinned before import');
globalThis.fetch=async()=>{throw new Error('independent reader fixtures forbid live network');};
const {createCalendarUserReader}=await import(pathToFileURL(modulePath).href);
const CLOCK=Date.parse('2026-09-28T14:05:00.000Z');
const APP='cli_fixtureOnly',OWNER='ou_fixtureOwner',CAL='calendar_fixture_readonly',OTHER_CAL='calendar_fixture_denied';
const SCOPE='calendar:calendar:read calendar:calendar.event:read offline_access';
const SECRET='synthetic_app_secret_not_real',OLD_ACCESS='synthetic_old_access_not_real',OLD_REFRESH='synthetic_old_refresh_not_real';
const NEW_ACCESS='synthetic_rotated_access_not_real',NEW_REFRESH='synthetic_rotated_refresh_not_real',CODE='synthetic_authorization_code_not_real';
const KEY=Buffer.alloc(32,19),AAD=Buffer.from(JSON.stringify([APP,CAL,OWNER]));
const unsafeSecrets=[SECRET,OLD_ACCESS,OLD_REFRESH,NEW_ACCESS,NEW_REFRESH,CODE,KEY.toString('base64')];
const error=(code,message='synthetic I/O failure')=>Object.assign(new Error(message),{code});
function encrypted(record){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',KEY,iv);cipher.setAAD(AAD);
  const text=Buffer.concat([cipher.update(JSON.stringify(record),'utf8'),cipher.final()]);
  return JSON.stringify({version:2,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:text.toString('base64')});
}
function decrypted(raw){
  const data=JSON.parse(raw),cipher=createDecipheriv('aes-256-gcm',KEY,Buffer.from(data.iv,'base64'));cipher.setAAD(AAD);cipher.setAuthTag(Buffer.from(data.tag,'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data.ciphertext,'base64')),cipher.final()]).toString('utf8'));
}
const record=(cached=false)=>({openId:OWNER,accessToken:OLD_ACCESS,accessExpiresAt:CLOCK+(cached?3600000:-1000),
  refreshToken:OLD_REFRESH,refreshExpiresAt:CLOCK+86400000,scopes:SCOPE});
const grant=(override={})=>({code:0,access_token:NEW_ACCESS,refresh_token:NEW_REFRESH,expires_in:3600,refresh_token_expires_in:86400,scope:SCOPE,...override});
function response(data,status=200){return {ok:status>=200&&status<300,status,headers:{get:()=>null},json:async()=>data};}
function publicOnly(value){const rendered=JSON.stringify(value);assert.equal(unsafeSecrets.some(secret=>rendered.includes(secret)),false,'public diagnostics/status/error contain no synthetic secret');}
const eventPath=`/calendar/v4/calendars/${CAL}/events?start_time=1790500000&end_time=1790600000&page_size=50`;
async function rejected(promise,codes=[]){
  let caught;try{await promise;}catch(cause){caught=cause;}
  assert.ok(caught,'operation must fail closed');publicOnly({code:caught.code,message:caught.message,diagnostic:caught.diagnostic});
  if(codes.length)assert.equal(codes.includes(caught.code),true,'operation returns an expected safe error code');
  return caught;
}
async function fixture(t,{cached=false,refreshResult,fsFactory}={}){
  const folder=await fs.mkdtemp(join(tmpdir(),'wis-reader-refresh-independent-'));
  const root=resolve(folder),storePath=join(root,'fixture-oauth-store.enc');
  t.after(async()=>{assert.equal(root.startsWith(resolve(tmpdir())+sep+'wis-reader-refresh-independent-'),true);await fs.rm(root,{recursive:true,force:true});});
  await fs.writeFile(storePath,encrypted(record(cached)),{mode:0o600});
  const calls={refresh:0,code:0,userInfo:0,calendar:0,events:0,other:0},diagnostics=[],requests=[];
  let currentRefresh=refreshResult||(()=>response(grant()));
  let currentCode=()=>response(grant()),currentUserInfo=()=>response({code:0,data:{open_id:OWNER}}),currentEvents=()=>response({code:0,data:{items:[],has_more:false}});
  const fetchImpl=async(url,options={})=>{
    const target=new URL(url);requests.push({url:target.href,method:options.method||'GET',contentType:options.headers?.['Content-Type']});
    if(target.href==='https://accounts.feishu.cn/oauth/v3/token') {calls.refresh++;return currentRefresh(options);}
    if(target.href==='https://open.feishu.cn/open-apis/authen/v2/oauth/token') {calls.code++;return currentCode(options);}
    if(target.href==='https://open.feishu.cn/open-apis/authen/v1/user_info') {calls.userInfo++;return currentUserInfo(options);}
    if(target.pathname===`/open-apis/calendar/v4/calendars/${CAL}`) {calls.calendar++;return response({code:0,data:{calendar:{role:'reader'}}});}
    if(target.pathname===`/open-apis/calendar/v4/calendars/${CAL}/events`) {calls.events++;return currentEvents(options);}
    calls.other++;throw error('synthetic_unexpected_endpoint');
  };
  const injected=fsFactory?.({storePath,folder,calls});
  const opts={appId:APP,appSecret:SECRET,calendarId:CAL,expectedOpenId:OWNER,ownerLabel:'合成本人',
    redirectUri:'https://fixture.invalid/calendar/callback',storePath,encryptionKey:KEY.toString('base64'),fetchImpl,now:()=>CLOCK,
    diagnostic:item=>diagnostics.push(item),...(injected?.fsImpl?injected:injected?{fsImpl:injected}:{})};
  const reader=()=>createCalendarUserReader(opts);
  return {folder,storePath,calls,diagnostics,requests,opts,reader:reader(),restart:reader,
    setRefresh:value=>{currentRefresh=value;},setCode:value=>{currentCode=value;},setUserInfo:value=>{currentUserInfo=value;},setEvents:value=>{currentEvents=value;}};
}
async function holdBlocksEveryPath(ctx){
  const refreshed=ctx.calls.refresh,eventReads=ctx.calls.events,calendarReads=ctx.calls.calendar;
  for(const reader of [ctx.reader,ctx.restart()]){
    const status=await reader.status();assert.equal(status.authorized,false,'hold cannot be public authorized');publicOnly(status);
    await rejected(reader.get(eventPath));await rejected(reader.verifyCalendar(CAL));
    assert.equal(ctx.calls.refresh,refreshed,'hold never retries one-use refresh');
    assert.equal(ctx.calls.events,eventReads,'hold never makes another event API request');assert.equal(ctx.calls.calendar,calendarReads,'hold never makes another calendar verification API request');
  }
  for(const diagnostic of ctx.diagnostics)publicOnly(diagnostic);
}
function filesystemFault(mode,control){
  return ({storePath,folder,calls})=>{
    const holdPath=`${storePath}.refresh-hold.json`,lockPath=`${storePath}.lock`;
    const holdTemp=path=>String(path).startsWith(holdPath+'.')&&String(path).endsWith('.tmp');
    const credentialTemp=path=>String(path).startsWith(storePath+'.')&&!holdTemp(path)&&String(path).endsWith('.tmp');
    const hit=()=>{control.hits=(control.hits||0)+1;throw error('EIO');};
    const fsImpl={...fs,
      async open(path,...args){
        if(mode==='intent-open'&&holdTemp(path))hit();
        const file=await fs.open(path,...args);
        return {
          async writeFile(...writeArgs){if(mode==='intent-write'&&holdTemp(path)||mode==='credential-write'&&credentialTemp(path)&&calls.refresh>0)hit();return file.writeFile(...writeArgs);},
          async sync(){if(mode==='intent-file-fsync'&&holdTemp(path)||mode==='credential-file-fsync'&&credentialTemp(path)&&calls.refresh>0)hit();return file.sync();},
          async close(){return file.close();},
        };
      },
      async rename(from,to){if(mode==='intent-rename'&&to===holdPath||mode==='credential-rename'&&to===storePath&&calls.refresh>0)hit();return fs.rename(from,to);},
      async readFile(path,...args){
        const value=await fs.readFile(path,...args);
        if(path===holdPath){
          if(mode==='intent-readback-malformed'){control.hits=(control.hits||0)+1;return '{synthetic invalid JSON';}
          if(mode==='intent-readback-duplicate-decoded-key'){control.hits=(control.hits||0)+1;return value.replace(/"kind":/u,'"kind":"synthetic_tamper","k\\u0069nd":');}
        }
        if(path===storePath&&calls.refresh>0){
          if(mode==='credential-readback-failure')hit();
          if(mode==='credential-readback-conflict'){control.hits=(control.hits||0)+1;return encrypted({...record(true),openId:'ou_fixtureWrong'});}
        }
        if(path===storePath&&calls.code>0&&mode==='complete-readback-failure')hit();
        return value;
      },
      async unlink(path){if(mode==='clear-unlink'&&path===holdPath)hit();const result=await fs.unlink(path);if(path===holdPath)control.holdUnlinked=true;return result;},
      async rmdir(path,...args){if(mode==='lock-rmdir'&&path===lockPath)hit();return fs.rmdir(path,...args);},
    };
    const directorySyncImpl=async path=>{
      assert.equal(path,folder);control.dirSyncCalls=(control.dirSyncCalls||0)+1;
      if(mode==='intent-dir-fsync'&&calls.refresh===0||mode==='credential-dir-fsync'&&calls.refresh>0&&!control.holdUnlinked||mode==='clear-dir-fsync'&&control.holdUnlinked)hit();
      // This deliberately injects the Linux durability boundary on Windows;
      // actual native Linux fsync is separate from this synthetic fault suite.
    };
    return {fsImpl,directorySyncImpl};
  };
}

test('selected refresh module pins before import',()=>{if(process.env.WIS_READER_REFRESH_SHA)assert.equal(moduleSha,process.env.WIS_READER_REFRESH_SHA);});
test('normal synthetic refresh saves encrypted rotated grant before event API and can restart',async t=>{
  const ctx=await fixture(t);await ctx.reader.get(eventPath);assert.equal(ctx.calls.refresh,1);assert.equal(ctx.calls.events,1);
  const saved=decrypted(await fs.readFile(ctx.storePath,'utf8'));assert.equal(saved.accessToken===NEW_ACCESS&&saved.refreshToken===NEW_REFRESH,true,'rotated synthetic grant persisted');
  await ctx.restart().get(eventPath);assert.equal(ctx.calls.refresh,1,'saved fresh grant does not rotate twice');assert.equal(ctx.calls.events,2);
  publicOnly(await ctx.reader.status());for(const item of ctx.diagnostics)publicOnly(item);
});
for(const [label,refreshResult] of [
  ['network throws after request accepted',async()=>{throw error('ECONNRESET');}],
  ['secret-bearing network cause is not exposed',async()=>{throw error('ECONNRESET',`synthetic transport echo ${OLD_REFRESH}`);}],
  ['timeout result unknown',async()=>{throw new DOMException('synthetic timeout','TimeoutError');}],
  ['non JSON 2xx',async()=>({ok:true,status:200,headers:{get:()=>null},json:async()=>{throw new SyntaxError('synthetic non JSON');}})],
  ['unknown successful shape',async()=>response({success:true,access_token:NEW_ACCESS,refresh_token:NEW_REFRESH})],
  ['missing access token',async()=>response(grant({access_token:''}))],
  ['missing refresh token',async()=>response(grant({refresh_token:''}))],
  ['access token object unknown shape',async()=>response(grant({access_token:{opaque:NEW_ACCESS}}))],
  ['refresh token array unknown shape',async()=>response(grant({refresh_token:[NEW_REFRESH]}))],
  ['access token contains invalid header line break',async()=>response(grant({access_token:'synthetic_prefix\r\nsynthetic_suffix'}))],
  ['refresh token contains NUL control character',async()=>response(grant({refresh_token:'synthetic_prefix\u0000synthetic_suffix'}))],
  ['wrong required scope',async()=>response(grant({scope:'calendar:calendar:read offline_access'}))],
  ['invalid access expiry',async()=>response(grant({expires_in:0}))],
  ['invalid refresh expiry',async()=>response(grant({refresh_token_expires_in:NaN}))],
  ['access expiry multiplication overflow',async()=>response(grant({expires_in:1e306}))],
  ['refresh expiry multiplication overflow',async()=>response(grant({refresh_token_expires_in:1e306}))],
  ['upstream rejected consumed grant',async()=>response({code:20003,msg:OLD_REFRESH},400)],
])test(`one-use refresh unknown quarantines status/get/verify/restart: ${label}`,async t=>{
  const ctx=await fixture(t,{refreshResult});await rejected(ctx.reader.get(eventPath));assert.equal(ctx.calls.refresh,1);await holdBlocksEveryPath(ctx);
});
test('begin new OAuth is only pending attempt and cannot unlock existing refresh hold',async t=>{
  const ctx=await fixture(t,{refreshResult:async()=>{throw error('ECONNRESET');}});await rejected(ctx.reader.get(eventPath));
  const started=ctx.reader.begin(),url=new URL(started.url);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('scope'),SCOPE);
  await holdBlocksEveryPath(ctx);assert.equal(ctx.calls.code,0);
});
test('cached access grant cannot bypass an existing hold in another reader instance',async t=>{
  const ctx=await fixture(t,{refreshResult:async()=>{throw error('ECONNRESET');}});await rejected(ctx.reader.get(eventPath));
  await fs.writeFile(ctx.storePath,encrypted(record(true)),{mode:0o600});await holdBlocksEveryPath(ctx);
});
test('malformed state/PKCE cannot contact OAuth or lift hold',async t=>{
  const ctx=await fixture(t,{refreshResult:async()=>{throw error('ECONNRESET');}});await rejected(ctx.reader.get(eventPath));
  const started=ctx.reader.begin();await rejected(ctx.reader.complete({code:CODE,state:started.state,cookieState:'wrong_cookie_state'}),['calendar_oauth_state_invalid']);
  assert.equal(ctx.calls.code,0);await holdBlocksEveryPath(ctx);
});
test('unknown refresh lock is not automatically recovered by a new otherwise valid complete attempt',async t=>{
  const ctx=await fixture(t,{refreshResult:async()=>{throw error('ECONNRESET');}});await rejected(ctx.reader.get(eventPath));
  const attempt=ctx.reader.begin();await rejected(ctx.reader.complete({code:CODE,state:attempt.state,cookieState:attempt.state}));
  assert.equal(ctx.calls.code,0,'unknown previous rotation is not retried or unlocked by code exchange');
  await holdBlocksEveryPath(ctx);
});
test('fresh synthetic complete without a hold keeps V2 PKCE and exact owner then encrypted save',async t=>{
  const ctx=await fixture(t),attempt=ctx.reader.begin(),url=new URL(attempt.url);let checked=false;
  ctx.setCode(options=>{
    assert.equal(options.headers['Content-Type'],'application/json; charset=utf-8');
    const payload=JSON.parse(options.body);
    assert.equal(payload.grant_type,'authorization_code');assert.equal(payload.redirect_uri,'https://fixture.invalid/calendar/callback');
    assert.equal(payload.scope,SCOPE);assert.equal(payload.code===CODE,true);
    assert.match(payload.code_verifier,/^[A-Za-z0-9._~-]{43,128}$/u);
    assert.equal(createHash('sha256').update(payload.code_verifier).digest('base64url')===url.searchParams.get('code_challenge'),true,'actual generated verifier consumes S256 challenge');
    checked=true;return response(grant());
  });
  const status=await ctx.reader.complete({code:CODE,state:attempt.state,cookieState:attempt.state});
  assert.equal(checked,true);assert.equal(status.authorized,true);publicOnly(status);
  assert.equal(ctx.calls.code,1);assert.equal(ctx.calls.refresh,0);assert.equal(ctx.calls.userInfo,1);assert.equal(ctx.calls.calendar,1);
  const saved=decrypted(await fs.readFile(ctx.storePath,'utf8'));assert.equal(saved.openId,OWNER);
});
test('fresh authorization by wrong user never overwrites original encrypted credentials',async t=>{
  const ctx=await fixture(t),before=await fs.readFile(ctx.storePath,'utf8'),attempt=ctx.reader.begin();
  ctx.setUserInfo(()=>response({code:0,data:{open_id:'ou_fixtureWrongPerson'}}));
  await rejected(ctx.reader.complete({code:CODE,state:attempt.state,cookieState:attempt.state}),['calendar_oauth_wrong_user']);
  assert.equal(await fs.readFile(ctx.storePath,'utf8')===before,true,'wrong person cannot replace stored grant');assert.equal(ctx.calls.calendar,0);
});
for(const [label,override] of [
  ['access token object',{access_token:{opaque:NEW_ACCESS}}],
  ['refresh token array',{refresh_token:[NEW_REFRESH]}],
  ['scope array coerces to the original requested scope',{scope:[SCOPE]}],
  ['access expiry overflow',{expires_in:1e306}],
  ['refresh expiry overflow',{refresh_token_expires_in:1e306}],
  ['access token CRLF',{access_token:'synthetic_prefix\r\nsynthetic_suffix'}],
  ['refresh token NUL',{refresh_token:'synthetic_prefix\u0000synthetic_suffix'}],
])test(`initial code exchange rejects malformed grant before user_info or calendar GET: ${label}`,async t=>{
  const ctx=await fixture(t),before=await fs.readFile(ctx.storePath,'utf8'),attempt=ctx.reader.begin();ctx.setCode(()=>response(grant(override)));
  await rejected(ctx.reader.complete({code:CODE,state:attempt.state,cookieState:attempt.state}));
  assert.equal(ctx.calls.code,1);assert.equal(ctx.calls.refresh,0);
  assert.equal(ctx.calls.userInfo,0,'malformed code grant cannot reach first user_info GET');assert.equal(ctx.calls.calendar,0,'cannot verify calendar with invalid grant');
  assert.equal(await fs.readFile(ctx.storePath,'utf8')===before,true,'malformed exchange cannot overwrite original credential');
});
for(const [label,eventResult] of [
  ['ordinary upstream rejection',()=>response({code:99991672,msg:'synthetic denied'},403)],
  ['ordinary transport failure',async()=>{throw error('ECONNRESET');}],
])test(`non-rotating event GET failure does not permanently quarantine a known cached grant: ${label}`,async t=>{
  const ctx=await fixture(t,{cached:true});ctx.setEvents(eventResult);await rejected(ctx.reader.get(eventPath));assert.equal(ctx.calls.refresh,0);
  assert.equal((await ctx.reader.status()).authorized,true);assert.equal((await ctx.restart().status()).authorized,true);
  ctx.setEvents(()=>response({code:0,data:{items:[],has_more:false}}));await ctx.restart().get(eventPath);assert.equal(ctx.calls.refresh,0);
});
test('same reader concurrency admits at most one refresh POST and does not strand successful credentials',async t=>{
  const ctx=await fixture(t);const results=await Promise.allSettled(Array.from({length:12},()=>ctx.reader.get(eventPath)));
  assert.equal(ctx.calls.refresh,1);assert.equal(results.some(result=>result.status==='fulfilled'),true);
  assert.equal((await ctx.restart().status()).authorized,true);await ctx.restart().get(eventPath);assert.equal(ctx.calls.refresh,1);
});
test('separate reader instance cannot use cached token or rotate during shared store refresh lock',async t=>{
  let started,release;const began=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const ctx=await fixture(t,{refreshResult:async()=>{started();await gate;return response(grant());}}),second=ctx.restart();
  const active=ctx.reader.get(eventPath);await began;
  try {assert.equal((await second.status()).authorized,false);await rejected(second.get(eventPath));assert.equal(ctx.calls.refresh,1);assert.equal(ctx.calls.events,0);}
  finally {release();}
  await active;assert.equal((await second.status()).authorized,true);await second.get(eventPath);assert.equal(ctx.calls.refresh,1);
});
test('path allowlist is still enforced before a blocked grant is consulted',async t=>{
  const ctx=await fixture(t);await rejected(ctx.reader.get(`/calendar/v4/calendars/${OTHER_CAL}/events`),['calendar_path_denied']);
  await rejected(ctx.reader.get(`/calendar/v4/calendars/${CAL}/events?unexpected=1`),['calendar_path_denied']);
  assert.equal(Object.values(ctx.calls).every(n=>n===0),true,'denied path performs no network request');
});
for(const mode of ['intent-open','intent-write','intent-file-fsync','intent-rename','intent-dir-fsync','intent-readback-malformed','intent-readback-duplicate-decoded-key'])
  test(`refresh intent must be durable and exact before one-use POST: ${mode}`,async t=>{
    const control={},ctx=await fixture(t,{fsFactory:filesystemFault(mode,control)});await rejected(ctx.reader.get(eventPath));
    assert.equal(control.hits>0,true,'independent fault injection actually reached');assert.equal(ctx.calls.refresh,0,'unverified intent cannot consume grant');
    assert.equal(ctx.calls.events,0);await holdBlocksEveryPath(ctx);
    assert.equal((await fs.stat(`${ctx.storePath}.lock`)).isDirectory(),true,'lock remains fail-closed even when intent did not persist');
  });
for(const mode of ['credential-write','credential-file-fsync','credential-rename','credential-dir-fsync','credential-readback-failure','credential-readback-conflict','clear-unlink','clear-dir-fsync'])
  test(`successful one-use grant still quarantines after save/clear uncertainty: ${mode}`,async t=>{
    const control={},ctx=await fixture(t,{fsFactory:filesystemFault(mode,control)});await rejected(ctx.reader.get(eventPath));
    assert.equal(control.hits>0,true,'independent fault injection actually reached');assert.equal(ctx.calls.refresh,1);assert.equal(ctx.calls.events,0);
    await holdBlocksEveryPath(ctx);assert.equal((await fs.stat(`${ctx.storePath}.lock`)).isDirectory(),true,'another instance observes persistent anchor');
    if(mode==='clear-dir-fsync'){
      assert.equal(control.holdUnlinked,true,'dangerous clear actually unlinked before dirfsync fault');
      await assert.rejects(fs.stat(`${ctx.storePath}.refresh-hold.json`),cause=>cause.code==='ENOENT');
      assert.equal((await ctx.restart().status()).authorized,false,'missing marker does not bypass surviving operation lock');
    }
  });
test('complete does not declare authorization from memory if encrypted save cannot be read back',async t=>{
  const control={},ctx=await fixture(t,{fsFactory:filesystemFault('complete-readback-failure',control)}),attempt=ctx.reader.begin();
  await rejected(ctx.reader.complete({code:CODE,state:attempt.state,cookieState:attempt.state}));
  assert.equal(control.hits>0,true,'actual complete validates encrypted storage readback');assert.equal(ctx.calls.code,1);assert.equal(ctx.calls.refresh,0);
});
test('lock removal uncertainty is observed by restart and future cached paths',async t=>{
  const control={},ctx=await fixture(t,{fsFactory:filesystemFault('lock-rmdir',control)});await rejected(ctx.reader.get(eventPath));
  assert.equal(control.hits>0,true);assert.equal(ctx.calls.refresh,1);assert.equal(ctx.calls.events,1,'grant/save/clear were verified before ordinary read');
  await holdBlocksEveryPath(ctx);assert.equal((await fs.stat(`${ctx.storePath}.lock`)).isDirectory(),true);
});
for(const marker of ['{broken synthetic JSON','',JSON.stringify({schemaVersion:99,kind:'other'}),JSON.stringify({schemaVersion:1,kind:'calendar_refresh_intent',contextSha256:'0'.repeat(64),attemptId:'0'.repeat(32),createdAt:'2000-01-01T00:00:00.000Z'})])
  test(`preexisting malformed/stale/foreign marker is not blindly deleted ${marker.length}`,async t=>{
    const ctx=await fixture(t,{cached:true}),path=`${ctx.storePath}.refresh-hold.json`;await fs.writeFile(path,marker,{mode:0o600});
    await holdBlocksEveryPath(ctx);assert.equal(await fs.readFile(path,'utf8')===marker,true,'not a cleanup or inferred recovery authority');assert.equal(ctx.calls.refresh,0);
  });
test('preexisting stale lock without marker blocks cached GET and status',async t=>{
  const ctx=await fixture(t,{cached:true});await fs.mkdir(`${ctx.storePath}.lock`);await holdBlocksEveryPath(ctx);assert.equal(ctx.calls.refresh,0);
});
test('unknown result marker is strictly metadata-only and encrypted credentials stay opaque',async t=>{
  const ctx=await fixture(t,{refreshResult:async()=>{throw error('ECONNRESET');}});await rejected(ctx.reader.get(eventPath));
  const raw=await fs.readFile(`${ctx.storePath}.refresh-hold.json`,'utf8'),marker=JSON.parse(raw);
  assert.deepEqual(Object.keys(marker).sort(),['attemptId','contextSha256','createdAt','kind','schemaVersion'].sort());publicOnly(marker);
  publicOnly(await fs.readFile(ctx.storePath,'utf8'));assert.equal(unsafeSecrets.some(secret=>raw.includes(secret)),false);
  assert.equal((await fs.readdir(ctx.folder)).some(name=>name===basename(ctx.storePath)+'.lock'),true);
});
for(const [mode,expectedCode,expectedStage] of [
  ['request-result-unknown',23,'synthetic_refresh_invoked_result_unknown'],
  ['after-grant-before-save',24,'synthetic_grant_returned_before_save'],
  ['after-unlink-before-dirsync',25,'synthetic_hold_unlinked_before_dirsync'],
])test(`terminated synthetic worker leaves observable cross-process quarantine: ${mode}`,async t=>{
  const ctx=await fixture(t),messages=[],worker=fileURLToPath(new URL('./crash-worker.mjs',import.meta.url));
  const child=spawn(process.execPath,[worker,modulePath,ctx.storePath,mode],{env:{...process.env,WIS_READER_REFRESH_SHA:moduleSha},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  const result=await new Promise((resolveExit,rejectExit)=>{
    const timer=setTimeout(()=>{child.kill();rejectExit(new Error('synthetic crash worker exceeded local test timeout'));},5000);
    child.on('message',message=>messages.push(message));child.once('error',cause=>{clearTimeout(timer);rejectExit(cause);});
    child.once('exit',(code,signal)=>{clearTimeout(timer);resolveExit({code,signal});});
  });
  assert.equal(result.code,expectedCode);assert.equal(messages.some(message=>message.stage===expectedStage),true,'worker really reached requested crash point');
  assert.equal((await fs.stat(`${ctx.storePath}.lock`)).isDirectory(),true,'new process observes persistent anchor');
  if(mode==='after-unlink-before-dirsync')await assert.rejects(fs.stat(`${ctx.storePath}.refresh-hold.json`),cause=>cause.code==='ENOENT');
  await holdBlocksEveryPath(ctx);assert.equal(ctx.calls.refresh,0,'fresh process never blindly reuses synthetic consumed grant');assert.equal(ctx.calls.events,0);
});
