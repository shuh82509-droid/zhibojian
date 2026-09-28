// Independent fictional wrapper tests. No listener, real OAuth/store, or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const snapshotPath=process.env.WIS_COACH_SOURCE_SNAPSHOT || 'H:/codex输出/直播五环节工作流-20260923/calendar-consumer-contracts-exact-20260929/SOURCE-SNAPSHOT-0150.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let source,sourcePin;
if(process.env.WIS_COACH_HTTP_MODULE){
  source=readFileSync(process.env.WIS_COACH_HTTP_MODULE);sourcePin=process.env.WIS_COACH_HTTP_SHA;
  assert.match(sourcePin||'',/^[a-f0-9]{64}$/u);assert.equal(sha(source),sourcePin);
}else{
  const snapshot=JSON.parse(readFileSync(snapshotPath,'utf8'));
  assert.equal(snapshot.selectedCasEqual,true);assert.deepEqual(snapshot.before,snapshot.after);
  const selected=snapshot.sources['/app/coach-calendar-auth.mjs'];assert.equal(selected.present,true);
  source=Buffer.from(selected.base64,'base64');sourcePin='b4da4dfc4bedb50e21aaa545d0a0cde74faf513b327732a11619b854c4b99859';
  assert.equal(source.length,5586);assert.equal(selected.bytes,source.length);assert.equal(selected.sha256,sourcePin);assert.equal(sha(source),sourcePin);
}
new TextDecoder('utf-8',{fatal:true}).decode(source);
// The precise old wrapper is dependency-free; data URL import cannot resolve a
// hidden neighboring historical server/reader. Any added import fails closed.
globalThis.fetch=async()=>{throw Error('NO_REAL_NETWORK');};
const {createCoachCalendarAuth}=await import('data:text/javascript;base64,'+source.toString('base64'));
const routes={start:'/api/lifecycle/coach-calendar-auth/start',status:'/api/lifecycle/coach-calendar-auth/status',callback:'/api/lifecycle/calendar-auth/callback'};
const rooms=['roomA','roomB','roomC','roomD'];
const names=Object.fromEntries(rooms.map((room,index)=>[room,'Fictional Coach '+index]));
const numbers=Object.fromEntries(rooms.map((room,index)=>[room,'SYNTH-'+index]));
const identities=Object.fromEntries(rooms.map((room,index)=>[room,'ou_synthetic_'+index]));
const SENTINEL='SYNTHETIC_PRIVATE_TOKEN_STATE_ERROR_DO_NOT_PUBLISH';
const recovery={configured:true,authorized:false,status:'recovery_required',recoveryRequired:true,reason:SENTINEL};
const normal={configured:true,authorized:false};
function error(code='calendar_oauth_state_invalid'){
  return Object.assign(Error(SENTINEL),{code,diagnostic:{accessToken:SENTINEL,message:SENTINEL}});
}
function response(){return {headers:{},status:0,body:null,setHeader(k,v){this.headers[k]=v;},
  writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(body){this.body=body;}};}
