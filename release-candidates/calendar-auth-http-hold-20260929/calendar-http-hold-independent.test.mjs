// Independent synthetic HTTP consumption tests: no listener, grant, or live network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
globalThis.fetch=async()=>{throw Error('HTTP hold fixtures refuse live network');};
const original='H:/codex输出/直播五环节工作流-20260923/release-r51/calendar-pkce-r52/calendar-auth-http.mjs';
const modulePath=process.env.TARGET_MODULE || process.env.WIS_CALENDAR_HTTP_MODULE || original;
const sourceSha=createHash('sha256').update(readFileSync(modulePath)).digest('hex');
assert.equal(sourceSha,process.env.TARGET_SHA || process.env.WIS_CALENDAR_HTTP_SHA || '0dfdeee60cce1e553127d889d67e35e5cba14da124771a5e078b0b6bea95c9d4','raw HTTP source pin before import');
const {createCalendarAuthHandler}=await import(pathToFileURL(modulePath).href);
const callback='/api/lifecycle/calendar-auth/callback',start='/api/lifecycle/calendar-auth/start';
const SENTINEL='SYNTHETIC_PRIVATE_CODE_REFRESH_APPSECRET_DO_NOT_RETURN';
const admin={ok:true,permissions:{super_admin:true}};
const requestHeaders={'x-requested-with':'XMLHttpRequest',origin:'https://fixture.invalid','sec-fetch-site':'same-origin'};
const recovery={configured:true,authorized:false,status:'recovery_required',recoveryRequired:true,reason:SENTINEL};
const failure=(code='calendar_oauth_state_invalid')=>Object.assign(Error(SENTINEL),{code,diagnostic:{message:SENTINEL,code:SENTINEL,requestId:SENTINEL,accessToken:SENTINEL}});
function fixture(options={}){
  const calls={status:0,begin:0,complete:0,responses:0},argumentsSeen=[],headers={};let result;
  const reader={
    status:async()=>{calls.status++;return options.status?options.status():{authorized:false};},
    begin:()=>{calls.begin++;if(options.beginError)throw options.beginError;return {state:'synthetic_opaque_state',url:'https://accounts.feishu.cn/authorize?synthetic=only'};},
    complete:async args=>{calls.complete++;argumentsSeen.push(args);if(options.completeError)throw options.completeError;return {authorized:true};},
  };
  const handler=createCalendarAuthHandler({reader,basePath:'/hub/modules/live',readOnly:options.readOnly===true,
    json:(_res,status,body)=>{calls.responses++;result={status,body};}});
  return {calls,headers,argumentsSeen,async run(path=start,{method=path===start?'POST':'GET',auth=admin,extra={},query='code=synthetic_code&state=synthetic_state'}={}){
    result=undefined;for(const key of Object.keys(headers))delete headers[key];
    const req={method,headers:{host:'fixture.invalid',...(path===start?requestHeaders:{}),...extra}};
    await handler(req,{setHeader:(key,value)=>{headers[key]=value;}},new URL('https://fixture.invalid'+path+'?'+query),path,auth);
    assert.ok(result,'every synthetic request must terminate with a public response');return result;
  }};
}
function safe(body){assert.equal(JSON.stringify(body).includes(SENTINEL),false,'arbitrary reader errors/status must not leak synthetic secrets');}
function blocked(f,result){
  assert.ok(result.status>=400&&result.status<=599,'unsafe status must reject rather than open OAuth');
  assert.equal(result.body.ok,false);assert.equal(f.calls.begin,0);assert.equal(f.headers['Set-Cookie'],undefined);
  assert.equal(result.body.authorizeUrl,undefined);safe(result.body);
}
function recoveryResponse(result){
  assert.ok(result.status>=400&&result.status<=599);assert.equal(result.body.ok,false);safe(result.body);
  assert.notEqual(result.body.code,'calendar_oauth_state_invalid','durable recovery must override obsolete state error');
  assert.match(String(result.body.error||result.body.message||''),/(勿.*(?:刷新|重复)|不.*(?:刷新|重复)|停止.*(?:重试|授权))/u,'durable hold needs no-refresh/no-repeat public guidance');
}

test('CORE old-source counterexample: held /start cannot begin, cookie or return an OAuth URL',async()=>{
  const f=fixture({status:async()=>({...recovery})});const result=await f.run();blocked(f,result);assert.equal(f.calls.status,1);
});
test('CORE old-source counterexample: callback state error must defer to durable recovery status',async()=>{
  const stateError=Object.assign(Error('日历授权校验失败或已过期，请重新发起。'),{code:'calendar_oauth_state_invalid'});
  const f=fixture({completeError:stateError,status:async()=>({...recovery})});
  const result=await f.run(callback,{extra:{cookie:'live_calendar_oauth_state=synthetic_bound'}});
  recoveryResponse(result);assert.equal(f.calls.status,1);assert.equal(f.calls.complete,1);
  assert.match(f.headers['Set-Cookie'],/Max-Age=0/);
});

