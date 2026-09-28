import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,createHash} from 'node:crypto';
import {readFile as readActualFile} from 'node:fs/promises';
import {createCalendarUserReader} from './calendar-user-reader.mjs';

// Every credential, actor, URL, response and filesystem below is synthetic.
// The imported reader receives no default/global fetch or real OAuth store.
const clock = Date.parse('2026-09-28T14:00:00.000Z');
const storePath = '/synthetic/calendar.store';
const holdPath = `${storePath}.refresh-hold.json`, lockPath = `${storePath}.lock`;
const calendarId = 'synthetic-calendar', actor = 'ou_synthetic_actor';
const scopes = 'calendar:calendar:read calendar:calendar.event:read offline_access';
const key = Buffer.alloc(32,7);
const context = Buffer.from(JSON.stringify(['synthetic-app',calendarId,actor]));
const contextHash = createHash('sha256').update(context).digest('hex');
const fixtureRecord = overrides=>({openId:actor,accessToken:'SYNTHETIC_ACCESS_OLD',accessExpiresAt:clock-1000,
  refreshToken:'SYNTHETIC_REFRESH_OLD',refreshExpiresAt:clock+86400000,scopes,...overrides});
const fixtureGrant = overrides=>({code:0,access_token:'SYNTHETIC_ACCESS_NEW',refresh_token:'SYNTHETIC_REFRESH_NEW',
  expires_in:7200,refresh_token_expires_in:86400,scope:scopes,...overrides});
