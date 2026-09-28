// Independent synthetic public-entry tests. No live OAuth, grant or application startup.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

globalThis.fetch=async()=>{throw new Error('synthetic code-exchange suite refuses live network');};
const oldModule='H:/codex输出/直播五环节工作流-20260923/calendar-readernative-exact-20260928/candidate-2320/native-reader/calendar-user-reader.mjs';
const modulePath=process.env.WIS_CODEEXCHANGE_MODULE || oldModule;
const expectedSha=process.env.WIS_CODEEXCHANGE_SHA || '61bb609a713da635eab0e03c60b2f862f3846131c0176c11cebef423061947aa';
const moduleSha=createHash('sha256').update(readFileSync(modulePath)).digest('hex');
assert.equal(moduleSha,expectedSha,'selected reader raw SHA must match before importing it');
const {createCalendarUserReader}=await import(pathToFileURL(modulePath).href);
const APP='cli_syntheticCodeOnly',SECRET='synthetic_APP_SECRET_never_real';
const CAL='calendar_synthetic_code_only',ACTOR='ou_synthetic_code_owner';
const KEY=Buffer.alloc(32,37).toString('base64');
const CLOCK=Date.parse('2026-09-28T15:45:00.000Z');
const SCOPE='calendar:calendar:read calendar:calendar.event:read offline_access';
const CODE='synthetic_AUTH_CODE_never_real',ACCESS='synthetic_ACCESS_never_real',REFRESH='synthetic_REFRESH_never_real';
const CODE_URL='https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const USER_URL='https://open.feishu.cn/open-apis/authen/v1/user_info';
const EVENT_PATH='/calendar/v4/calendars/'+CAL+'/events?start_time=1790500000&end_time=1790600000&page_size=50';
const markerKeys=['schemaVersion','kind','contextSha256','attemptId','createdAt'].sort();
const response=data=>({ok:true,status:200,headers:{get:()=>null},json:async()=>data});
const grant=()=>({code:0,access_token:ACCESS,refresh_token:REFRESH,expires_in:3600,refresh_token_expires_in:86400,scope:SCOPE});
const fault=(kind='synthetic_io_fault')=>Object.assign(new Error(kind),{code:'EIO'});
const rejected=promise=>assert.rejects(promise);
const exists=async path=>{try{await fs.stat(path);return true;}catch(cause){if(cause.code==='ENOENT')return false;throw cause;}};
function safeOnly(value,secrets=[]){
  const text=typeof value==='string'?value:JSON.stringify(value);
  for(const secret of [CODE,SECRET,ACCESS,REFRESH,KEY,...secrets])assert.equal(text.includes(secret),false,'error/diagnostic/metadata must not disclose synthetic secret');
}
async function fixture(t,options={}){
  const folder=await fs.mkdtemp(join(tmpdir(),'wis-codeexchange-independent-'));
  const storePath=join(folder,'grant.json'),codeHold=storePath+'.code-hold.json',lock=storePath+'.lock';
  t.after(async()=>{
    const resolved=resolve(folder),boundary=resolve(tmpdir())+sep;
    assert.ok(resolved.startsWith(boundary)&&basename(resolved).startsWith('wis-codeexchange-independent-'));
    await fs.rm(resolved,{recursive:true,force:true});
  });
  const calls={code:0,user:0,calendar:0,event:0,refresh:0};
  const messages=[],requests=[],state={posted:false,saved:false,unlinked:false,intentWrites:0,grantWrites:0};
  let clock=CLOCK;
  const context={folder,storePath,codeHold,lock,calls,messages,requests,state,clock:()=>clock,setClock:value=>{clock=value;}};
  const hooks=options.fsHooks?options.fsHooks(context):{};
  const fsImpl={...fs,...hooks};
  const fetchImpl=async(url,request={})=>{
    const parsed=new URL(url);requests.push({url:parsed.href,method:request.method||'GET'});
    if(parsed.href===CODE_URL){
      calls.code++;state.posted=true;
      return options.codeResult?options.codeResult(context,request):response(grant());
    }
    if(parsed.href==='https://accounts.feishu.cn/oauth/v3/token'){calls.refresh++;throw fault('synthetic refresh must not be called by code exchange');}
    if(parsed.href===USER_URL){calls.user++;return options.userResult?options.userResult(context):response({code:0,data:{open_id:ACTOR}});}
    if(parsed.pathname.endsWith('/events')){calls.event++;return options.eventResult?options.eventResult(context):response({code:0,data:{items:[]}});}
    if(parsed.href==='https://open.feishu.cn/open-apis/calendar/v4/calendars/'+CAL){
      calls.calendar++;return options.calendarResult?options.calendarResult(context):response({code:0,data:{role:'reader'}});
    }
    throw fault('synthetic fixture rejected an unexpected request');
  };
  context.makeReader=()=>createCalendarUserReader({appId:APP,appSecret:SECRET,calendarId:CAL,expectedOpenId:ACTOR,ownerLabel:'合成授权人',
    redirectUri:'https://fixture.invalid/readonly-code-callback',storePath,encryptionKey:KEY,fetchImpl,fsImpl,
    directorySyncImpl:options.directorySync?path=>options.directorySync(context,path):async()=>{},now:()=>clock,
    diagnostic:item=>{messages.push(item);if(options.diagnostic)options.diagnostic(item);},allowNativeSource:true});
  context.reader=context.makeReader();
  context.complete=(reader=context.reader,code=CODE)=>{
    const attempt=reader.begin();context.lastAttempt=attempt;
    return reader.complete({code,state:attempt.state,cookieState:attempt.state});
  };
  return context;
}
async function holdBlocks(ctx){
  const before={...ctx.calls};
  for(const reader of [ctx.reader,ctx.makeReader()]){
    const status=await reader.status();
    assert.equal(status.authorized,false,'an unknown code result cannot expose a successful cached authorization');
    assert.equal(status.status,'recovery_required');
    assert.equal(status.recoveryRequired,true);
    await rejected(ctx.complete(reader,'synthetic_fresh_code_but_same_unknown_store'));
    await rejected(reader.get(EVENT_PATH));
    await rejected(reader.verifyCalendar(CAL));
    await rejected(reader.getNative({kind:'metadata',calendarId:CAL}));
  }
  assert.deepEqual(ctx.calls,before,'same-store restarted/cached/status/GET/native/verify cannot make a new HTTP call');
  assert.equal(await exists(ctx.lock)||await exists(ctx.codeHold),true,'at least one persistent anchor survives for a fresh process');
}
function instrumentFiles(ctx,selected){
  return {
    async open(path,...args){
      const p=String(path),isIntent=p.startsWith(ctx.codeHold+'.')&&args[0]==='wx';
      const isGrant=p.startsWith(ctx.storePath+'.')&&!isIntent&&!p.startsWith(ctx.storePath+'.refresh-hold.json.')&&args[0]==='wx';
      if(selected==='intent-open'&&isIntent)throw fault();
      if(selected==='grant-open'&&isGrant&&ctx.state.posted)throw fault();
      const handle=await fs.open(path,...args);
      return {
        async writeFile(data,...writeArgs){
          if(isIntent)ctx.state.intentWrites++;
          if(isGrant)ctx.state.grantWrites++;
          if(selected==='intent-write'&&isIntent)throw fault();
          if(selected==='grant-write'&&isGrant)throw fault();
          await handle.writeFile(data,...writeArgs);
          if(selected==='intent-write-after'&&isIntent)throw fault();
          if(selected==='grant-write-after'&&isGrant)throw fault();
        },
        async sync(){
          if(selected==='intent-fsync'&&isIntent)throw fault();
          if(selected==='grant-fsync'&&isGrant)throw fault();
          await handle.sync();
          if(selected==='intent-fsync-after'&&isIntent)throw fault();
          if(selected==='grant-fsync-after'&&isGrant)throw fault();
        },
        async close(){await handle.close();if(selected==='intent-close-after'&&isIntent)throw fault();},
      };
    },
    async rename(from,to){
      const isIntent=to===ctx.codeHold,isGrant=to===ctx.storePath;
      if(selected==='intent-rename'&&isIntent)throw fault();
      if(selected==='grant-rename'&&isGrant)throw fault();
      await fs.rename(from,to);if(isGrant)ctx.state.saved=true;
      if(selected==='intent-rename-after'&&isIntent)throw fault();
      if(selected==='grant-rename-after'&&isGrant)throw fault();
    },
    async readFile(path,...args){
      if(selected==='intent-readback'&&path===ctx.codeHold)throw fault();
      const raw=await fs.readFile(path,...args);
      if(selected==='intent-duplicate-readback'&&path===ctx.codeHold)return String(raw).replace('"kind":','"\\u006bind":"calendar_code_exchange_intent","kind":');
      if(selected==='grant-readback'&&path===ctx.storePath&&ctx.state.saved)throw fault();
      return raw;
    },
    async unlink(path){
      if(selected==='hold-unlink-before'&&path===ctx.codeHold)throw fault();
      await fs.unlink(path);if(path===ctx.codeHold)ctx.state.unlinked=true;
      if(selected==='hold-unlink-after'&&path===ctx.codeHold)throw fault();
    },
    async rmdir(path){
      if(selected==='lock-rmdir-before'&&path===ctx.lock)throw fault();
      await fs.rmdir(path);
      if(selected==='lock-rmdir-after'&&path===ctx.lock)throw fault();
    },
  };
}