// The four original HTTP behavior assertions are retained, not edited in their source file.
function legacyFixture(readOnly=false){
 const calls=[],headers={},res={setHeader:(k,v)=>headers[k]=v};let result;
 const handler=createCalendarAuthHandler({basePath:'/hub/modules/live',readOnly,json:(_,status,body)=>result={status,body},reader:{status:async()=>({authorized:false}),begin:()=>{calls.push('begin');return {state:'opaque',url:'https://accounts.feishu.cn/authorize'};},complete:async args=>{calls.push(args);return {authorized:true};}}});
 return {calls,headers,async run(path,method='GET',auth={ok:true,permissions:{super_admin:true}},extra={}){await handler({method,headers:{host:'example.com',...extra}},res,new URL('https://example.com'+path+'?code=code&state=state'),path,auth);return result;}};
}
test('内部标记或普通成员不能获得授权入口，授权管理仅原管理员可见',async()=>{const f=legacyFixture();for(const auth of [{ok:true,internal:true},{ok:true,permissions:{}},{ok:false,permissions:{super_admin:true}}])assert.equal((await f.run('/api/lifecycle/calendar-auth/start','POST',auth,{'x-requested-with':'XMLHttpRequest'})).status,403);assert.equal(f.calls.length,0);});
test('只读候选不保存或发起日历授权',async()=>{const f=legacyFixture(true);assert.equal((await f.run('/api/lifecycle/calendar-auth/start','POST',undefined,{'x-requested-with':'XMLHttpRequest'})).status,423);assert.equal((await f.run('/api/lifecycle/calendar-auth/callback')).status,423);assert.equal(f.calls.length,0);});
test('发起授权拒绝跨站且正确 Cookie 为安全定域回调路径',async()=>{const f=legacyFixture();assert.equal((await f.run('/api/lifecycle/calendar-auth/start','POST',undefined,{'x-requested-with':'XMLHttpRequest',origin:'https://evil.test'})).status,403);assert.equal((await f.run('/api/lifecycle/calendar-auth/start','POST',undefined,{'x-requested-with':'XMLHttpRequest','sec-fetch-site':'cross-site'})).status,403);assert.equal((await f.run('/api/lifecycle/calendar-auth/start','POST',undefined,{'x-requested-with':'XMLHttpRequest',origin:'https://example.com'})).status,200);assert.match(f.headers['Set-Cookie'],/Path=\/hub\/modules\/live\/api\/lifecycle\/calendar-auth\/callback; HttpOnly; Secure; SameSite=Lax/);});
test('回调只交给状态校验读取器，不要求跨站跳转带 OA，不泄漏凭据',async()=>{const f=legacyFixture();const r=await f.run('/api/lifecycle/calendar-auth/callback','GET',null,{cookie:'live_calendar_oauth_state=bound'});assert.equal(r.status,200);assert.deepEqual(f.calls[0],{code:'code',state:'state',cookieState:'bound'});assert.doesNotMatch(JSON.stringify(r.body),/access_token|refresh_token|code=code/);assert.match(f.headers['Set-Cookie'],/Max-Age=0/);});

for(const observed of [
  {authorized:false,recoveryRequired:true},{authorized:false,status:'recovery_required'},
  {authorized:true,recoveryRequired:true},{authorized:true,status:'recovery_required'},
])test('start holds either durable recovery indicator even conflicting authorized '+JSON.stringify(observed),async()=>{
  const f=fixture({status:async()=>observed});blocked(f,await f.run());assert.equal(f.calls.status,1);
});
const malformed=[null,undefined,false,true,[],['authorized'],{}, {authorized:null},{authorized:'false'},
  {authorized:0},{authorized:false,recoveryRequired:'false'},{authorized:false,recoveryRequired:0},
  {authorized:false,status:[]},{authorized:false,status:{}},{authorized:false,configured:'true'}];
