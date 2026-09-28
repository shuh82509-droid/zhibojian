// Exact HTML static script in a synthetic DOM. No browser, OAuth, or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root='H:/codex输出/直播五环节工作流-20260923/calendar-consumer-contracts-exact-20260929';
const originalSha='e8007e507a7c35ca1812eda829a2b29bc89713b7e945f414d12930dffc4faebb';
const candidateSha='37b6b2ccca8dd003a4cc84273ba3a400fd7470119f2585baf6a4ae6097272351';
const finalSha='e4da5da418e4d54a6127eee96670ce12e004007065b9521bf398cccac7e3c187';
function pathAndPin(pathEnv,shaEnv,defaultPath,defaultSha,permitted) {
  const hasPath=Object.hasOwn(process.env,pathEnv),hasSha=Object.hasOwn(process.env,shaEnv);
  assert.equal(hasPath,hasSha,`${pathEnv}/${shaEnv} must be supplied together`);
  if(!hasPath)return {path:defaultPath,sha:defaultSha};
  const suppliedPath=process.env[pathEnv],suppliedSha=process.env[shaEnv];
  assert.ok(typeof suppliedPath==='string'&&suppliedPath.length>0,`${pathEnv} must be nonempty`);
  assert.ok(permitted.includes(suppliedSha),`${shaEnv} is not an exact audited source pin`);
  return {path:suppliedPath,sha:suppliedSha};
}
const sourceReference=pathAndPin('WIS_COACH_PAGE_ORIGINAL','WIS_COACH_PAGE_ORIGINAL_SHA',
  process.platform==='win32'?root+'/reference/site/coach-calendar.html':fileURLToPath(new URL('./coach-calendar.original.html',import.meta.url)),originalSha,[originalSha]);
const selected=pathAndPin('WIS_COACH_PAGE_TARGET','WIS_COACH_PAGE_SHA',
  process.platform==='win32'?root+'/candidate/site/coach-calendar.html':fileURLToPath(new URL('./coach-calendar.html',import.meta.url)),finalSha,[originalSha,candidateSha,finalSha]);