test('selected reader is strictly pinned and fixture never delegates to a live fetch',()=>assert.equal(moduleSha,expectedSha));
test('positive exchange keeps exact JSON v2 PKCE/scopes and saves encrypted readback',async t=>{
  const ctx=await fixture(t,{codeResult:async(c,request)=>{
    assert.equal(request.method,'POST');assert.equal(request.redirect,'error');
    assert.equal(request.headers['Content-Type'],'application/json; charset=utf-8');
    const payload=JSON.parse(request.body),url=new URL(c.lastAttempt.url);
    assert.equal(payload.grant_type,'authorization_code');assert.equal(payload.code,CODE);
    assert.equal(payload.client_id,APP);assert.equal(payload.client_secret,SECRET);
    assert.equal(payload.scope,SCOPE);assert.equal(payload.redirect_uri,'https://fixture.invalid/readonly-code-callback');
    assert.equal(createHash('sha256').update(payload.code_verifier).digest('base64url'),url.searchParams.get('code_challenge'));
    return response(grant());
  }});
  const status=await ctx.complete();assert.equal(status.authorized,true);
  assert.deepEqual(ctx.calls,{code:1,user:1,calendar:1,event:0,refresh:0});
  assert.equal(await exists(ctx.codeHold),false);assert.equal(await exists(ctx.lock),false);
  safeOnly(await fs.readFile(ctx.storePath,'utf8'));
  assert.equal((await ctx.makeReader().status()).authorized,true);
});
test('durable metadata-only code intent and lock are present and readable before POST',async t=>{
  const ctx=await fixture(t,{codeResult:async c=>{
    assert.equal((await fs.stat(c.lock)).isDirectory(),true);
    const raw=await fs.readFile(c.codeHold,'utf8'),marker=JSON.parse(raw);
    assert.deepEqual(Object.keys(marker).sort(),markerKeys);
    assert.equal(marker.schemaVersion,1);assert.equal(marker.kind,'calendar_code_exchange_intent');
    assert.equal(marker.contextSha256,createHash('sha256').update(Buffer.from(JSON.stringify([APP,CAL,ACTOR]))).digest('hex'));
    assert.match(marker.attemptId,/^[a-f0-9]{32}$/u);assert.equal(marker.createdAt,new Date(CLOCK).toISOString());
    safeOnly(raw,[c.lastAttempt.state]);assert.equal(Object.hasOwn(marker,'postInvoked'),false);
    if(process.platform!=='win32')assert.equal((await fs.stat(c.codeHold)).mode&0o077,0);
    throw fault('synthetic result is unknown');
  }});
  await rejected(ctx.complete());assert.equal(ctx.calls.code,1);await holdBlocks(ctx);
});