for(const [index,value] of malformed.entries())test('start invalid status fails closed '+index,async()=>{
  const f=fixture({status:async()=>value});blocked(f,await f.run());assert.equal(f.calls.status,1);
});
test('start status rejection is sanitized and never calls begin',async()=>{
  const f=fixture({status:async()=>{throw failure();}});blocked(f,await f.run());assert.equal(f.calls.status,1);
});
test('start status accessor exception is sanitized and never calls begin',async()=>{
  const status={get authorized(){throw failure();}};const f=fixture({status:async()=>status});blocked(f,await f.run());
});
for(const code of ['calendar_oauth_state_invalid','calendar_oauth_wrong_user','calendar_identity_unverified',
  'calendar_scope_missing','calendar_token_expiry_invalid','calendar_path_denied','calendar_refresh_recovery_required',
  'calendar_authorization_busy','calendar_oauth_exchange_failed','foreign_error_'+SENTINEL])
test('callback recovery wins and never forwards arbitrary error/diagnostic '+code.replace(SENTINEL,'sentinel'),async()=>{
  const f=fixture({completeError:failure(code),status:async()=>({...recovery})});recoveryResponse(await f.run(callback));
  assert.equal(f.calls.status,1);assert.equal(f.calls.begin,0);assert.equal(f.calls.complete,1);
});
for(const value of [null,{},{authorized:'false'}])test('callback failure plus malformed status fails closed '+JSON.stringify(value),async()=>{
  const f=fixture({completeError:failure(),status:async()=>value});const result=await f.run(callback);
  assert.ok(result.status>=400&&result.status<=599);assert.equal(result.body.ok,false);safe(result.body);
  assert.equal(f.calls.begin,0);assert.equal(f.calls.status,1);
});
test('callback failure plus status exception does not rethrow or disclose it',async()=>{
  const f=fixture({completeError:failure(),status:async()=>{throw failure('status_reader_failed');}});
  const result=await f.run(callback);assert.ok(result.status>=400&&result.status<=599);assert.equal(result.body.ok,false);safe(result.body);assert.equal(f.calls.begin,0);
});
for(const code of ['calendar_oauth_state_invalid','calendar_oauth_wrong_user','calendar_scope_missing',
  'calendar_oauth_exchange_failed','calendar_auth_not_configured','calendar_redirect_invalid','unknown_'+SENTINEL])
test('ordinary callback error code cannot authorize arbitrary public message/diagnostic '+code.replace(SENTINEL,'sentinel'),async()=>{
  const f=fixture({completeError:failure(code)});const result=await f.run(callback);
  assert.ok(result.status>=400&&result.status<=599);assert.equal(result.body.ok,false);safe(result.body);assert.equal(f.calls.begin,0);
});
for(const code of ['calendar_auth_not_configured','calendar_redirect_invalid','unknown_'+SENTINEL])
test('start begin failure never forwards arbitrary private message '+code.replace(SENTINEL,'sentinel'),async()=>{
  const f=fixture({beginError:failure(code)});const result=await f.run();assert.ok(result.status>=400&&result.status<=599);safe(result.body);assert.equal(result.body.authorizeUrl,undefined);
});
test('no authorization URL appears before the asynchronous status read settles',async()=>{
  let resolveStatus;const wait=new Promise(resolve=>{resolveStatus=resolve;});const f=fixture({status:()=>wait});
  const running=f.run();await Promise.resolve();assert.equal(f.calls.begin,0);assert.equal(f.headers['Set-Cookie'],undefined);
  resolveStatus({...recovery});blocked(f,await running);
});
for(const auth of [{ok:true,permissions:{manage_permissions:true}},admin])test('valid pending normal status keeps administrator start usable '+JSON.stringify(auth),async()=>{
  const f=fixture();const result=await f.run(start,{auth});assert.equal(result.status,200);assert.equal(result.body.ok,true);assert.equal(f.calls.status,1);assert.equal(f.calls.begin,1);
  assert.match(f.headers['Set-Cookie'],/Max-Age=600; Path=\/hub\/modules\/live\/api\/lifecycle\/calendar-auth\/callback; HttpOnly; Secure; SameSite=Lax/);
});
test('status route is administrator only and recovery status cannot leak reason',async()=>{
  const f=fixture({status:async()=>({...recovery})});const result=await f.run('/api/lifecycle/calendar-auth/status',{method:'GET'});
  assert.equal(result.status,200);assert.equal(result.body.calendar.authorized,false);assert.equal(result.body.calendar.recoveryRequired,true);safe(result.body);
  const before=f.calls.status;assert.equal((await f.run('/api/lifecycle/calendar-auth/status',{method:'GET',auth:null})).status,403);assert.equal(f.calls.status,before);
});
test('all processed normal and blocked paths retain no-store and no-referrer headers',async()=>{
  for(const options of [{},{status:async()=>({...recovery})},{readOnly:true}]){const f=fixture(options);await f.run();assert.equal(f.headers['Referrer-Policy'],'no-referrer');assert.equal(f.headers['Cache-Control'],'no-store');}
});
test('unsupported reset/recovery route cannot begin or complete or clear a hold',async()=>{
  const f=fixture({status:async()=>({...recovery})});for(const path of ['/api/lifecycle/calendar-auth/reset','/api/lifecycle/calendar-auth/recovery']){
    const result=await f.run(path,{method:'POST'});assert.ok(result.status>=400&&result.status<=599);assert.equal(result.body.ok,false);
  }assert.equal(f.calls.begin,0);assert.equal(f.calls.complete,0);
});

