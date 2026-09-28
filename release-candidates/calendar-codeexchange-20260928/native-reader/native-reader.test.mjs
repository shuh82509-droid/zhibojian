// Root-owned isolated integration checks. No real actor, grant, URL or API.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createCipheriv,createHash} from 'node:crypto';
import {createCalendarUserReader} from './calendar-user-reader.mjs';
import {collectNativeCalendarSource,decodeNativeCalendarEnvelope} from './native-calendar-source.mjs';

globalThis.fetch=async()=>{throw new Error('fixtures forbid live network');};
const instant=Date.UTC(2026,8,28,14,30), actor='ou_native_fixture', cal='native_fixture_calendar';
const other='other_fixture_calendar', app='native_fixture_app', key=Buffer.alloc(32,41);
const scope='calendar:calendar:read calendar:calendar.event:read offline_access';
const access='SYNTHETIC_NATIVE_ACCESS',refresh='SYNTHETIC_NATIVE_REFRESH',newAccess='SYNTHETIC_NATIVE_NEW';
const meta={calendar_id:cal,type:'shared',role:'reader',is_deleted:false,is_third_party:false};
const json=data=>JSON.stringify({code:0,data});
const record=(extra={})=>({openId:actor,accessToken:access,refreshToken:refresh,
  accessExpiresAt:instant+3600000,refreshExpiresAt:instant+86400000,scopes:scope,...extra});
const grant=()=>({code:0,access_token:newAccess,refresh_token:'SYNTHETIC_ROTATED_REFRESH',
  expires_in:3600,refresh_token_expires_in:86400,scope});
function encrypt(value){
  const iv=Buffer.alloc(12,17),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(JSON.stringify([app,cal,actor])));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return JSON.stringify({version:2,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')});
}
const response=(raw,status=200)=>({ok:status>=200&&status<300,status,text:async()=>raw});
async function fixture(t,{stored=record(),config={},onFetch}={}){
  const root=resolve(await fs.mkdtemp(join(tmpdir(),'wis-native-reader-fixture-'))),storePath=join(root,'fixture.enc');
  t.after(async()=>{assert.ok(root.startsWith(resolve(tmpdir())+sep+'wis-native-reader-fixture-'));await fs.rm(root,{recursive:true,force:true});});
  await fs.writeFile(storePath,encrypt(stored),{mode:0o600});
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url,method:options.method||'GET',options});
    if(onFetch)return onFetch(url,options,{storePath,calls});
    return response(json(meta));
  };
  const settings={appId:app,appSecret:'SYNTHETIC_NATIVE_SECRET',calendarId:cal,expectedOpenId:actor,
    redirectUri:'https://native-fixture.invalid/callback',storePath,encryptionKey:key.toString('base64'),
    allowNativeSource:true,fetchImpl,now:()=>instant,diagnostic:()=>{},...config};
  return {root,storePath,calls,reader:createCalendarUserReader(settings),restart:()=>createCalendarUserReader(settings)};
}
const request={kind:'metadata',calendarId:cal};
async function denied(promise,codes=[]){
  let caught;try{await promise;}catch(cause){caught=cause;}assert.ok(caught);
  if(codes.length)assert.ok(codes.includes(caught.code),caught.code);
  assert.doesNotMatch(JSON.stringify({code:caught.code,message:caught.message}),/SYNTHETIC_NATIVE|fixture_secret_body/);
}