for(const mode of ['intent-open','intent-write','intent-write-after','intent-fsync','intent-fsync-after','intent-close-after','intent-rename','intent-rename-after','intent-readback','intent-duplicate-readback'])
test('intent persistence/readback failure occurs before any POST and remains held: '+mode,async t=>{
  const ctx=await fixture(t,{fsHooks:c=>instrumentFiles(c,mode)});
  await rejected(ctx.complete());assert.equal(ctx.calls.code,0);assert.equal(ctx.calls.user,0);await holdBlocks(ctx);
});
test('intent directory fsync rejection permits zero POST and no restart retry',async t=>{
  const ctx=await fixture(t,{directorySync:async c=>{if(!c.state.posted)throw fault();}});
  await rejected(ctx.complete());assert.equal(ctx.calls.code,0);await holdBlocks(ctx);
});

const badOutcomes=[
  ['network throw',async()=>{throw new Error('synthetic network body '+CODE+' '+SECRET);}],
  ['invalid JSON',async()=>({ok:true,status:200,headers:{get:()=>null},json:async()=>{throw fault();}})],
  ['HTTP 500',async()=>({ok:false,status:500,headers:{get:()=>null},json:async()=>({code:500,access_token:ACCESS,refresh_token:REFRESH})})],
  ['known upstream rejection',async()=>({ok:true,status:200,headers:{get:()=>null},json:async()=>({code:20003})})],
  ['object access token',async()=>response({...grant(),access_token:{bad:ACCESS}})],
  ['array refresh token',async()=>response({...grant(),refresh_token:[REFRESH]})],
  ['array scope',async()=>response({...grant(),scope:[SCOPE]})],
  ['unsafe access expiry',async()=>response({...grant(),expires_in:1e306})],
  ['unsafe refresh expiry',async()=>response({...grant(),refresh_token_expires_in:1e306})],
  ['access token control',async()=>response({...grant(),access_token:'synthetic\r\naccess'})],
  ['refresh token control',async()=>response({...grant(),refresh_token:'synthetic\u0000refresh'})],
];
for(const [name,codeResult] of badOutcomes)test('after invoking one-use code request, no automatic retry after '+name,async t=>{
  const ctx=await fixture(t,{codeResult});let cause;
  try{await ctx.complete();assert.fail('expected unknown code result to reject');}catch(error){cause=error;}
  assert.equal(ctx.calls.code,1);assert.equal(ctx.calls.user,0);
  safeOnly({message:cause.message,code:cause.code,diagnostic:cause.diagnostic});safeOnly(ctx.messages);
  await holdBlocks(ctx);
});
for(const [name,userResult,calendarResult] of [
  ['userinfo network failure',async()=>{throw fault();},null],
  ['identity mismatch',async()=>response({code:0,data:{open_id:'ou_synthetic_different_person'}}),null],
  ['invalid user identity shape',async()=>response({code:0,data:{open_id:{bad:ACTOR}}}),null],
  ['calendar permission failure',null,async()=>response({code:0,data:{role:'free_busy_reader'}})],
  ['calendar read error',null,async()=>{throw fault();}],
])test('consumed code remains held after '+name,async t=>{
  const ctx=await fixture(t,{userResult,calendarResult});await rejected(ctx.complete());
  assert.equal(ctx.calls.code,1);await holdBlocks(ctx);
});