function fixture(options={}){
  let now=1000,sequence=0;const readers={},calls=[];
  let statusProvider=options.status || (()=>normal),verifyProvider=options.verify || (()=>undefined);
  const localNames={...names},localNumbers={...numbers},localIds={...identities};
  for(const room of rooms){
    const states=new Set();
    readers[room]={
      status:async()=>{calls.push({kind:'status',room});return statusProvider(room);},
      begin:()=>{calls.push({kind:'begin',room});if(options.beginError)throw options.beginError;
        const state='synthetic_'+room+'_'+(++sequence);states.add(state);return {state,url:'https://accounts.feishu.cn/authorize?synthetic=only'};},
      complete:async args=>{calls.push({kind:'complete',room,args});
        if(!states.has(args.state)||args.cookieState!==args.state)throw error();
        if(options.completeError)throw options.completeError;
        return Object.hasOwn(options,'completeResult')?options.completeResult:{authorized:true};}
    };
  }
  const auth=createCoachCalendarAuth({readers,coachNames:localNames,employeeNos:localNumbers,openIds:localIds,
    basePath:'/synthetic/live',enabled:options.enabled??true,readOnly:options.readOnly??false,
    json:(res,status,body)=>{res.status=status;res.body=body;},clock:()=>now,
    verifyActor:async(room,openId,name,number)=>{calls.push({kind:'verify',room,openId,name,number});return verifyProvider(room,openId,name,number);}});
  const actor=room=>({ok:true,mode:'central',degraded:false,user:{number:numbers[room],realName:names[room],open_id:identities[room]}});
  const req=(method='POST',headers={})=>({method,headers:{host:'fixture.invalid','x-requested-with':'XMLHttpRequest',
    origin:'https://fixture.invalid','sec-fetch-site':'same-origin',...headers}});
  return {auth,calls,actor,readers,localNames,localNumbers,localIds,setNow:value=>{now=value;},setStatus:value=>{statusProvider=value;},
    setVerify:value=>{verifyProvider=value;},
    async api(room='roomA',path=routes.start,{method=path===routes.start?'POST':'GET',actorValue=actor(room),headers={}}={}){
      const res=response(),handled=await auth.handleApi(req(method,headers),res,path,actorValue);return {res,handled};},
    async callback(state,{query='',cookieState=state,method='GET'}={}){
      const res=response();const url=new URL('https://fixture.invalid'+routes.callback+'?state='+encodeURIComponent(state)+'&code=synthetic_code'+query);
      const handled=await auth.handleCallback(req(method,{cookie:'live_coach_calendar_oauth_state='+cookieState}),res,url);return {res,handled};}
  };
}
const stateOf=res=>res.headers['Set-Cookie']?.match(/^[^=]+=([^;]+)/u)?.[1];
const count=(f,kind,room)=>f.calls.filter(item=>item.kind===kind&&(!room||item.room===room)).length;
const safe=res=>assert.equal(JSON.stringify(res.body).includes(SENTINEL),false,'public body must not echo synthetic private content');
function deniedStart(f,{res,handled}){
  assert.equal(handled,true);assert(res.status>=400&&res.status<=599);assert.equal(res.body.ok,false);
  assert.equal(res.body.authorizeUrl,undefined);assert.equal(res.headers['Set-Cookie'],undefined);assert.equal(count(f,'begin'),0);safe(res);
}
function heldPage({res,handled}){
  assert.equal(handled,true);assert(res.status>=400&&res.status<=599);safe(res);
  assert.match(String(res.body),/(勿.*(?:刷新|重复)|停止.*(?:重试|授权)|不.*(?:刷新|重复))/u);
  assert.doesNotMatch(String(res.body),/请由本人重新发起|请重新授权/u);
}
async function bounded(operation){
  let timer;
  try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('WRAPPER_NOT_BOUNDED')),2300);})]);}
  finally{clearTimeout(timer);}
}

for(const room of rooms)test('preserve four-person independent state/reader/cookie ownership: '+room,async()=>{
  const f=fixture(),started=await f.api(room);assert.equal(started.res.status,200);
  const state=stateOf(started.res);assert(state);assert.match(started.res.headers['Set-Cookie'],/Max-Age=600; Path=\/synthetic\/live\/api\/lifecycle\/calendar-auth\/callback; HttpOnly; Secure; SameSite=Lax/u);
  const before=f.calls.length,unknown=await f.callback('synthetic_interview_state');assert.equal(unknown.handled,false);assert.equal(unknown.res.status,0);assert.equal(f.calls.length,before);
  const done=await f.callback(state);assert.equal(done.handled,true);assert.equal(done.res.status,200);safe(done.res);
  assert.equal(count(f,'complete',room),1);assert.equal(count(f,'complete'),1);assert.match(done.res.headers['Set-Cookie'],/Max-Age=0/u);
  const replay=await f.callback(state);assert.equal(replay.handled,false);assert.equal(count(f,'complete'),1);
});
test('preserve cross-room wrong cookie rejection and one-use callback state',async()=>{
  const f=fixture(),a=await f.api('roomA'),b=await f.api('roomB');
  const denied=await f.callback(stateOf(a.res),{cookieState:stateOf(b.res)});assert.equal(denied.handled,true);assert.equal(denied.res.status,400);
  assert.equal(count(f,'complete','roomA'),1);assert.equal(count(f,'complete','roomB'),0);
  assert.equal((await f.callback(stateOf(a.res))).handled,false);
});
for(const headers of [{origin:'https://evil.invalid'},{origin:'http://fixture.invalid'},{origin:'not a URL'},
  {'sec-fetch-site':'cross-site'},{'x-requested-with':'fetch'}])test('preserve CSRF/origin rejection '+JSON.stringify(headers),async()=>{
  const f=fixture();deniedStart(f,await f.api('roomA',routes.start,{headers}));
});
for(const options of [{enabled:false},{readOnly:true}])test('preserve disabled/read-only start has no grant action '+JSON.stringify(options),async()=>{
  const f=fixture(options),value=await f.api();deniedStart(f,value);assert.equal(value.res.status,423);assert.equal(count(f,'complete'),0);
});
for(const value of [null,{ok:true,mode:'internal',user:{number:numbers.roomA,name:names.roomA}},
  {ok:true,mode:'central',degraded:true,user:{number:numbers.roomA,name:names.roomA}},
  {ok:true,mode:'central',user:{number:'SYNTH-other',name:names.roomA}},
  {ok:true,mode:'central',user:{number:numbers.roomA,name:names.roomA,open_id:'ou_other'}}])