function encrypted(record) {
  const iv = Buffer.alloc(12,3), cipher = createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(context);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(record),'utf8'),cipher.final()]);
  return JSON.stringify({version:2,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')});
}
function fault(code='SYNTHETIC_IO_FAILURE') { return Object.assign(new Error(code),{code}); }
const response=data=>({ok:true,status:200,headers:{get:()=>''},json:async()=>data});

class FixtureFS {
  constructor(record=fixtureRecord()) {
    this.files=new Map([[storePath,encrypted(record)]]); this.dirs=new Set(['/synthetic']);
    this.durableFiles=new Map(this.files); this.durableDirs=new Set(this.dirs);
    this.events=[]; this.hook=null;
    this.api=Object.fromEntries(['mkdir','readFile','rename','open','unlink','rmdir','stat'].map(name=>[name,this[name].bind(this)]));
  }
  async step(op,path,operation) {
    const before={op,path,phase:'before'}; this.events.push(before); if(this.hook) await this.hook(before,this);
    const result=await operation();
    const after={op,path,phase:'after'}; this.events.push(after); if(this.hook) await this.hook(after,this);
    return result;
  }
  async mkdir(path,{recursive=false}={}) { return this.step('mkdir',path,()=>{
    if(this.dirs.has(path)) {if(recursive)return;throw fault('EEXIST');}
    this.dirs.add(path);
  }); }
  async stat(path) {return this.step('stat',path,()=>{
    if(this.dirs.has(path))return {isDirectory:()=>true,isFile:()=>false};
    if(this.files.has(path))return {isDirectory:()=>false,isFile:()=>true};
    throw fault('ENOENT');
  });}
  async readFile(path) { return this.step('readFile',path,()=>{if(!this.files.has(path))throw fault('ENOENT');return this.files.get(path);}); }
  async rename(from,to) { return this.step('rename',to,()=>{
    if(!this.files.has(from))throw fault('ENOENT');this.files.set(to,this.files.get(from));this.files.delete(from);
  }); }
  async unlink(path) {return this.step('unlink',path,()=>{if(!this.files.delete(path))throw fault('ENOENT');});}
  async rmdir(path) {return this.step('rmdir',path,()=>{if(!this.dirs.delete(path))throw fault('ENOENT');});}
  async open(path,flags) { return this.step('open',path,()=>{
    if(flags==='wx') {if(this.files.has(path))throw fault('EEXIST');this.files.set(path,'');}
    else if(!this.files.has(path)&&!this.dirs.has(path))throw fault('ENOENT');
    return {
      writeFile:value=>this.step('writeFile',path,()=>{this.files.set(path,value);}),
      sync:()=>this.step('fileSync',path,()=>{}),
      close:()=>this.step('close',path,()=>{}),
    };
  });}
  async directorySync(path) {return this.step('directorySync',path,()=>{
    this.durableFiles=new Map(this.files);this.durableDirs=new Set(this.dirs);
  });}
  restart({crash=false}={}) {
    const copy=new FixtureFS();copy.files=new Map(crash?this.durableFiles:this.files);
    copy.dirs=new Set(crash?this.durableDirs:this.dirs);
    copy.durableFiles=new Map(copy.files);copy.durableDirs=new Set(copy.dirs);return copy;
  }
}
function fixture({fs=new FixtureFS(),grant=fixtureGrant(),codeGrant=fixtureGrant(),request,now=()=>clock,extra={}}={}) {
  const counts={refresh:0,native:0,code:0,user:0};
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url,method:options.method||'GET'});
    if(url==='https://accounts.feishu.cn/oauth/v3/token') {
      counts.refresh++;
      assert.ok(fs.files.has(holdPath),'durable intent exists before refresh POST');
      assert.ok(fs.dirs.has(lockPath),'same-store lock exists before refresh POST');
      assert.ok(fs.durableFiles.has(holdPath),'intent was directory-fsynced before POST');
      const raw=fs.files.get(holdPath);
      for(const forbidden of ['SYNTHETIC_ACCESS','SYNTHETIC_REFRESH','synthetic-secret','synthetic-code'])assert.ok(!raw.includes(forbidden));
      if(request)return request(url,options,counts,fs);
      return response(grant);
    }
    if(url==='https://open.feishu.cn/open-apis/authen/v2/oauth/token') {counts.code++;return response(codeGrant);}
    if(url==='https://open.feishu.cn/open-apis/authen/v1/user_info') {counts.user++;return response({code:0,data:{open_id:actor}});}
    counts.native++;
    assert.ok(fs.dirs.has(lockPath),'read/verify is covered by the same-store lock');
    if(request)return request(url,options,counts,fs);
    return response({code:0,data:{calendar:{role:'reader'},items:[],has_more:false}});
  };
  const opts={appId:'synthetic-app',appSecret:'synthetic-secret',calendarId,expectedOpenId:actor,
    redirectUri:'https://synthetic.invalid/oauth/callback',storePath,encryptionKey:key.toString('base64'),
    fetchImpl,now,diagnostic:()=>{},fsImpl:fs.api,directorySyncImpl:path=>fs.directorySync(path),...extra};
  const reader=createCalendarUserReader(opts);
  return {reader,fs,counts,calls,opts};
}
const eventPath=`/calendar/v4/calendars/${calendarId}/events?start_time=1&end_time=2`;
async function assertHeld(fs) {
  const next=fixture({fs});
  const status=await next.reader.status();assert.equal(status.authorized,false);assert.equal(status.status,'recovery_required');
  await assert.rejects(next.reader.get(eventPath),error=>['calendar_refresh_recovery_required','calendar_authorization_busy'].includes(error.code));
  await assert.rejects(next.reader.verifyCalendar(calendarId),error=>['calendar_refresh_recovery_required','calendar_authorization_busy'].includes(error.code));
  assert.deepEqual(next.counts,{refresh:0,native:0,code:0,user:0});
}
function failOnce(fs,predicate) {
  let fired=false;
  fs.hook=async(event,state)=>{if(!fired&&predicate(event,state)){fired=true;throw fault();}};
  return ()=>assert.ok(fired,'synthetic failure boundary was reached');
}