for(const enable of [undefined,false,'true',1])test(`native method unavailable without explicit boolean opt-in ${String(enable)}`,async t=>{
  const f=await fixture(t,{config:{allowNativeSource:enable}});
  assert.equal(Object.hasOwn(f.reader,'getNative'),false);
  assert.deepEqual(Object.keys(f.reader),['calendarId','status','begin','complete','get','verifyCalendar']);
  assert.equal(f.calls.length,0);
});
test('native metadata is fixed GET and returns untouched raw JSON under approved reader lock',async t=>{
  const raw='{ "code":0, "data":'+JSON.stringify(meta)+' }';
  const f=await fixture(t,{onFetch:async(url,options,ctx)=>{
    assert.equal(url,'https://open.feishu.cn/open-apis/calendar/v4/calendars/'+cal);
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer '+access);assert.equal(options.signal.aborted,false);
    assert.equal((await fs.stat(ctx.storePath+'.lock')).isDirectory(),true);
    return response(raw);
  }});
  assert.equal(await f.reader.getNative(request),raw);assert.equal(f.calls.length,1);
  await assert.rejects(fs.stat(f.storePath+'.lock'),{code:'ENOENT'});
});
for(const patch of [{calendarId:other},{kind:'primary'},{host:'https://evil.invalid'},{method:'POST'},
  {path:'/im/v1/messages'},{expectedOpenId:'ou_other'},{approvedCalendarIds:[other]},{pageToken:'x'}])
test('unapproved structured query fails before credential or API '+JSON.stringify(patch),async t=>{
  const f=await fixture(t);await denied(f.reader.getNative({...request,...patch}));assert.equal(f.calls.length,0);
});
test('anchor-only native query keeps page token opaque and old get allowlist stays closed',async t=>{
  const opaque='x+/=?&中文';const f=await fixture(t);
  await f.reader.getNative({kind:'anchor_page',calendarId:cal,anchorSeconds:String(instant/1000),pageSize:50,pageToken:opaque});
  const url=new URL(f.calls[0].url);assert.equal(url.searchParams.get('page_token'),opaque);
  assert.equal(url.searchParams.get('anchor_time'),String(instant/1000));assert.equal(url.searchParams.get('start_time'),null);
  await denied(f.reader.get('/calendar/v4/calendars/'+cal+'/events?anchor_time=1'),['calendar_path_denied']);
  assert.equal(f.calls.length,1);
});
test('native cancellation and invalid options fail before refresh',async t=>{
  const f=await fixture(t,{stored:record({accessExpiresAt:instant-1000})});const controller=new AbortController();controller.abort();
  for(const opts of [null,[],{method:'POST'},{signal:{}},{signal:controller.signal}])await denied(f.reader.getNative(request,opts));
  assert.equal(f.calls.length,0);
});
for(const extra of [{openId:'ou_other'},{scopes:'offline_access'},{accessToken:{}},{refreshToken:[]},{accessExpiresAt:null}])
test('native reader rejects invalid stored identity/grant '+JSON.stringify(extra),async t=>{
  const f=await fixture(t,{stored:record(extra)});await denied(f.reader.getNative(request),['calendar_authorization_required']);
  assert.equal((await f.reader.status()).authorized,false);assert.equal(f.calls.length,0);
});
test('durable malformed hold blocks cached native reads after a new instance',async t=>{
  const f=await fixture(t);await fs.writeFile(f.storePath+'.refresh-hold.json','{"unknown":true}');
  for(const reader of [f.reader,f.restart()]){
    await denied(reader.getNative(request),['calendar_refresh_recovery_required']);assert.equal((await reader.status()).authorized,false);
  }assert.equal(f.calls.length,0);
});
test('successful native refresh persists rotated grant before GET; one POST only',async t=>{
  let posts=0;const f=await fixture(t,{stored:record({accessExpiresAt:instant-1000}),onFetch:async(url,options,ctx)=>{
    if(url==='https://accounts.feishu.cn/oauth/v3/token'){
      posts++;assert.ok((await fs.readFile(ctx.storePath+'.refresh-hold.json','utf8')).includes('calendar_refresh_intent'));
      return {ok:true,status:200,json:async()=>grant()};
    }
    assert.equal(options.headers.Authorization,'Bearer '+newAccess);
    await assert.rejects(fs.stat(ctx.storePath+'.refresh-hold.json'),{code:'ENOENT'});
    assert.equal((await fs.stat(ctx.storePath+'.lock')).isDirectory(),true);return response(json(meta));
  }});
  assert.equal(await f.reader.getNative(request),json(meta));await f.reader.getNative(request);
  assert.equal(posts,1);assert.equal((await f.reader.status()).authorized,true);
});
test('unknown refresh cannot escape quarantine through native method or process restart',async t=>{
  let posts=0;const f=await fixture(t,{stored:record({accessExpiresAt:instant-1000}),onFetch:async url=>{
    assert.equal(url,'https://accounts.feishu.cn/oauth/v3/token');posts++;throw Error('fixture_secret_body');
  }});
  await denied(f.reader.getNative(request),['calendar_refresh_recovery_required']);
  for(const reader of [f.reader,f.restart()]){
    await denied(reader.getNative(request));assert.equal((await reader.status()).authorized,false);
  }assert.equal(posts,1);assert.equal(f.calls.length,1);
});
test('ordinary native HTTP failure is sanitized and not a permanent refresh hold',async t=>{
  const f=await fixture(t,{onFetch:async()=>response('fixture_secret_body',403)});
  await denied(f.reader.getNative(request),['calendar_native_read_failed']);
  await denied(f.reader.getNative(request),['calendar_native_read_failed']);
  assert.equal(f.calls.length,2);assert.equal((await f.reader.status()).authorized,true);
  await assert.rejects(fs.stat(f.storePath+'.refresh-hold.json'),{code:'ENOENT'});
});
test('duplicate-key response remains raw and collector decoder rejects it',async t=>{
  const raw='{"code":1,"code":0,"data":{}}';const f=await fixture(t,{onFetch:async()=>response(raw)});
  const got=await f.reader.getNative(request);assert.equal(got,raw);
  assert.equal(decodeNativeCalendarEnvelope(got).reasonCode,'native_json_duplicate_key');
});
function streamResponse(chunks){return {ok:true,body:new ReadableStream({start(controller){
  for(const chunk of chunks)controller.enqueue(chunk);controller.close();}}),text:async()=>{throw Error('stream must not use text fallback');}};}
