// Actual frozen reader + HTTP handler, only synthetic filesystem/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(sha(new URL('./calendar-user-reader.mjs',import.meta.url)),'9cbc9be0152abace6365d3f0dadef864dc9402e4b055e26a9d19424c09597912');
assert.equal(sha(new URL('./calendar-auth-http.mjs',import.meta.url)),'d8705f422394926bc001351d2f622502cb3df087ac44267c8b974d9b3dbe3d4c');
globalThis.fetch=async()=>{throw Error('fixtures refuse live network');};
const {createCalendarUserReader}=await import('./calendar-user-reader.mjs');
const {createCalendarAuthHandler}=await import('./calendar-auth-http.mjs');
const secret='SYNTHETIC_HTTP_PRIVATE_APPSECRET_CODE_TOKEN_DO_NOT_PUBLISH';
const storePath='/synthetic-fixture/calendar.json';
const start='/api/lifecycle/calendar-auth/start',callback='/api/lifecycle/calendar-auth/callback';
const admin={ok:true,permissions:{super_admin:true}};
function fixture({hold=null,readOnly=false,configured=true,unreadable=false}={}) {
  const calls={network:0,writes:0,begin:0,complete:0,status:0,reads:0};
  const enoent=()=>Object.assign(Error('not found'),{code:'ENOENT'});
  const paths={code:storePath+'.code-hold.json',refresh:storePath+'.refresh-hold.json',lock:storePath+'.lock'};
  const mutation=async()=>{calls.writes++;throw Error('no filesystem mutation allowed');};
  const fsImpl={mkdir:mutation,rename:mutation,open:mutation,unlink:mutation,rmdir:mutation,
    stat:async path=>{calls.reads++;if(path===paths[hold])return {};if(hold==='stat_error')throw Error(secret);throw enoent();},
    readFile:async path=>{calls.reads++;assert.equal(path,storePath);if(unreadable)throw Error(secret);throw enoent();}};
  const reader=createCalendarUserReader({appId:configured?'cli_synthetic_http_only':'',appSecret:secret,
    calendarId:'synthetic_calendar',expectedOpenId:'ou_synthetic_fixture',
    redirectUri:'https://fixture.invalid/hub/modules/live'+callback,storePath,
    encryptionKey:Buffer.alloc(32,7).toString('base64'),fsImpl,
    fetchImpl:async()=>{calls.network++;throw Error(secret);},diagnostic:()=>{throw Error('no diagnostic operation expected');}});
  const wrapped={status:async()=>{calls.status++;return reader.status();},
    begin:()=>{calls.begin++;return reader.begin();},
    complete:async value=>{calls.complete++;return reader.complete(value);}};
  const headers={};let response;
  const handler=createCalendarAuthHandler({reader:wrapped,basePath:'/hub/modules/live',readOnly,
    json:(_,status,body)=>response={status,body}});
  return {calls,reader,headers,async run(path=start,{method=path===start?'POST':'GET',auth=admin,query='code=synthetic_code&state=consumed_state',cookie=''}={}) {
    response=undefined;for(const name of Object.keys(headers))delete headers[name];
    await handler({method,headers:{host:'fixture.invalid','x-requested-with':'XMLHttpRequest',origin:'https://fixture.invalid',cookie}},
      {setHeader:(name,value)=>headers[name]=value},new URL('https://fixture.invalid'+path+'?'+query),path,auth);
    assert.ok(response);assert.equal(JSON.stringify(response.body).includes(secret),false);
    assert.equal(calls.network,0);assert.equal(calls.writes,0);
    assert.equal(headers['Cache-Control'],'no-store');assert.equal(headers['Referrer-Policy'],'no-referrer');
    return response;
  }};
}
function assertHeld(response) {
  assert.equal(response.status,409);assert.equal(response.body.ok,false);
  assert.equal(response.body.code,'calendar_refresh_recovery_required');
  assert.equal(response.body.recoveryRequired,true);assert.equal(response.body.retryAllowed,false);
  assert.match(response.body.error,/请勿刷新回调页或重复授权/);
  assert.equal(response.body.authorizeUrl,undefined);assert.equal(response.body.diagnostic,undefined);
}
for(const hold of ['code','refresh','lock','stat_error']) {
  test('actual frozen reader blocks /start without begin/URL/cookie: '+hold,async()=>{
    const f=fixture({hold});assertHeld(await f.run());assert.equal(f.calls.begin,0);assert.equal(f.headers['Set-Cookie'],undefined);
  });
  test('actual frozen reader overrides consumed-state callback with durable recovery: '+hold,async()=>{
    const f=fixture({hold});assertHeld(await f.run(callback));assert.equal(f.calls.complete,1);assert.equal(f.calls.begin,0);
    assert.match(f.headers['Set-Cookie'],/Max-Age=0/);assert.equal((await f.reader.status()).recoveryRequired,true);
  });
  test('actual frozen reader blocks even a fresh valid-state callback at its own hold: '+hold,async()=>{
    const f=fixture({hold}),attempt=f.reader.begin();assert.ok(attempt.url);
    assertHeld(await f.run(callback,{query:'code=synthetic_code&state='+encodeURIComponent(attempt.state),cookie:'live_calendar_oauth_state='+attempt.state}));
    assert.equal(f.calls.complete,1);assert.equal(f.calls.begin,0);assert.equal((await f.reader.status()).recoveryRequired,true);
  });
  test('provider cancellation does not conceal or clear actual recovery: '+hold,async()=>{
    const f=fixture({hold});assertHeld(await f.run(callback,{query:'error=access_denied'}));assert.equal(f.calls.complete,0);
    assert.equal((await f.reader.status()).recoveryRequired,true);
  });
  test('actual held status exposes only flags/fixed guidance: '+hold,async()=>{
    const f=fixture({hold});const response=await f.run('/api/lifecycle/calendar-auth/status');
    assert.equal(response.status,200);assert.equal(response.body.calendar.authorized,false);assert.equal(response.body.calendar.recoveryRequired,true);
    assert.deepEqual(Object.keys(response.body.calendar).sort(),['authorized','configured','reason','recoveryRequired','status']);
  });
}
test('actual unconfigured reader cannot begin, without touching its store',async()=>{
  const f=fixture({configured:false}),r=await f.run();assert.equal(r.status,409);assert.equal(r.body.code,'calendar_auth_not_configured');
  assert.equal(f.calls.begin,0);assert.equal(f.calls.reads,0);assert.equal(f.headers['Set-Cookie'],undefined);
});
test('actual missing store allows normal new OAuth URL, but no grant or network action',async()=>{
  const f=fixture(),r=await f.run();assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(f.calls.begin,1);
  const u=new URL(r.body.authorizeUrl);assert.equal(u.origin,'https://accounts.feishu.cn');
  assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.ok(u.searchParams.get('state'));
  assert.match(f.headers['Set-Cookie'],/Max-Age=600/);
});
test('actual unreadable store causes a sanitized 503 without beginning authorization',async()=>{
  const f=fixture({unreadable:true}),r=await f.run();assert.equal(r.status,503);assert.equal(r.body.code,'calendar_auth_status_unavailable');
  assert.equal(f.calls.begin,0);assert.equal(f.headers['Set-Cookie'],undefined);
});
test('actual unreadable store plus state-invalid callback cannot leak filesystem diagnostics',async()=>{
  const f=fixture({unreadable:true}),r=await f.run(callback);assert.equal(r.status,503);assert.equal(r.body.code,'calendar_auth_status_unavailable');
  assert.equal(f.calls.begin,0);assert.match(f.headers['Set-Cookie'],/Max-Age=0/);
});
test('unauthorized and readonly requests never touch actual reader status/complete/begin',async()=>{
  const unauthorized=fixture({hold:'code'});assert.equal((await unauthorized.run(start,{auth:null})).status,403);
  assert.equal((await unauthorized.run('/api/lifecycle/calendar-auth/status',{auth:null})).status,403);
  assert.equal(unauthorized.calls.reads,0);assert.equal(unauthorized.calls.status,0);
  const readonly=fixture({hold:'code',readOnly:true});assert.equal((await readonly.run()).status,423);
  assert.equal((await readonly.run(callback)).status,423);assert.equal(readonly.calls.reads,0);
  assert.equal(readonly.calls.begin,0);assert.equal(readonly.calls.complete,0);
});