test('exact native reader reference is retained, and no server entrypoint is imported',async()=>{
  const raw=await readActualFile(new URL('./calendar-user-reader.original.mjs',import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'),'a2dc5930d00b37113c98c515dbe9e43682e0ec49b0280f8dc76095720f5e7f97');
  assert.deepEqual(Object.keys(fixture().reader).sort(),['begin','calendarId','complete','get','status','verifyCalendar']);
});
test('PKCE v1/v2 and the original read-only scopes remain unchanged',()=>{
  const result=fixture().reader.begin(),url=new URL(result.url);
  assert.equal(url.pathname,'/open-apis/authen/v1/authorize');assert.equal(url.searchParams.get('scope'),scopes);
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('code_challenge'));
});
test('source scope preserves exact crypto, endpoints, PKCE, coach ownership and default read-policy bytes',async()=>{
  const original=await readActualFile(new URL('./calendar-user-reader.original.mjs',import.meta.url),'utf8');
  const candidate=await readActualFile(new URL('./calendar-user-reader.mjs',import.meta.url),'utf8');
  const section=(source,start,end)=>{
    const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
    assert.ok(a>=0&&b>a,`unique required source section ${start}`);
    assert.equal(source.indexOf(start,a+start.length),-1,`no second ${start}`);
    return source.slice(a,b);
  };
  for(const [start,end]of [
    ['const requiredScopes =','const userInfoEndpoint ='],
    ['  const same =','  async function load()'],
    ['  async function load()','  async function save(value)'],
    ['  function begin()','  async function tokenRequest(body)'],
    ['  async function tokenRequest(body)','  async function getUserInfo(accessToken)'],
    ['  async function getUserInfo(accessToken)','  async function verifyCalendarAccess(accessToken'],
    ['  async function verifyCalendarAccess(accessToken','  function recordFrom(data, openId)'],
  ]) {
    let expected=section(original,start,end);
    let actual;
    if(start==='  const same =')actual=section(candidate,start,'  const recoveryRequired =');
    else if(start==='  async function verifyCalendarAccess(accessToken')actual=section(candidate,start,'  function refreshedRecord(data, openId)');
    else actual=section(candidate,start,end);
    assert.equal(actual,expected,start);
  }
  const beforeGetBody=source=>section(source,'  async function get(path)','  async function verifyCalendar(targetCalendarId)')
    .split(source===original?'    const response = await fetchImpl':'    return withReadableCredential')[0];
  assert.equal(beforeGetBody(candidate),beforeGetBody(original));
  assert.equal(section(candidate,'  async function complete({code, state, cookieState})','    return exclusive'),
    section(original,'  async function complete({code, state, cookieState})','    return exclusive'));
  for(const line of [
    "const userInfoEndpoint = 'https://open.feishu.cn/open-apis/authen/v1/user_info';",
    "  const permittedCalendars = new Set([calendarId, ...(Array.isArray(additionalCalendarIds) ? additionalCalendarIds : [])].filter(value => typeof value === 'string' && /^[A-Za-z0-9_@.\\-]{3,256}$/u.test(value)));",
    '  return {calendarId, status, begin, complete, get, verifyCalendar};',
  ])assert.ok(original.includes(line)&&candidate.includes(line),line);
});
test('unconfigured get performs no filesystem mutation or request',async()=>{
  const item=fixture({extra:{appId:''}});await assert.rejects(item.reader.get(eventPath),{code:'calendar_auth_not_configured'});
  assert.equal(item.fs.events.length,0);assert.equal(item.calls.length,0);
});
for(const path of [
  '/authen/v1/user_info',`/calendar/v4/calendars/${calendarId}`,`/calendar/v4/calendars/${calendarId}/events?anchor_time=1`,
  '/calendar/v4/calendars/unapproved/events',`/calendar/v4/calendars/${calendarId}/events/instance_view`,
  `/calendar/v4/calendars/${calendarId}/events?arbitrary=1`,
])test(`original default read allowlist rejects ${path}`,async()=>{
  const item=fixture();await assert.rejects(item.reader.get(path),{code:'calendar_path_denied'});assert.equal(item.calls.length,0);
});
for(const method of ['get','verifyCalendar'])test(`cached access is guarded and locked for ${method}`,async()=>{
  const item=fixture({fs:new FixtureFS(fixtureRecord({accessExpiresAt:clock+7200000}))});
  if(method==='get')await item.reader.get(eventPath);else await item.reader.verifyCalendar(calendarId);
  assert.equal(item.counts.refresh,0);assert.equal(item.counts.native,1);assert.equal(item.fs.dirs.has(lockPath),false);
});
test('successful refresh saves/readbacks, clears/fsyncs hold, then releases lock and uses new grant',async()=>{
  const item=fixture();await item.reader.get(eventPath);
  assert.deepEqual(item.counts,{refresh:1,native:1,code:0,user:0});
  assert.equal(item.fs.files.has(holdPath),false);assert.equal(item.fs.dirs.has(lockPath),false);
  const next=fixture({fs:item.fs.restart()});await next.reader.get(eventPath);
  assert.equal(next.counts.refresh,0);assert.equal(next.counts.native,1);assert.equal((await next.reader.status()).authorized,true);
});
test('intent is no-secret, exact shape and not an assertion of an invoked POST',async()=>{
  let observed;
  const item=fixture({request:async(url,options,counts,fs)=>{
    if(counts.refresh===1&&url.includes('/oauth/v3/')){observed=JSON.parse(fs.files.get(holdPath));throw fault('SYNTHETIC_NETWORK');}
    throw fault();
  }});
  await assert.rejects(item.reader.get(eventPath));
  assert.deepEqual(Object.keys(observed),['schemaVersion','kind','contextSha256','attemptId','createdAt']);
  assert.equal(observed.contextSha256,contextHash);assert.equal(observed.kind,'calendar_refresh_intent');
  assert.match(observed.attemptId,/^[a-f0-9]{32}$/u);assert.equal(observed.createdAt,new Date(clock).toISOString());
  await assertHeld(item.fs.restart({crash:true}));
});

for(const op of ['open','writeFile','fileSync','close','rename','directorySync'])for(const phase of ['before','after']) {
  test(`intent ${op}/${phase} failure causes zero POST and preserves quarantine`,async()=>{
    const item=fixture();
    const reached=failOnce(item.fs,event=>event.op===op&&event.phase===phase
      && (op==='directorySync'||event.path.startsWith(holdPath)));
    await assert.rejects(item.reader.get(eventPath),{code:'calendar_refresh_recovery_required'});reached();
    assert.equal(item.counts.refresh,0);assert.equal(item.counts.native,0);await assertHeld(item.fs.restart());
  });
}
for(const readNumber of [1,2])for(const phase of ['before','after'])test(`intent readback ${readNumber}/${phase} failure does not POST`,async()=>{
  const item=fixture();let reads=0;
  const reached=failOnce(item.fs,event=>{
    if(event.op==='readFile'&&event.path===holdPath&&event.phase==='before')reads++;
    return event.op==='readFile'&&event.path===holdPath&&event.phase===phase&&reads===readNumber;
  });
  await assert.rejects(item.reader.get(eventPath));reached();assert.equal(item.counts.refresh,0);await assertHeld(item.fs.restart());
});
test('duplicate decoded marker keys are rejected before POST',async()=>{
  const item=fixture();let modified=false;
  item.fs.hook=async(event,fs)=>{
    if(!modified&&event.op==='readFile'&&event.path===holdPath&&event.phase==='before'){
      modified=true;const raw=fs.files.get(holdPath);fs.files.set(holdPath,raw.replace('{','{"schemaVersion":1,'));
    }
  };
  await assert.rejects(item.reader.get(eventPath));assert.ok(modified);assert.equal(item.counts.refresh,0);await assertHeld(item.fs.restart());
});

const badResponses=[
  ['network',async()=>{throw fault('SYNTHETIC_TIMEOUT');}],
  ['JSON parse',async()=>({ok:true,status:200,headers:{get:()=>''},json:async()=>{throw fault();}})],
  ['HTTP failure',async()=>({ok:false,status:500,headers:{get:()=>''},json:async()=>({code:1})})],
  ['API error',async()=>response(fixtureGrant({code:2}))],
  ['missing access',async()=>response(fixtureGrant({access_token:''}))],
  ['missing refresh',async()=>response(fixtureGrant({refresh_token:''}))],
  ['access object',async()=>response(fixtureGrant({access_token:{synthetic:true}}))],
  ['refresh array',async()=>response(fixtureGrant({refresh_token:['synthetic']}))],
  ['access internal CRLF',async()=>response(fixtureGrant({access_token:'SYNTHETIC\r\nACCESS'}))],
  ['refresh internal NUL',async()=>response(fixtureGrant({refresh_token:'SYNTHETIC\u0000REFRESH'}))],
  ['access internal whitespace',async()=>response(fixtureGrant({access_token:'SYNTHETIC ACCESS'}))],
  ['scopes missing',async()=>response(fixtureGrant({scope:'calendar:calendar:read'}))],
  ['scope array',async()=>response(fixtureGrant({scope:[scopes]}))],
  ['scope object',async()=>response(fixtureGrant({scope:{toString:()=>scopes}}))],
  ['scope leading whitespace',async()=>response(fixtureGrant({scope:` ${scopes}`}))],
  ['expiry zero',async()=>response(fixtureGrant({expires_in:0}))],
  ['expiry overflow',async()=>response(fixtureGrant({expires_in:1e306}))],
  ['refresh expiry overflow',async()=>response(fixtureGrant({refresh_token_expires_in:1e306}))],
  ['expiry string',async()=>response(fixtureGrant({expires_in:'7200'}))],
  ['null JSON',async()=>response(null)],
];
for(const [label,result]of badResponses)test(`refresh ${label}: exactly one POST, no resource read, no restart retry`,async()=>{
  const item=fixture({request:result});await assert.rejects(item.reader.get(eventPath),{code:'calendar_refresh_recovery_required'});
  assert.equal(item.counts.refresh,1);assert.equal(item.counts.native,0);
  await assertHeld(item.fs.restart());await assertHeld(item.fs.restart({crash:true}));
  await assert.rejects(item.reader.get(eventPath));assert.equal(item.counts.refresh,1);
});
for(const op of ['open','writeFile','fileSync','close','rename','directorySync','readFile'])for(const phase of ['before','after']) {
  test(`credential ${op}/${phase} failure after POST prevents native read and fresh-instance bypass`,async()=>{
    const item=fixture();
    const reached=failOnce(item.fs,event=>item.counts.refresh===1&&event.op===op&&event.phase===phase
      && (op==='directorySync'||event.path===storePath||event.path.startsWith(`${storePath}.`)&&!event.path.startsWith(holdPath)&&event.path!==lockPath));
    await assert.rejects(item.reader.get(eventPath));reached();assert.equal(item.counts.refresh,1);assert.equal(item.counts.native,0);
    await assertHeld(item.fs.restart());await assertHeld(item.fs.restart({crash:true}));
  });
}
for(const op of ['unlink','directorySync'])for(const phase of ['before','after'])test(`hold cleanup ${op}/${phase} failure retains lock as final anchor`,async()=>{
  const item=fixture();
  const reached=failOnce(item.fs,event=>item.counts.refresh===1&&event.op===op&&event.phase===phase
    && (op==='unlink'&&event.path===holdPath||op==='directorySync'&&!item.fs.files.has(holdPath)));
  await assert.rejects(item.reader.get(eventPath));reached();assert.equal(item.counts.refresh,1);assert.equal(item.counts.native,0);
  assert.equal(item.fs.dirs.has(lockPath),true);await assertHeld(item.fs.restart());await assertHeld(item.fs.restart({crash:true}));
});
for(const phase of ['before','after'])test(`lock release ${phase} failure restores no-secret hold after successful rotation`,async()=>{
  const item=fixture();const reached=failOnce(item.fs,event=>event.op==='rmdir'&&event.path===lockPath&&event.phase===phase);
  await assert.rejects(item.reader.get(eventPath));reached();assert.equal(item.counts.refresh,1);
  assert.equal(item.fs.files.has(holdPath),true);await assertHeld(item.fs.restart());await assertHeld(item.fs.restart({crash:true}));
});
for(const bad of ['malformed','wrong context','extra key','directory instead of file'])test(`preexisting ${bad} hold blocks status/get/verify without interpreting absence as success`,async()=>{
  const fs=new FixtureFS(fixtureRecord({accessExpiresAt:clock+7200000}));
  if(bad==='directory instead of file')fs.dirs.add(holdPath);
  else fs.files.set(holdPath,bad==='malformed'?'{':JSON.stringify({schemaVersion:1,kind:'calendar_refresh_intent',contextSha256:'0'.repeat(64),attemptId:'1'.repeat(32),createdAt:new Date(clock).toISOString(),...(bad==='extra key'?{extra:true}:{})}));
  await assertHeld(fs);
});
test('preexisting lock alone blocks cached token access and status without stale lock theft',async()=>{
  const fs=new FixtureFS(fixtureRecord({accessExpiresAt:clock+7200000}));fs.dirs.add(lockPath);await assertHeld(fs);
  assert.equal(fs.dirs.has(lockPath),true);
});
test('ordinary cached GET network error is not a permanent refresh quarantine',async()=>{
  const item=fixture({fs:new FixtureFS(fixtureRecord({accessExpiresAt:clock+7200000})),request:async()=>{throw fault('SYNTHETIC_GET_NETWORK');}});
  await assert.rejects(item.reader.get(eventPath));assert.equal(item.counts.refresh,0);assert.equal(item.fs.files.has(holdPath),false);assert.equal(item.fs.dirs.has(lockPath),false);
  const next=fixture({fs:item.fs.restart()});await next.reader.get(eventPath);assert.equal(next.counts.native,1);
});
test('ordinary verifyCalendar error releases lock without creating refresh hold',async()=>{
  const item=fixture({fs:new FixtureFS(fixtureRecord({accessExpiresAt:clock+7200000})),request:async()=>response({code:0,data:{role:'free_busy_reader'}})});
  await assert.rejects(item.reader.verifyCalendar(calendarId),{code:'calendar_detail_permission_missing'});
  assert.equal(item.counts.refresh,0);assert.equal(item.fs.files.has(holdPath),false);assert.equal(item.fs.dirs.has(lockPath),false);
});
for(const sameInstance of [true,false])test(`${sameInstance?'same-instance':'shared-store distinct-instance'} concurrency makes one refresh POST; contender cannot use cached grant`,async()=>{
  let release,started;
  const wait=new Promise(resolve=>release=resolve),start=new Promise(resolve=>started=resolve);
  const item=fixture({request:async(url)=>{if(url.includes('/oauth/v3/')){started();await wait;return response(fixtureGrant());}return response({code:0,data:{items:[]}});}});
  const run=item.reader.get(eventPath);await start;
  const second=sameInstance?item:fixture({fs:item.fs});
  await assert.rejects(second.reader.get(eventPath),error=>['calendar_refresh_recovery_required','calendar_authorization_busy'].includes(error.code));
  assert.equal((await second.reader.status()).authorized,false);release();await run;
  assert.equal(item.counts.refresh,1);if(!sameInstance)assert.equal(second.calls.length,0);
});
test('new explicit begin/complete cannot pretend to recover an unknown refresh hold',async()=>{
  const item=fixture({request:async()=>{throw fault();}});await assert.rejects(item.reader.get(eventPath));
  const next=fixture({fs:item.fs.restart()}),begin=next.reader.begin();
  await assert.rejects(next.reader.complete({code:'synthetic-code',state:begin.state,cookieState:begin.state}));
  assert.equal(next.counts.code,0);assert.equal(next.counts.refresh,0);assert.equal(next.counts.native,0);await assertHeld(next.fs);
});
test('fresh authorized code exchange retains PKCE flow plus actual encrypted-store readback',async()=>{
  const item=fixture(),begin=item.reader.begin();
  const result=await item.reader.complete({code:'synthetic-code',state:begin.state,cookieState:begin.state});
  assert.equal(result.authorized,true);assert.equal(item.counts.code,1);assert.equal(item.counts.user,1);
  assert.ok(item.fs.events.some(event=>event.op==='readFile'&&event.path===storePath));assert.equal(item.fs.dirs.has(lockPath),false);
});
test('fresh code store readback failure is not memory-only authorization success',async()=>{
  const item=fixture();const reached=failOnce(item.fs,event=>item.counts.code===1&&event.op==='readFile'&&event.path===storePath&&event.phase==='before');
  const begin=item.reader.begin();await assert.rejects(item.reader.complete({code:'synthetic-code',state:begin.state,cookieState:begin.state}));reached();
  assert.equal(item.fs.dirs.has(lockPath),true);await assertHeld(item.fs.restart());
});
for(const [label,overrides]of [
  ['access object',{access_token:{synthetic:true}}],
  ['refresh array',{refresh_token:['synthetic']}],
  ['scope array',{scope:[scopes]}],
  ['access expiry overflow',{expires_in:1e306}],
  ['refresh expiry overflow',{refresh_token_expires_in:1e306}],
  ['access internal CRLF',{access_token:'SYNTHETIC\r\nACCESS'}],
  ['refresh internal NUL',{refresh_token:'SYNTHETIC\u0000REFRESH'}],
])test(`fresh code ${label} rejects the grant before first GET without repeating code exchange`,async()=>{
  const item=fixture({codeGrant:fixtureGrant(overrides)}),begin=item.reader.begin();
  const payload={code:'synthetic-code',state:begin.state,cookieState:begin.state};
  await assert.rejects(item.reader.complete(payload));
  assert.deepEqual(item.counts,{refresh:0,native:0,code:1,user:0});
  await assert.rejects(item.reader.complete(payload),{code:'calendar_oauth_state_invalid'});
  assert.equal(item.counts.code,1);
});
for(const [field,value]of [['openId','ou_other'],['accessToken',{}],['refreshToken',[]],['accessExpiresAt',null],['refreshExpiresAt',1e306],['scopes',[scopes]]]) {
  test(`credential readback ${field} strong-type/value mismatch remains held`,async()=>{
    const item=fixture();let replaced=false;
    item.fs.hook=async(event,fs)=>{
      if(!replaced&&item.counts.refresh===1&&event.op==='readFile'&&event.path===storePath&&event.phase==='before'){
        replaced=true;fs.files.set(storePath,encrypted(fixtureRecord({accessToken:'SYNTHETIC_ACCESS_NEW',refreshToken:'SYNTHETIC_REFRESH_NEW',
          accessExpiresAt:clock+7200000,refreshExpiresAt:clock+86400000,[field]:value})));
      }
    };
    await assert.rejects(item.reader.get(eventPath));assert.ok(replaced);assert.equal(item.counts.native,0);await assertHeld(item.fs.restart());
  });
}
for(const value of [NaN,Infinity,clock+1e20])test(`invalid clock ${String(value)} never refreshes`,async()=>{
  const item=fixture({now:()=>value});await assert.rejects(item.reader.get(eventPath));assert.equal(item.counts.refresh,0);assert.equal(item.counts.native,0);assert.equal((await item.reader.status()).authorized,false);
});