test('preserve unknown/admin/internal/degraded/foreign identity rejection '+JSON.stringify(value),async()=>{
  const f=fixture();deniedStart(f,await f.api('roomA',routes.start,{actorValue:value}));assert.equal(count(f,'verify'),0);
});
test('preserve live verify failure before begin',async()=>{
  const f=fixture({verify:()=>{throw error();}});deniedStart(f,await f.api());assert.equal(count(f,'verify'),1);
});
test('original assertion: conflicting legacy name cannot override a matching realName',async()=>{
  const f=fixture(),actor={...f.actor('roomA'),user:{...f.actor('roomA').user,name:'Fictional Different Person'}};
  deniedStart(f,await f.api('roomA',routes.start,{actorValue:actor}));
});
test('identity getter pollution fails closed without public diagnostic',async()=>{
  const f=fixture(),actor=f.actor('roomA');Object.defineProperty(actor.user,'realName',{get(){throw error();}});
  deniedStart(f,await f.api('roomA',routes.start,{actorValue:actor}));
});
test('trusted coach identity mappings cannot be changed after wrapper construction',async()=>{
  const f=fixture();f.localNumbers.roomA='SYNTH-polluted';f.localNames.roomA='Polluted Coach';f.localIds.roomA='ou_polluted';
  const value=await f.api('roomA',routes.start,{actorValue:{ok:true,mode:'central',user:{number:'SYNTH-polluted',name:'Polluted Coach',open_id:'ou_polluted'}}});
  deniedStart(f,value);
});
for(const status of [{...recovery},{authorized:true,recoveryRequired:true},{authorized:false,status:'recovery_required'}])
test('CORE durable status blocks start rather than creating another OAuth URL '+JSON.stringify(status),async()=>{
  const f=fixture({status:()=>status});deniedStart(f,await f.api());assert.equal(count(f,'status'),1);
});
for(const status of [null,undefined,{},[],{authorized:'false'},{authorized:false,recoveryRequired:'false'},
  {authorized:false,status:'secret '+SENTINEL},{authorized:false,configured:'true'}])