for(const path of [start,callback,'/api/lifecycle/calendar-auth/status'])test('unsettled status is bounded and late success cannot authorize '+path,async()=>{
  let settle;const wait=new Promise(resolve=>{settle=resolve;});
  const f=fixture({status:()=>wait,...(path===callback?{completeError:failure()}: {})});
  const began=performance.now();const result=await f.run(path,{method:path===start?'POST':'GET'});
  assert.ok(performance.now()-began<4500,'bounded status read must finish independently of a stuck reader');
  assert.ok(result.status>=400&&result.status<=599);assert.equal(result.body.ok,false);safe(result.body);assert.equal(f.calls.begin,0);
  if(path===start)assert.equal(f.headers['Set-Cookie'],undefined);
  settle({authorized:true});await Promise.resolve();await Promise.resolve();
  assert.equal(f.calls.begin,0);assert.equal(f.calls.responses,1,'late status resolution must not write a second response or start OAuth');
});
test('provider cancellation is still subordinate to persisted recovery hold',async()=>{
  const f=fixture({status:async()=>({...recovery})});const result=await f.run(callback,{query:'error=access_denied&error_description='+SENTINEL});
  recoveryResponse(result);assert.equal(f.calls.complete,0);assert.equal(f.calls.begin,0);assert.equal(f.calls.status,1);
  assert.match(f.headers['Set-Cookie'],/Max-Age=0/);
});
test('normal provider cancellation preserves the old safe cancellation outcome without echoing query',async()=>{
  const f=fixture();const result=await f.run(callback,{query:'error='+SENTINEL+'&state='+SENTINEL});
  assert.equal(result.status,400);assert.equal(result.body.ok,false);assert.match(result.body.error,/已取消授权/u);safe(result.body);
  assert.equal(f.calls.complete,0);assert.equal(f.calls.begin,0);assert.equal(f.calls.status,1);
});
for(const authorized of [false,true])test('ordinary public status discards private extension fields and source toJSON '+authorized,async()=>{
  const raw={authorized,configured:true,accessToken:SENTINEL,refreshToken:SENTINEL,secret:SENTINEL,reason:SENTINEL,
    diagnostic:{code:SENTINEL},rawBody:SENTINEL,toJSON:()=>({secret:SENTINEL})};
  const f=fixture({status:async()=>raw});const result=await f.run('/api/lifecycle/calendar-auth/status',{method:'GET'});
  assert.equal(result.status,200);assert.equal(result.body.calendar.authorized,authorized);safe(result.body);
  for(const key of ['accessToken','refreshToken','secret','diagnostic','rawBody','toJSON'])assert.equal(Object.hasOwn(result.body.calendar,key),false,key);
});
test('public failure never accesses mutable private message or diagnostic getters',async()=>{
  const error={code:'calendar_oauth_state_invalid',get message(){throw Error(SENTINEL);},get diagnostic(){throw Error(SENTINEL);}};
  const f=fixture({completeError:error});const result=await f.run(callback);assert.equal(result.body.ok,false);safe(result.body);
  assert.equal(f.calls.status,1);assert.equal(f.calls.begin,0);
});
for(const authorized of [false,true])test('public status does not expose reader identity or expiry even typed '+authorized,async()=>{
  const raw={configured:true,authorized,openId:SENTINEL,refreshExpiresAt:8640000000000000,
    reason:SENTINEL,extra:SENTINEL,diagnostic:{message:SENTINEL}};
  const f=fixture({status:async()=>raw});const result=await f.run('/api/lifecycle/calendar-auth/status',{method:'GET'});
  assert.equal(result.status,200);assert.equal(result.body.calendar.authorized,authorized);safe(result.body);
  for(const key of ['openId','refreshExpiresAt','extra','diagnostic'])assert.equal(Object.hasOwn(result.body.calendar,key),false,key+' is private reader metadata, not public HTTP evidence');
});