const hash=b=>createHash('sha256').update(b).digest('hex');
const original=readFileSync(sourceReference.path),target=readFileSync(selected.path);
assert.equal(hash(original),sourceReference.sha);assert.equal(hash(target),selected.sha);
function parts(bytes) {
  const start=bytes.indexOf(Buffer.from('<script>')),end=bytes.indexOf(Buffer.from('</script>'));
  assert.ok(start>=0 && end>start);assert.equal(bytes.indexOf(Buffer.from('<script>'),start+1),-1);
  return {prefix:bytes.subarray(0,start+8),script:bytes.subarray(start+8,end).toString(),suffix:bytes.subarray(end)};
}
const script=parts(target).script;
const flush=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const normal={ok:true,enabled:true,coachName:'Fixture Coach',room:'fixture-room',calendar:{configured:true,authorized:false}};
const reply=(body=normal,{ok=true,jsonError=null}={})=>({ok,json:async()=>{if(jsonError)throw jsonError;return body;}});
function fixture(fetchImpl=async()=>reply()) {
  const elements={status:{textContent:''},authorize:{disabled:true,onclick:null},refresh:{disabled:false,onclick:null}};
  const calls=[],destinations=[];
  const fetch=async(url,options={})=>{calls.push({action:url.split('/').at(-1),method:options.method||'GET',options});return fetchImpl(url,options,calls.length);};
  vm.runInNewContext(script,{document:{getElementById:id=>elements[id]},location:{pathname:'/live/coach-calendar.html'},URL,fetch,
    window:{top:{location:{assign(value){destinations.push(value);}}}}});
  return {elements,calls,destinations,postCount:()=>calls.filter(x=>x.method==='POST').length};
}
async function readyFixture(startReply) {
  const value=fixture(async(url)=>url.endsWith('/status')?reply():typeof startReply==='function'?startReply():startReply||reply({ok:true,authorizeUrl:'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=fixture'}));
  await flush();assert.equal(value.elements.authorize.disabled,false);return value;
}
test('target preserves exact layout/CSS/all bytes outside one static script',()=>{
  const old=parts(original),next=parts(target);assert.deepEqual(next.prefix,old.prefix);assert.deepEqual(next.suffix,old.suffix);
});
test('normal reduced public fields permit exactly one safe start and navigation',async()=>{
  const f=await readyFixture();await f.elements.authorize.onclick();
  assert.equal(f.postCount(),1);assert.equal(f.destinations.length,1);assert.match(f.destinations[0],/^https:\/\/accounts\.feishu\.cn\//);assert.equal(f.elements.authorize.disabled,true);
});
for(const [name,data]of [
  ['already authorized',{...normal,calendar:{configured:true,authorized:true}}],
  ['readOnly/disabled',{...normal,enabled:false}],
  ['unconfigured',{...normal,calendar:{configured:false,authorized:false}}],
  ['persistent status hold',{...normal,calendar:{configured:true,authorized:false,status:'recovery_required'}}],
  ['recoveryRequired true',{...normal,calendar:{configured:true,authorized:false,recoveryRequired:true}}],
  ['retryAllowed false',{...normal,calendar:{configured:true,authorized:false,retryAllowed:false}}],
  ['inconsistent authorized/configured',{...normal,calendar:{configured:false,authorized:true}}],
  ['missing configured',{...normal,calendar:{authorized:false}}],
  ['missing authorized',{...normal,calendar:{configured:true}}],
  ['calendar array',{...normal,calendar:[]}],
  ['calendar null',{...normal,calendar:null}],
  ['calendar string',{...normal,calendar:'ready'}],
  ['string configured',{...normal,calendar:{configured:'yes',authorized:false}}],
  ['string authorized',{...normal,calendar:{configured:true,authorized:'no'}}],
  ['string enabled',{...normal,enabled:'true'}],
  ['missing enabled',{...normal,enabled:undefined}],
  ['unknown status',{...normal,calendar:{configured:true,authorized:false,status:'ready'}}],
  ['nonbool recoveryRequired',{...normal,calendar:{configured:true,authorized:false,recoveryRequired:'false'}}],
  ['nonbool retryAllowed',{...normal,calendar:{configured:true,authorized:false,retryAllowed:'true'}}],
  ['missing ok',{...normal,ok:undefined}],
  ['false ok',{...normal,ok:false}],
  ['status null',null],
])test(`unsafe/nonready status never permits a POST: ${name}`,async()=>{
  const f=fixture(async()=>reply(data));await flush();assert.equal(f.elements.authorize.disabled,true);
  await f.elements.authorize.onclick();assert.equal(f.postCount(),0);
});
test('status response error is not echoed and stays disabled',async()=>{
  const f=fixture(async()=>reply({ok:false,error:'fixture-secret-status'},{ok:false}));await flush();
  assert.equal(f.elements.authorize.disabled,true);assert.equal(f.elements.status.textContent.includes('fixture-secret'),false);
});
test('status network throw is not echoed and stays disabled',async()=>{
  const f=fixture(async()=>{throw new Error('fixture-secret-network');});await flush();
  assert.equal(f.elements.authorize.disabled,true);assert.equal(f.elements.status.textContent.includes('fixture-secret'),false);
});
test('status JSON throw is not echoed and stays disabled',async()=>{
  const f=fixture(async()=>reply(null,{jsonError:new Error('fixture-secret-json')}));await flush();
  assert.equal(f.elements.authorize.disabled,true);assert.equal(f.elements.status.textContent.includes('fixture-secret'),false);
});
for(const [name,start]of [
  ['HTTP hold',()=>reply({ok:false,code:'calendar_refresh_recovery_required',error:'fixture-secret-hold',retryAllowed:false},{ok:false})],
  ['HTTP ordinary failure',()=>reply({ok:false,error:'fixture-secret-response'},{ok:false})],
  ['network unknown',()=>{throw new Error('fixture-secret-network');}],
  ['JSON unknown',()=>reply(null,{jsonError:new Error('fixture-secret-json')})],
  ['null JSON',()=>reply(null)],
  ['ok false on HTTP200',()=>reply({ok:false,authorizeUrl:'https://accounts.feishu.cn/fixture'})],
])test(`start failure never reopens button or reflects error: ${name}`,async()=>{
  const f=await readyFixture(start);await f.elements.authorize.onclick();assert.equal(f.postCount(),1);
  assert.equal(f.elements.authorize.disabled,true);assert.equal(f.destinations.length,0);assert.equal(f.elements.status.textContent.includes('fixture-secret'),false);
  await f.elements.authorize.onclick();assert.equal(f.postCount(),1);
});
for(const destination of ['http://accounts.feishu.cn/path','https://evil.invalid/path','https://accounts.feishu.cn.evil.invalid/path',
  'https://user:pass@accounts.feishu.cn/path','https://accounts.feishu.cn:8443/path','javascript:alert(1)','/relative','not-a-url',''])
  test(`untrusted redirect stays blocked without auto retry: ${destination||'empty'}`,async()=>{
    const f=await readyFixture(reply({ok:true,authorizeUrl:destination}));await f.elements.authorize.onclick();
    assert.equal(f.destinations.length,0);assert.equal(f.elements.authorize.disabled,true);await f.elements.authorize.onclick();assert.equal(f.postCount(),1);
  });
test('rapid duplicate/queued click while fetch pending cannot POST twice',async()=>{
  const pending=deferred(),f=await readyFixture(()=>pending.promise);const first=f.elements.authorize.onclick(),second=f.elements.authorize.onclick();
  await flush();assert.equal(f.postCount(),1);assert.equal(f.elements.authorize.disabled,true);
  pending.resolve(reply({ok:false},{ok:false}));await Promise.all([first,second]);
});
test('rapid duplicate/queued click while JSON pending cannot POST twice',async()=>{
  const pending=deferred(),f=await readyFixture(()=>({ok:true,json:()=>pending.promise}));const first=f.elements.authorize.onclick(),second=f.elements.authorize.onclick();
  await flush();assert.equal(f.postCount(),1);assert.equal(f.elements.authorize.disabled,true);
  pending.resolve({ok:false});await Promise.all([first,second]);
});
test('refresh during pending start does not fetch status/reopen/button or POST again',async()=>{
  const pending=deferred(),f=await readyFixture(()=>pending.promise);const first=f.elements.authorize.onclick();
  const before=f.calls.length;await f.elements.refresh.onclick();await flush();assert.equal(f.calls.length,before);assert.equal(f.elements.authorize.disabled,true);
  await f.elements.authorize.onclick();assert.equal(f.postCount(),1);pending.resolve(reply({ok:false},{ok:false}));await first;
});
test('older ready status cannot overtake newer disabled status',async()=>{
  const older=deferred();let statusCalls=0;const f=fixture(async()=>++statusCalls===1?older.promise:reply({...normal,enabled:false}));
  await f.elements.refresh.onclick();older.resolve(reply());await flush();assert.equal(f.elements.authorize.disabled,true);
  await f.elements.authorize.onclick();assert.equal(f.postCount(),0);
});
test('older pending status cannot reenable button after a start began',async()=>{
  const older=deferred(),post=deferred();let statusCalls=0;const f=fixture(async(url)=>url.endsWith('/start')?post.promise:++statusCalls===1?older.promise:reply());
  await f.elements.refresh.onclick();assert.equal(f.elements.authorize.disabled,false);const first=f.elements.authorize.onclick();
  older.resolve(reply());await flush();assert.equal(f.elements.authorize.disabled,true);await f.elements.authorize.onclick();assert.equal(f.postCount(),1);
  post.resolve(reply({ok:false},{ok:false}));await first;
});
test('older status after failed start still cannot silently enable a second POST',async()=>{
  const older=deferred();let statusCalls=0;const f=fixture(async(url)=>url.endsWith('/start')?reply({ok:false},{ok:false}):++statusCalls===1?older.promise:reply());
  await f.elements.refresh.onclick();await f.elements.authorize.onclick();older.resolve(reply());await flush();assert.equal(f.elements.authorize.disabled,true);
  await f.elements.authorize.onclick();assert.equal(f.postCount(),1);
});

test('ok:true plus held flags and a valid trusted URL never navigates, reopens, or retries',async()=>{
  for(const held of [{retryAllowed:false},{recoveryRequired:true},{status:'recovery_required'},{code:'calendar_refresh_recovery_required'}]){
    const f=await readyFixture(reply({ok:true,authorizeUrl:'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=fixture',...held}));
    await f.elements.authorize.onclick();assert.equal(f.postCount(),1);assert.equal(f.destinations.length,0);
    assert.equal(f.elements.authorize.disabled,true);await f.elements.authorize.onclick();assert.equal(f.postCount(),1);
  }
});