test('malformed status cannot open authorization '+JSON.stringify(status),async()=>{
  const f=fixture({status:()=>status});deniedStart(f,await f.api());
});
test('status rejection returns a sanitized unavailable result without begin',async()=>{
  const f=fixture({status:()=>{throw error();}});deniedStart(f,await f.api());
});
test('status accessors/toJSON cannot disclose private extensions',async()=>{
  let touched=0;const raw={configured:true,authorized:true,reason:SENTINEL,diagnostic:{message:SENTINEL},toJSON(){return {secret:SENTINEL};}};
  Object.defineProperty(raw,'openId',{get(){touched++;throw error();}});Object.defineProperty(raw,'refreshExpiresAt',{get(){touched++;throw error();}});
  const f=fixture({status:()=>raw}),value=await f.api('roomC',routes.status);assert.equal(value.res.status,200);safe(value.res);
  assert.equal(value.res.body.calendar.authorized,true);assert.equal(touched,0);
  for(const key of ['openId','refreshExpiresAt','toJSON','diagnostic','secret'])assert.equal(Object.hasOwn(value.res.body.calendar,key),false);
});
test('held status projects authorized false and fixed guidance, only for own room',async()=>{
  const f=fixture({status:()=>({...recovery,authorized:true})}),value=await f.api('roomD',routes.status);
  assert.equal(value.res.status,200);assert.equal(value.res.body.calendar.authorized,false);assert.equal(value.res.body.calendar.recoveryRequired,true);safe(value.res);
  assert.equal(value.res.body.room,'roomD');assert.equal(count(f,'status','roomD'),1);assert.equal(count(f,'status'),1);
});
for(const mode of ['expired','cancelled','complete_error'])test('CORE held callback overrides '+mode+' with no repeat guidance',async()=>{
  const f=fixture({completeError:mode==='complete_error'?error():undefined}),started=await f.api();assert.equal(started.res.status,200);
  f.setStatus(()=>recovery);if(mode==='expired')f.setNow(601001);
  heldPage(await f.callback(stateOf(started.res),{query:mode==='cancelled'?'&error=access_denied&error_description='+SENTINEL:''}));
  assert.equal(count(f,'begin'),1);
});
for(const result of [undefined,null,{},false,{authorized:false},{authorized:'true'}])
test('callback success requires strict authorized true '+JSON.stringify(result),async()=>{
  const f=fixture({completeResult:result}),started=await f.api(),value=await f.callback(stateOf(started.res));
  assert(value.res.status>=400&&value.res.status<=599);safe(value.res);assert.doesNotMatch(String(value.res.body),/本人日历授权完成/u);
});
test('ordinary callback error does not reflect mutable private message/diagnostic',async()=>{
  const f=fixture({completeError:error('calendar_oauth_wrong_user')}),started=await f.api();
  const value=await f.callback(stateOf(started.res));assert(value.res.status>=400);safe(value.res);
});
test('ordinary begin error is fixed guidance rather than arbitrary private message',async()=>{
  const f=fixture({beginError:error('calendar_auth_not_configured')});const value=await f.api();assert(value.res.status>=400);safe(value.res);
});
test('unknown code and throwing error message cannot escape a public callback response',async()=>{
  const failure={code:'unknown_'+SENTINEL,get message(){throw error();},get diagnostic(){throw error();}};
  const f=fixture({completeError:failure}),started=await f.api(),value=await f.callback(stateOf(started.res));assert(value.res.status>=400);safe(value.res);
});
test('expired callback still consumes state but cannot perform token exchange',async()=>{
  const f=fixture(),started=await f.api();f.setNow(601001);const value=await f.callback(stateOf(started.res));assert(value.res.status>=400);
  assert.equal(count(f,'complete'),0);assert.equal((await f.callback(stateOf(started.res))).handled,false);
});
test('provider cancellation is never a complete/grant action',async()=>{
  const f=fixture(),started=await f.api(),value=await f.callback(stateOf(started.res),{query:'&error='+SENTINEL});
  assert.equal(value.res.status,400);assert.equal(count(f,'complete'),0);safe(value.res);
});
test('wrong-method callback consumes only own state, rejects without complete',async()=>{
  const f=fixture(),started=await f.api(),value=await f.callback(stateOf(started.res),{method:'POST'});
  assert.equal(value.res.status,405);assert.equal(count(f,'complete'),0);assert.equal((await f.callback(stateOf(started.res))).handled,false);
});
test('unknown API never selects a reader or steals original interview route',async()=>{
  const f=fixture(),value=await f.api('roomA','/api/lifecycle/calendar-auth/start');assert.equal(value.handled,false);assert.equal(value.res.status,0);assert.equal(f.calls.length,0);
});
test('asynchronous identity verification is bounded, no late OAuth side effect',async()=>{
  let settle;const f=fixture({verify:()=>new Promise(resolve=>{settle=resolve;})});
  const value=await bounded(f.api());deniedStart(f,value);settle();await Promise.resolve();await Promise.resolve();assert.equal(count(f,'begin'),0);
});
test('asynchronous reader status is bounded on GET and late ready cannot disclose',async()=>{
  let settle;const f=fixture({status:()=>new Promise(resolve=>{settle=resolve;})});
  const value=await bounded(f.api('roomA',routes.status));assert(value.res.status>=400);safe(value.res);
  settle({authorized:true});await Promise.resolve();await Promise.resolve();assert.equal(count(f,'begin'),0);
});
test('asynchronous reader status is bounded after failing callback',async()=>{
  const f=fixture({completeError:error()}),started=await f.api();let settle;
  // Any safe pre-complete status read sees normal. Only the failure-path read
  // hangs, so this is not a demand to exchange a code under unknown preflight.
  f.setStatus(()=>count(f,'complete')===0?normal:new Promise(resolve=>{settle=resolve;}));
  const value=await bounded(f.callback(stateOf(started.res)));assert(value.res.status>=400);safe(value.res);
  settle({authorized:true});await Promise.resolve();await Promise.resolve();assert.equal(count(f,'complete'),1);assert.equal(count(f,'begin'),1);
});
test('every normal/held response retains no-store/no-referrer and HTML CSP',async()=>{
  const f=fixture(),started=await f.api(),value=await f.callback(stateOf(started.res));
  for(const res of [started.res,value.res]){assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.headers['Referrer-Policy'],'no-referrer');}
  assert.match(value.res.headers['Content-Security-Policy'],/default-src 'none'/u);assert.match(value.res.headers['Content-Security-Policy'],/form-action 'none'/u);
});