for(const mode of ['grant-open','grant-write','grant-write-after','grant-fsync','grant-fsync-after','grant-rename','grant-rename-after','grant-readback','hold-unlink-before','hold-unlink-after','lock-rmdir-before','lock-rmdir-after'])
test('save/readback/cleanup uncertainty remains held across new readers: '+mode,async t=>{
  const ctx=await fixture(t,{fsHooks:c=>instrumentFiles(c,mode)});
  await rejected(ctx.complete());assert.equal(ctx.calls.code,1);await holdBlocks(ctx);
});
for(const [name,predicate] of [
  ['grant rename directory sync',c=>c.state.saved&&!c.state.unlinked],
  ['intent unlink directory sync',c=>c.state.unlinked],
])test('directory fsync uncertainty after '+name+' does not release last anchor',async t=>{
  const ctx=await fixture(t,{fsHooks:c=>instrumentFiles(c,'none'),directorySync:async c=>{if(predicate(c))throw fault();}});
  await rejected(ctx.complete());assert.equal(ctx.calls.code,1);await holdBlocks(ctx);
});

test('same store multiple reader concurrency never invokes a second code POST while first is unresolved',async t=>{
  let enteredResolve,release;
  const entered=new Promise(resolveEntered=>{enteredResolve=resolveEntered;});
  const ctx=await fixture(t,{codeResult:async()=>{enteredResolve();return new Promise((_resolve,reject)=>{release=()=>reject(fault());});}});
  const first=ctx.complete().then(()=>({success:true}),cause=>({cause}));
  await entered;await rejected(ctx.complete(ctx.makeReader(),'synthetic_parallel_new_code'));
  assert.equal(ctx.calls.code,1);release();const result=await first;assert.ok(result.cause);await holdBlocks(ctx);
});
test('same attempt concurrently completed twice invokes at most one POST and cannot restart unknown',async t=>{
  const ctx=await fixture(t,{codeResult:async()=>{throw fault();}});
  const attempt=ctx.reader.begin(),input={code:CODE,state:attempt.state,cookieState:attempt.state};
  const results=await Promise.allSettled([ctx.reader.complete(input),ctx.reader.complete(input)]);
  assert.equal(results.filter(value=>value.status==='rejected').length,2);assert.equal(ctx.calls.code,1);await holdBlocks(ctx);
});
test('after a thrown one-use exchange a fresh same-store complete cannot invoke a second POST',async t=>{
  const ctx=await fixture(t,{codeResult:async()=>{throw fault('synthetic one-use result unknown');}});
  await rejected(ctx.complete());await rejected(ctx.complete(ctx.makeReader(),'synthetic_new_begin_is_not_recovery'));
  assert.equal(ctx.calls.code,1,'the second public complete is refused before another POST, without relying on status first');
});
test('known successful code exchange does not quarantine unrelated ordinary GET failure',async t=>{
  const ctx=await fixture(t,{eventResult:async()=>{throw fault();}});
  await ctx.complete();await rejected(ctx.reader.get(EVENT_PATH));
  assert.equal(await exists(ctx.lock),false);assert.equal(await exists(ctx.codeHold),false);
  assert.equal((await ctx.makeReader().status()).authorized,true);assert.equal(ctx.calls.code,1);
});
for(const [name,code] of [['object',{secret:CODE}],['array',[CODE]],['number',37],['NUL','synthetic\u0000code'],['CRLF','synthetic\r\ncode']])
test('invalid authorization code input rejects before one-use POST: '+name,async t=>{
  const ctx=await fixture(t);await rejected(ctx.complete(ctx.reader,code));assert.equal(ctx.calls.code,0);assert.equal(ctx.calls.user,0);
});
test('wrong callback state rejects without creating intent or making a request',async t=>{
  const ctx=await fixture(t),attempt=ctx.reader.begin();await rejected(ctx.reader.complete({code:CODE,state:attempt.state,cookieState:'synthetic_wrong_state'}));
  assert.equal(ctx.calls.code,0);assert.equal(await exists(ctx.codeHold),false);
});
test('expired callback rejects before one-use POST',async t=>{
  const ctx=await fixture(t),attempt=ctx.reader.begin();ctx.setClock(CLOCK+600001);
  await rejected(ctx.reader.complete({code:CODE,state:attempt.state,cookieState:attempt.state}));assert.equal(ctx.calls.code,0);
});
test('malformed pre-existing code hold is not auto-cleared or overwritten',async t=>{
  const ctx=await fixture(t);await fs.writeFile(ctx.codeHold,'{"malformed":true}','utf8');
  const before=await fs.readFile(ctx.codeHold);await rejected(ctx.complete());await holdBlocks(ctx);
  assert.deepEqual(await fs.readFile(ctx.codeHold),before);assert.equal(ctx.calls.code,0);
});
test('stale foreign code hold stays held without an invented recovery path',async t=>{
  const ctx=await fixture(t),raw=JSON.stringify({schemaVersion:1,kind:'calendar_code_exchange_intent',contextSha256:'f'.repeat(64),attemptId:'e'.repeat(32),createdAt:'2020-01-01T00:00:00.000Z'});
  await fs.writeFile(ctx.codeHold,raw,'utf8');await rejected(ctx.complete());await holdBlocks(ctx);
  assert.equal(await fs.readFile(ctx.codeHold,'utf8'),raw);assert.equal(ctx.calls.code,0);
});