test('streamed UTF-8 raw body is preserved exactly',async t=>{
  const raw=json({...meta,summary:'合成中文日历'}),bytes=Buffer.from(raw,'utf8');
  const f=await fixture(t,{onFetch:async()=>streamResponse([bytes.subarray(0,3),bytes.subarray(3)])});
  assert.equal(await f.reader.getNative(request),raw);
});
test('native streaming byte cap and invalid UTF-8 fail without unknown grant',async t=>{
  for(const chunks of [[new Uint8Array(8*1024*1024+1)],[new Uint8Array([0xff,0xfe])]]){
    const f=await fixture(t,{onFetch:async()=>streamResponse(chunks)});
    await denied(f.reader.getNative(request),['calendar_native_read_failed']);assert.equal((await f.reader.status()).authorized,true);
  }
});
test('hanging body is bounded by caller cancellation and releases ordinary read lock',async t=>{
  const f=await fixture(t,{onFetch:async()=>({ok:true,text:async()=>new Promise(()=>{})})});const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20);
  try{await denied(f.reader.getNative(request,{signal:controller.signal}),['calendar_native_read_aborted']);}
  finally{clearTimeout(timer);}
  assert.equal((await f.reader.status()).authorized,true);
});
test('caller cancellation actively cancels and releases a pending standard byte stream',async t=>{
  let cancelled=0;
  const body=new ReadableStream({cancel(){cancelled++;}});
  const f=await fixture(t,{onFetch:async()=>({ok:true,body})}),controller=new AbortController();
  const reading=f.reader.getNative(request,{signal:controller.signal});
  while(!body.locked)await new Promise(resolve=>setTimeout(resolve,1));
  controller.abort();await denied(reading,['calendar_native_read_aborted']);
  assert.equal(cancelled,1);assert.equal(body.locked,false);
  await assert.rejects(fs.stat(f.storePath+'.lock'),{code:'ENOENT'});
  assert.equal((await f.reader.status()).authorized,true);
});
test('a late byte response after cancellation is cancelled without acquiring another reader',async t=>{
  let entered,deliver,cancelled=0;
  const started=new Promise(resolve=>{entered=resolve;});
  const body=new ReadableStream({cancel(){cancelled++;}});
  const f=await fixture(t,{onFetch:async()=>{entered();return new Promise(resolve=>{deliver=resolve;});}});
  const controller=new AbortController(),reading=f.reader.getNative(request,{signal:controller.signal});
  await started;controller.abort();await denied(reading,['calendar_native_read_aborted']);
  deliver({ok:true,body});await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(cancelled,1);assert.equal(body.locked,false);
  await assert.rejects(fs.stat(f.storePath+'.lock'),{code:'ENOENT'});
});
test('an unreadable opaque body cannot be silently downgraded to the trusted text adapter',async t=>{
  let textCalls=0,cancelled=0;
  const f=await fixture(t,{onFetch:async()=>({ok:true,body:{cancel(){cancelled++;}},
    text:async()=>{textCalls++;return json(meta);}})});
  await denied(f.reader.getNative(request),['calendar_native_read_failed']);
  assert.equal(textCalls,0);assert.equal(cancelled,1);
  assert.equal((await f.reader.status()).authorized,true);
});
test('own-primary reader cannot borrow another listed calendar in native mode',async t=>{
  const f=await fixture(t,{config:{requireOwnPrimaryCalendar:true,additionalCalendarIds:[other]}});
  await denied(f.reader.getNative({kind:'metadata',calendarId:other}),['calendar_native_query_denied']);assert.equal(f.calls.length,0);
});
test('complete native pages through real factory entry remain pending for reminder and ownership',async t=>{
  let pages=0;const f=await fixture(t,{onFetch:async(url)=>{
    if(!new URL(url).pathname.endsWith('/events'))return response(json(meta));
    const items=pages++===0?[{event_id:'first',summary:'张三、李四面试',status:'cancelled'}]:[{event_id:'second',summary:'未来日程'}];
    return response(json({items,has_more:pages===1,...(pages===1?{page_token:'opaque_next'}:{sync_token:'opaque_sync'})}));
  }});
  const result=await collectNativeCalendarSource({calendarId:cal,approvedCalendarIds:[cal],readerOpenId:actor,
    anchorSeconds:String(instant/1000),readNative:f.reader.getNative,now:()=>instant});
  assert.equal(result.status,'read_complete');assert.equal(result.events.length,2);assert.equal(result.observedPages,2);
  assert.equal(result.readyForReminder,false);assert.equal(result.ownerOpenId,null);assert.equal(result.businessPassed,null);
  assert.equal(result.fieldEvidence.eventUpdateTime,'not_exposed');assert.equal(f.calls.length,4);
});
test('native opt-in changes only import/signature/new method/API relative to the exact code-intent base',()=>{
  let source=readFileSync(new URL('./calendar-user-reader.mjs',import.meta.url),'utf8');
  source=source.replace("import {buildNativeCalendarRequest} from './native-calendar-source.mjs';\n",'');
  source=source.replace('allowInstanceView = false, allowNativeSource = false, redirectUri','allowInstanceView = false, redirectUri');
  const start=source.indexOf('  // Private, opt-in native source reads.');
  const end=source.indexOf('  async function verifyCalendar(targetCalendarId)',start);
  assert.ok(start>0&&end>start);source=source.slice(0,start)+source.slice(end);
  source=source.replace('  return {calendarId, status, begin, complete, get, verifyCalendar,\n    ...(allowNativeSource === true ? {getNative} : {})};',
    '  return {calendarId, status, begin, complete, get, verifyCalendar};');
  assert.equal(createHash('sha256').update(source).digest('hex'),'9cbc9be0152abace6365d3f0dadef864dc9402e4b055e26a9d19424c09597912');
});
