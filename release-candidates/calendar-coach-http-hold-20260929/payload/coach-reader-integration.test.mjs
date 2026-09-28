// Coach consumer + frozen durable reader; in-memory filesystem/provider only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=name=>createHash('sha256').update(readFileSync(new URL(name,import.meta.url))).digest('hex');
assert.equal(sha('./calendar-user-reader.mjs'),'9cbc9be0152abace6365d3f0dadef864dc9402e4b055e26a9d19424c09597912');
globalThis.fetch=async()=>{throw Error('NO_REAL_NETWORK');};
const {createCalendarUserReader}=await import('./calendar-user-reader.mjs');
const {createCoachCalendarAuth}=await import('./coach-calendar-auth.mjs');
const callback='/api/lifecycle/calendar-auth/callback',start='/api/lifecycle/coach-calendar-auth/start',status='/api/lifecycle/coach-calendar-auth/status';
const SECRET='SYNTHETIC_COACH_PRIVATE_CODE_TOKEN_NOT_FOR_PUBLIC';
function fixture({hold=null,configured=true,unreadable=false,lostCode=false,lostRefresh=false,readOnly=false}={}){
 const calls={writes:0,network:0,codePosts:0,refreshPosts:0,begin:0,complete:0,status:0,reads:0};
 let now=1000000,currentHold=hold;
 const root='/synthetic-coach-fixture',storePath=root+'/coach.enc',files=new Map(),dirs=new Set([root]);
 const pathFor={code:storePath+'.code-hold.json',refresh:storePath+'.refresh-hold.json',lock:storePath+'.lock'};
 const failure=code=>Object.assign(Error(SECRET),{code});
 const fsImpl={
  async stat(path){calls.reads++;if(currentHold==='stat_error')throw failure('EIO');if(path===pathFor[currentHold]||files.has(path)||dirs.has(path))return {};throw failure('ENOENT');},
  async readFile(path){calls.reads++;if(unreadable)throw failure('EIO');if(!files.has(path))throw failure('ENOENT');return files.get(path);},
  async mkdir(path,options={}){calls.writes++;if(dirs.has(path)){if(options.recursive)return;throw failure('EEXIST');}dirs.add(path);},
  async open(path,mode){calls.writes++;if(mode==='r'){assert(dirs.has(path));return {async sync(){},async close(){}};}
   assert.equal(mode,'wx');if(files.has(path))throw failure('EEXIST');files.set(path,'');
   return {async writeFile(raw){files.set(path,String(raw));},async sync(){},async close(){}};},
  async rename(from,to){calls.writes++;if(!files.has(from))throw failure('ENOENT');files.set(to,files.get(from));files.delete(from);},
  async unlink(path){calls.writes++;if(!files.delete(path))throw failure('ENOENT');},
  async rmdir(path){calls.writes++;if(!dirs.delete(path))throw failure('ENOENT');}
 };
 const provider=async(url,options)=>{
  calls.network++;
  if(url==='https://open.feishu.cn/open-apis/authen/v2/oauth/token'){
   calls.codePosts++;assert.match(options.headers['Content-Type'],/^application\/json/);
   const body=JSON.parse(options.body);assert.equal(body.grant_type,'authorization_code');assert.equal(body.code,'synthetic_code');
   if(lostCode)throw failure('LOST_RESPONSE');
   return {ok:true,status:200,json:async()=>({code:0,access_token:SECRET+'A',refresh_token:SECRET+'R',expires_in:600,refresh_token_expires_in:7200,
    scope:'calendar:calendar:read calendar:calendar.event:read offline_access'})};
  }
  if(url==='https://accounts.feishu.cn/oauth/v3/token'){
   calls.refreshPosts++;assert.equal(new URLSearchParams(options.body).get('grant_type'),'refresh_token');
   if(lostRefresh)throw failure('LOST_RESPONSE');throw Error('unexpected refresh positive fixture');
  }
  if(url.endsWith('/authen/v1/user_info'))return {ok:true,json:async()=>({code:0,data:{open_id:'ou_synthetic_coach'}})};
  if(url.includes('/calendars/primary?'))return {ok:true,json:async()=>({code:0,data:{calendars:[{user_id:'ou_synthetic_coach',calendar:{calendar_id:'synthetic_calendar',type:'primary',is_deleted:false}}]}})};
  if(url.endsWith('/calendars/synthetic_calendar'))return {ok:true,json:async()=>({code:0,data:{calendar:{role:'owner'}}})};
  throw Error('UNEXPECTED_MOCK_NETWORK');
 };
 const makeReader=()=>createCalendarUserReader({appId:configured?'cli_synthetic_coach':'',appSecret:SECRET,calendarId:'synthetic_calendar',
  expectedOpenId:'ou_synthetic_coach',ownerLabel:'Fictional Coach',requireOwnPrimaryCalendar:true,allowInstanceView:true,
  redirectUri:'https://fixture.invalid/modules/live'+callback,storePath,encryptionKey:Buffer.alloc(32,9).toString('base64'),
  fsImpl,directorySyncImpl:async()=>{},fetchImpl:provider,now:()=>now,diagnostic:()=>{}});
 const actor={ok:true,mode:'central',user:{number:'SYNTH-COACH',realName:'Fictional Coach',open_id:'ou_synthetic_coach'}};
 const build=reader=>createCoachCalendarAuth({readers:{roomA:{
  status:()=>{calls.status++;return reader.status();},begin:()=>{calls.begin++;return reader.begin();},
  complete:value=>{calls.complete++;return reader.complete(value);}}},
  coachNames:{roomA:'Fictional Coach'},employeeNos:{roomA:'SYNTH-COACH'},openIds:{roomA:'ou_synthetic_coach'},basePath:'/modules/live',
  enabled:true,readOnly,clock:()=>now,verifyActor:async()=>{},json:(res,code,body)=>{res.status=code;res.body=body;}});
 let reader=makeReader(),handler=build(reader);
 const req=(method,cookie='')=>({method,headers:{host:'fixture.invalid',origin:'https://fixture.invalid','x-requested-with':'XMLHttpRequest',cookie}});
 function res(){return {headers:{},status:0,body:null,setHeader(k,v){this.headers[k]=v;},writeHead(s,h){this.status=s;Object.assign(this.headers,h);},end(body){this.body=body;}};}
 function safe(value){assert.equal(JSON.stringify(value.body).includes(SECRET),false);return value;}
 return {calls,files,dirs,pathFor,reader,
  setHold(value){currentHold=value;},advance(value){now+=value;},restart(){reader=makeReader();handler=build(reader);return reader;},
  async api(path=start,auth=actor){const output=res();assert.equal(await handler.handleApi(req(path===start?'POST':'GET'),output,path,auth),true);return safe(output);},
  async callback(state,query=''){const output=res();assert.equal(await handler.handleCallback(req('GET','live_coach_calendar_oauth_state='+state),output,
   new URL('https://fixture.invalid'+callback+'?state='+encodeURIComponent(state)+'&code=synthetic_code'+query)),true);return safe(output);}
 };
}
const stateOf=r=>r.headers['Set-Cookie'].match(/^[^=]+=([^;]+)/)[1];
function heldApi(r){assert.equal(r.status,409);assert.equal(r.body.code,'calendar_refresh_recovery_required');assert.equal(r.body.retryAllowed,false);assert.equal(r.body.authorizeUrl,undefined);}
function heldPage(r){assert.equal(r.status,409);assert.match(r.body,/请勿刷新回调页或重复授权/);assert.doesNotMatch(r.body,/本人日历授权完成|请由本人重新发起/);}
for(const hold of ['code','refresh','lock','stat_error']){
 test('actual durable reader hold blocks coach start with no begin/cookie/provider/write: '+hold,async()=>{
  const f=fixture({hold});const r=await f.api();heldApi(r);assert.equal(r.headers['Set-Cookie'],undefined);
  assert.equal(f.calls.begin,0);assert.equal(f.calls.writes,0);assert.equal(f.calls.network,0);
 });
 test('actual durable reader projects held coach status without grant metadata: '+hold,async()=>{
  const f=fixture({hold}),r=await f.api(status);assert.equal(r.status,200);assert.equal(r.body.calendar.authorized,false);assert.equal(r.body.calendar.recoveryRequired,true);
  assert.deepEqual(Object.keys(r.body.calendar).sort(),['authorized','configured','reason','recoveryRequired','retryAllowed','status']);assert.equal(f.calls.network,0);assert.equal(f.calls.writes,0);
 });
 for(const mode of ['normal','cancelled','expired'])test('matched coach callback cannot bypass a newly appearing actual hold '+hold+'/'+mode,async()=>{
  const f=fixture(),began=await f.api();assert.equal(began.status,200);f.setHold(hold);if(mode==='expired')f.advance(600001);
  heldPage(await f.callback(stateOf(began),mode==='cancelled'?'&error=access_denied':''));
  assert.equal(f.calls.complete,0);assert.equal(f.calls.network,0);assert.equal(f.calls.writes,0);
 });
}
test('actual configured missing store starts only synthetic PKCE URL, no credential write',async()=>{
 const f=fixture(),r=await f.api();assert.equal(r.status,200);const u=new URL(r.body.authorizeUrl);
 assert.equal(u.origin,'https://accounts.feishu.cn');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.equal(f.calls.network,0);assert.equal(f.calls.writes,0);
});
test('actual configured=false and unreadable store fail closed without begin',async()=>{
 for(const options of [{configured:false},{unreadable:true}]){const f=fixture(options),r=await f.api();assert.equal(r.status,options.configured===false?409:503);assert.equal(f.calls.begin,0);assert.equal(f.calls.network,0);assert.equal(f.calls.writes,0);}
});
test('actual own-primary successful v2 exchange is encrypted, no hold and strict authorized callback',async()=>{
 const f=fixture(),r=await f.api(),done=await f.callback(stateOf(r));assert.equal(done.status,200);assert.match(done.body,/本人日历授权完成/);
 assert.equal((await f.reader.status()).authorized,true);assert.equal(f.calls.codePosts,1);assert.equal(f.calls.refreshPosts,0);
 assert.equal(f.files.size,1);assert.doesNotMatch([...f.files.values()][0],/SYNTHETIC_COACH_PRIVATE|ou_synthetic_coach/);
 assert.equal(f.dirs.has(f.pathFor.lock),false);assert.equal(f.files.has(f.pathFor.code),false);
});
test('actual code response uncertainty stays held across new reader/process and next start never resends',async()=>{
 const f=fixture({lostCode:true}),r=await f.api();heldPage(await f.callback(stateOf(r)));
 assert.equal(f.calls.codePosts,1);assert.equal(f.calls.network,1);assert(f.files.has(f.pathFor.code));assert(f.dirs.has(f.pathFor.lock));
 assert.equal((await f.reader.status()).recoveryRequired,true);const restarted=f.restart();assert.equal((await restarted.status()).recoveryRequired,true);
 heldApi(await f.api());assert.equal(f.calls.codePosts,1);assert.equal(f.calls.begin,1);assert.equal(f.calls.complete,1);
 for(const raw of f.files.values())assert.doesNotMatch(raw,/synthetic_code|SYNTHETIC_COACH_PRIVATE/);
});
test('actual refresh response uncertainty cannot be hidden by old valid grant or next coach start',async()=>{
 const f=fixture({lostRefresh:true}),r=await f.api();assert.equal((await f.callback(stateOf(r))).status,200);f.advance(400000);
 await assert.rejects(f.reader.get('/calendar/v4/calendars/synthetic_calendar/events'),{code:'calendar_refresh_recovery_required'});
 const restarted=f.restart();assert.equal((await restarted.status()).recoveryRequired,true);heldApi(await f.api());
 assert.equal(f.calls.codePosts,1);assert.equal(f.calls.refreshPosts,1);assert.equal(f.calls.begin,1);
 await assert.rejects(restarted.get('/calendar/v4/calendars/synthetic_calendar/events'),{code:'calendar_refresh_recovery_required'});
 assert.equal(f.calls.refreshPosts,1);
});
test('unauthorized and read-only coach requests never inspect or mutate actual grant',async()=>{
 const a=fixture({hold:'code'});assert.equal((await a.api(start,null)).status,403);assert.equal(a.calls.status,0);assert.equal(a.calls.reads,0);
 const b=fixture({hold:'code',readOnly:true});assert.equal((await b.api()).status,423);assert.equal(b.calls.status,0);assert.equal(b.calls.reads,0);
});