for(const code of ['calendar_oauth_wrong_user','calendar_identity_unverified','calendar_detail_permission_missing',
  'calendar_path_denied','calendar_scope_missing','calendar_token_expiry_invalid','calendar_refresh_recovery_required','calendar_oauth_exchange_failed'])
test('fetch cannot forge a sanitized public error capability by copying its code: '+code,async t=>{
  const ctx=await fixture(t,{codeResult:async()=>{throw Object.assign(new Error('PRIVATE '+CODE+' '+SECRET),{code,diagnostic:{private:ACCESS}});}});
  let caught;try{await ctx.complete();assert.fail('unknown response must reject');}catch(cause){caught=cause;}
  safeOnly({message:caught.message,code:caught.code,diagnostic:caught.diagnostic});safeOnly(ctx.messages);await holdBlocks(ctx);
});
test('a previously genuine public error mutated by an external adapter cannot expose a private callback body',async t=>{
  let previous;
  const ctx=await fixture(t,{codeResult:async()=>{throw previous;}});
  try{await ctx.reader.get('/im/v1/messages');assert.fail('unapproved path must reject');}catch(cause){previous=cause;}
  assert.equal(previous.code,'calendar_path_denied');assert.equal(ctx.calls.code,0);
  previous.message='PRIVATE '+CODE+' '+SECRET;previous.diagnostic={private:ACCESS};
  let caught;try{await ctx.complete();assert.fail('unknown response must reject');}catch(cause){caught=cause;}
  safeOnly({message:caught.message,code:caught.code,diagnostic:caught.diagnostic});safeOnly(ctx.messages);await holdBlocks(ctx);
});
test('external diagnostic mutation is not reused as the public sanitized token diagnostic',async t=>{
  const ctx=await fixture(t,{codeResult:async()=>response({code:20003}),diagnostic:item=>{
    item.stage=CODE;item.privateBody=SECRET;item.requestId=ACCESS;
  }});
  let caught;try{await ctx.complete();assert.fail('upstream token rejection must reject');}catch(cause){caught=cause;}
  safeOnly({message:caught.message,code:caught.code,diagnostic:caught.diagnostic});await holdBlocks(ctx);
});
for(const kind of ['array','coercible-object'])
test('cookie state must be a primitive string, not a coercible container: '+kind,async t=>{
  const ctx=await fixture(t),attempt=ctx.reader.begin();
  const cookieState=kind==='array'?[attempt.state]:{toString:()=>attempt.state};
  await rejected(ctx.reader.complete({code:CODE,state:attempt.state,cookieState}));assert.equal(ctx.calls.code,0);
});
for(const [name,value] of [['NaN',NaN],['Infinity',Infinity],['clock rollback',CLOCK-1]])
test('invalid or regressed callback time rejects before the one-use request: '+name,async t=>{
  const ctx=await fixture(t),attempt=ctx.reader.begin();ctx.setClock(value);
  await rejected(ctx.reader.complete({code:CODE,state:attempt.state,cookieState:attempt.state}));assert.equal(ctx.calls.code,0);
});
test('oversized authorization code does not enter the one-use request',async t=>{
  const ctx=await fixture(t);await rejected(ctx.complete(ctx.reader,'x'.repeat(4097)));assert.equal(ctx.calls.code,0);
});
test('whitespace authorization code is not coerced into a valid grant request',async t=>{
  const ctx=await fixture(t);await rejected(ctx.complete(ctx.reader,'synthetic code with spaces'));assert.equal(ctx.calls.code,0);
});
for(const [name,next] of [['expired',CLOCK+600001],['NaN',NaN],['Infinity',Infinity],['future-created-at/clock-rollback',CLOCK-1]])
test('intent readback IO cannot bypass the last POST time guard: '+name,async t=>{
  const ctx=await fixture(t,{fsHooks:c=>({
    async readFile(path,...args){
      const raw=await fs.readFile(path,...args);
      if(path===c.codeHold)c.setClock(next);
      return raw;
    },
  })});
  await rejected(ctx.complete());assert.equal(ctx.calls.code,0);assert.equal(ctx.calls.user,0);await holdBlocks(ctx);
});
test('intent directory-sync delay beyond callback TTL blocks POST while keeping the existing hold',async t=>{
  const ctx=await fixture(t,{directorySync:async c=>{if(!c.state.posted)c.setClock(CLOCK+600001);}});
  await rejected(ctx.complete());assert.equal(ctx.calls.code,0);await holdBlocks(ctx);
});
test('exact ten-minute boundary after intent IO remains allowed and proves no unconditional expiration mock',async t=>{
  const ctx=await fixture(t,{fsHooks:c=>({
    async readFile(path,...args){const raw=await fs.readFile(path,...args);if(path===c.codeHold)c.setClock(CLOCK+600000);return raw;},
  })});
  const status=await ctx.complete();assert.equal(status.authorized,true);assert.equal(ctx.calls.code,1);
  assert.equal(await exists(ctx.codeHold),false);assert.equal(await exists(ctx.lock),false);
});

function workerEnv(){
  const safe={};
  for(const name of ['PATH','SystemRoot','SYSTEMROOT','ComSpec','TMPDIR','TMP','TEMP'])if(typeof process.env[name]==='string')safe[name]=process.env[name];
  return {...safe,WIS_CODEEXCHANGE_SHA:moduleSha};
}
function startWorker(ctx,mode){
  const worker=fileURLToPath(new URL('./codeexchange-crash-worker.mjs',import.meta.url));
  const child=spawn(process.execPath,[worker,modulePath,ctx.storePath,mode],{env:workerEnv(),stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  const messages=[];
  const ended=new Promise((resolveExit,rejectExit)=>{
    const timer=setTimeout(()=>{child.kill();rejectExit(new Error('synthetic code worker exceeded its five-second timeout'));},5000);
    child.on('message',message=>messages.push(message));
    child.once('error',cause=>{clearTimeout(timer);rejectExit(cause);});
    child.once('exit',(code,signal)=>{clearTimeout(timer);resolveExit({code,signal});});
  });
  return {child,messages,ended};
}
for(const [mode,exitCode,stage] of [
  ['intent-readback-before-post',23,'intent_readback_before_POST'],
  ['request-result-unknown',24,'code_POST_result_unknown'],
  ['userinfo-after-grant',25,'userinfo_after_code_grant'],
  ['grant-before-save',26,'verified_grant_before_save'],
  ['saved-before-readback',27,'saved_before_grant_readback'],
  ['hold-unlinked-before-dirsync',28,'code_hold_unlinked_before_dirsync'],
])test('actual synthetic child process crash keeps one-use quarantine: '+mode,async t=>{
  const ctx=await fixture(t),worker=startWorker(ctx,mode);t.after(()=>{if(worker.child.exitCode===null)worker.child.kill();});
  const result=await worker.ended;assert.equal(result.code,exitCode);
  assert.equal(worker.messages.some(message=>message.stage===stage),true,'the worker really reached the exact selected crash boundary');
  assert.equal((await fs.stat(ctx.lock)).isDirectory(),true);await holdBlocks(ctx);assert.equal(ctx.calls.code,0);
});
test('actual concurrent worker owns shared lock and parent cannot invoke another one-use request',async t=>{
  const ctx=await fixture(t),worker=startWorker(ctx,'pause-post');t.after(()=>{if(worker.child.exitCode===null)worker.child.kill();});
  await new Promise((resolveSeen,rejectSeen)=>{
    const timer=setTimeout(()=>rejectSeen(new Error('worker did not reach a bounded POST pause')),3000);
    worker.child.on('message',message=>{if(message.stage==='code_POST_paused'){clearTimeout(timer);resolveSeen();}});
    worker.child.once('error',cause=>{clearTimeout(timer);rejectSeen(cause);});
  });
  await rejected(ctx.complete());assert.equal(ctx.calls.code,0);
  worker.child.send({release:'reject_synthetic_result'});
  const result=await worker.ended;assert.equal(result.code,92);await holdBlocks(ctx);
});
