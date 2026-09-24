import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtemp, readFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCalendarUserReader} from './calendar-user-reader.mjs';

const scope = 'calendar:calendar:read calendar:calendar.event:read offline_access';
function setup(dir, fetchImpl, now = () => 1_000_000) {
  return createCalendarUserReader({appId:'cli_test',appSecret:'test_secret',calendarId:'test_calendar',expectedOpenId:'ou_expected',
    redirectUri:'https://example.com/fd-027340/live-center-workbench/api/lifecycle/calendar-auth/callback',
    storePath:join(dir,'calendar-user.enc'),encryptionKey:randomBytes(32).toString('base64'),fetchImpl,now});
}
function response(data, status = 200) { return {ok:status >= 200 && status < 300,status,json:async () => data}; }
test('OAuth binds state to callback, verifies reader and stores only encrypted credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(),'calendar-reader-test-'));
  try {
    const calls = [];
    const reader = setup(dir, async (url, options) => {
      calls.push([url,options]);
      if (url.endsWith('/oauth/v3/token')) return response({code:0,access_token:'sensitive_access',refresh_token:'sensitive_refresh',expires_in:7200,refresh_token_expires_in:604800,scope});
      if (url.endsWith('/user_info')) return response({code:0,data:{open_id:'ou_expected'}});
      if (url.endsWith('/test_calendar')) return response({code:0,data:{calendar:{role:'reader'}}});
      return response({code:0,data:{items:[{summary:'正式面试'}]}});
    });
    assert.equal((await reader.status()).authorized,false);
    const attempt = reader.begin();
    const url = new URL(attempt.url);
    assert.equal(url.searchParams.get('scope'),scope);
    assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    await assert.rejects(reader.complete({code:'test_code',state:attempt.state,cookieState:'wrong'}),{code:'calendar_oauth_state_invalid'});
    const valid = reader.begin();
    assert.equal((await reader.complete({code:'test_code',state:valid.state,cookieState:valid.state})).authorized,true);
    assert.equal(calls.length,3);
    const tokenBody = new URLSearchParams(calls[0][1].body);
    assert.equal(calls[0][1].headers['Content-Type'],'application/x-www-form-urlencoded');
    assert.match(tokenBody.get('code_verifier'),/^[A-Za-z0-9._~-]{43,128}$/u);
    assert.equal(createHash('sha256').update(tokenBody.get('code_verifier')).digest('base64url'),new URL(valid.url).searchParams.get('code_challenge'));
    assert.equal(tokenBody.get('scope'),scope);
    const stored = await readFile(join(dir,'calendar-user.enc'),'utf8');
    assert.doesNotMatch(stored,/sensitive_access|sensitive_refresh|ou_expected/u);
    assert.equal((await reader.get('/calendar/v4/calendars/test_calendar/events')).items[0].summary,'正式面试');
    assert.equal(calls.length,4);
    await reader.get('/calendar/v4/calendars/test_calendar/events?page_token=next-page');
    assert.match(calls.at(-1)[0],/page_token=next-page/);
    const before=calls.length;
    await assert.rejects(reader.get('/calendar/v4/calendars/test_calendar/events?unexpected=value'));
    assert.equal(calls.length,before);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('wrong user and missing scope fail closed without saving credentials', async () => {
  for (const [identity, tokenScope, code] of [['ou_other',scope,'calendar_oauth_wrong_user'],['ou_expected','calendar:calendar:read','calendar_scope_missing']]) {
    const dir = await mkdtemp(join(tmpdir(),'calendar-reader-test-'));
    try {
      const reader = setup(dir, async url => url.endsWith('/oauth/v3/token')
        ? response({code:0,access_token:'access',refresh_token:'refresh',expires_in:7200,refresh_token_expires_in:604800,scope:tokenScope})
        : response({code:0,data:{open_id:identity}}));
      const attempt = reader.begin();
      await assert.rejects(reader.complete({code:'test_code',state:attempt.state,cookieState:attempt.state}),{code});
      assert.equal((await reader.status()).authorized,false);
    } finally { await rm(dir,{recursive:true,force:true}); }
  }
});
test('expired access token rotates refresh token once across parallel reads', async () => {
  const dir = await mkdtemp(join(tmpdir(),'calendar-reader-test-'));
  let clock = 1_000_000;
  let refreshes = 0;
  try {
    const reader = setup(dir, async (url, options) => {
      if (url.endsWith('/oauth/v3/token')) {
        const body = Object.fromEntries(new URLSearchParams(options.body));
        if (body.grant_type === 'refresh_token') {
          refreshes += 1;
          assert.equal(body.refresh_token,'refresh_1');
          return response({code:0,access_token:'access_2',refresh_token:'refresh_2',expires_in:7200,refresh_token_expires_in:604800,scope});
        }
        return response({code:0,access_token:'access_1',refresh_token:'refresh_1',expires_in:7200,refresh_token_expires_in:604800,scope});
      }
      if (url.endsWith('/user_info')) return response({code:0,data:{open_id:'ou_expected'}});
      if (url.endsWith('/test_calendar')) return response({code:0,data:{calendar:{role:'reader'}}});
      return response({code:0,data:{items:[]}});
    },() => clock);
    const attempt = reader.begin();
    await reader.complete({code:'test_code',state:attempt.state,cookieState:attempt.state});
    clock += 7_000_000;
    await Promise.all([reader.get('/calendar/v4/calendars/test_calendar/events'),reader.get('/calendar/v4/calendars/test_calendar/events')]);
    assert.equal(refreshes,1);
    assert.equal((await reader.status()).authorized,true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('拒绝其它日历和非白名单参数，不允许用户令牌访问其它 API',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'calendar-reader-test-'));try{const reader=setup(dir,async()=>{throw Error('不应发起网络请求');});for(const path of ['/im/v1/messages','/calendar/v4/calendars/other/events','https://evil.test/events'])await assert.rejects(reader.get(path),{code:'calendar_path_denied'});await assert.rejects(reader.get('/calendar/v4/calendars/test_calendar/events?unexpected=unapproved'),{code:'calendar_path_denied'});}finally{await rm(dir,{recursive:true,force:true});}
});

test('只有忙闲权限或详情权限被拒绝时，不保存生产授权',async()=>{
 for(const role of ['free_busy_reader',undefined]){
  const dir=await mkdtemp(join(tmpdir(),'calendar-reader-test-'));
  try{
   const reader=setup(dir,async url=>url.endsWith('/oauth/v3/token')
    ?response({code:0,access_token:'access',refresh_token:'refresh',expires_in:7200,refresh_token_expires_in:604800,scope})
    :url.endsWith('/user_info')?response({code:0,data:{open_id:'ou_expected'}}):response({code:0,data:{calendar:{role}}}));
   const attempt=reader.begin();
   await assert.rejects(reader.complete({code:'test',state:attempt.state,cookieState:attempt.state}),{code:'calendar_detail_permission_missing'});
   assert.equal((await reader.status()).authorized,false);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('并行进程锁不会被当成过期文件删除或绕过',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'calendar-reader-test-'));try{const reader=setup(dir,async()=>{throw Error('不应换取令牌');}),attempt=reader.begin();await mkdir(join(dir,'calendar-user.enc.lock'));await assert.rejects(reader.complete({code:'test_code',state:attempt.state,cookieState:attempt.state}),{code:'calendar_authorization_busy'});}finally{await rm(dir,{recursive:true,force:true});}
});

test('only coach readers explicitly allow bounded instance_view on their own calendar',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'calendar-reader-test-'));
 try{
  const calls=[];
  const reader=createCalendarUserReader({appId:'cli_test',appSecret:'test_secret',calendarId:'test_calendar',expectedOpenId:'ou_expected',
   redirectUri:'https://example.com/callback',storePath:join(dir,'calendar-user.enc'),encryptionKey:randomBytes(32).toString('base64'),allowInstanceView:true,
   fetchImpl:async(url)=>{calls.push(url);if(url.endsWith('/oauth/v3/token'))return response({code:0,access_token:'access',refresh_token:'refresh',expires_in:7200,refresh_token_expires_in:604800,scope});
    if(url.endsWith('/user_info'))return response({code:0,data:{open_id:'ou_expected'}});
    if(url.endsWith('/test_calendar'))return response({code:0,data:{calendar:{role:'reader'}}});
    return response({code:0,data:{items:[]}});
   }});
  const attempt=reader.begin();await reader.complete({code:'test',state:attempt.state,cookieState:attempt.state});
  const path='/calendar/v4/calendars/test_calendar/events/instance_view?start_time=1000000&end_time=1003600';
  assert.deepEqual((await reader.get(path)).items,[]);
  assert.match(calls.at(-1),/instance_view\?start_time=1000000&end_time=1003600/u);
  const before=calls.length;
  await assert.rejects(reader.get(`${path}&page_token=other`),{code:'calendar_path_denied'});
  await assert.rejects(reader.get('/calendar/v4/calendars/other/events/instance_view?start_time=1000000&end_time=1003600'),{code:'calendar_path_denied'});
  await assert.rejects(reader.get('/calendar/v4/calendars/test_calendar/events/instance_view?start_time=1000000&end_time=1691200'),{code:'calendar_path_denied'});
  assert.equal(calls.length,before);
  const plain=setup(dir,async()=>{throw Error('不应发起网络请求');});
  await assert.rejects(plain.get(path),{code:'calendar_path_denied'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('教练仅能授权与本人 open_id 精确匹配的预置主日历',async()=>{
 for(const [calendars,allowed] of [
  [[{user_id:'ou_expected',calendar:{calendar_id:'test_calendar',type:'primary'}}],true],
  [[{user_id:'ou_other',calendar:{calendar_id:'test_calendar',type:'primary'}}],false],
  [[{user_id:'ou_expected',calendar:{calendar_id:'test_calendar',type:'shared'}}],false],
  [[{user_id:'ou_expected',calendar:{calendar_id:'other_calendar',type:'primary'}}],false],
  [[{user_id:'ou_expected',calendar:{calendar_id:'test_calendar',type:'primary',is_deleted:true}}],false],
  [[{user_id:'ou_expected',calendar:{calendar_id:'test_calendar',type:'primary'}},{user_id:'ou_expected',calendar:{calendar_id:'test_calendar',type:'primary'}}],false],
  [[],false],
 ]){
  const dir=await mkdtemp(join(tmpdir(),'calendar-primary-test-'));
  try{
   const reader=createCalendarUserReader({appId:'cli_test',appSecret:'test_secret',calendarId:'test_calendar',expectedOpenId:'ou_expected',ownerLabel:'教练',requireOwnPrimaryCalendar:true,
    redirectUri:'https://example.com/callback',storePath:join(dir,'coach.enc'),encryptionKey:randomBytes(32).toString('base64'),
    fetchImpl:async(url,options)=>url.endsWith('/oauth/v3/token')?response({code:0,access_token:'access',refresh_token:'refresh',expires_in:7200,refresh_token_expires_in:604800,scope})
     :url.endsWith('/user_info')?response({code:0,data:{open_id:'ou_expected'}})
     :url.includes('/calendars/primary?')?(assert.equal(options.method,'POST'),response({code:0,data:{calendars}}))
     :response({code:0,data:{calendar:{role:'reader'}}})});
   const attempt=reader.begin(),completion=reader.complete({code:'test',state:attempt.state,cookieState:attempt.state});
   if(allowed){assert.equal((await completion).authorized,true);assert.equal((await reader.status()).authorized,true);}
   else {await assert.rejects(completion,{code:'calendar_primary_unverified'});assert.equal((await reader.status()).authorized,false);}
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('主日历接口异常或详情权限不足时不保存教练授权',async()=>{
 for(const mode of ['provider-error','free-busy']){
  const dir=await mkdtemp(join(tmpdir(),'calendar-primary-test-'));
  try{
   const reader=createCalendarUserReader({appId:'cli_test',appSecret:'test_secret',calendarId:'test_calendar',expectedOpenId:'ou_expected',requireOwnPrimaryCalendar:true,
    redirectUri:'https://example.com/callback',storePath:join(dir,'coach.enc'),encryptionKey:randomBytes(32).toString('base64'),
    fetchImpl:async url=>url.endsWith('/oauth/v3/token')?response({code:0,access_token:'access',refresh_token:'refresh',expires_in:7200,refresh_token_expires_in:604800,scope})
     :url.endsWith('/user_info')?response({code:0,data:{open_id:'ou_expected'}})
     :url.includes('/calendars/primary?')?response(mode==='provider-error'?{code:1234}:{code:0,data:{calendars:[{user_id:'ou_expected',calendar:{calendar_id:'test_calendar',type:'primary'}}]}})
     :response({code:0,data:{calendar:{role:'free_busy_reader'}}})});
   const attempt=reader.begin();
   await assert.rejects(reader.complete({code:'test',state:attempt.state,cookieState:attempt.state}),{code:mode==='provider-error'?'calendar_primary_unverified':'calendar_detail_permission_missing'});
   assert.equal((await reader.status()).authorized,false);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});

test('additional coach calendar requires explicit allowlist and detail-reader role',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'calendar-reader-test-'));
 try{
  const calls=[];
  let coachRole='reader';
  const reader=createCalendarUserReader({appId:'cli_test',appSecret:'test_secret',calendarId:'test_calendar',additionalCalendarIds:['coach_calendar'],expectedOpenId:'ou_expected',redirectUri:'https://example.com/callback',storePath:join(dir,'calendar-user.enc'),encryptionKey:randomBytes(32).toString('base64'),fetchImpl:async(url)=>{
   calls.push(url);
   if(url.endsWith('/oauth/v3/token'))return response({code:0,access_token:'access',refresh_token:'refresh',expires_in:7200,refresh_token_expires_in:604800,scope});
   if(url.endsWith('/user_info'))return response({code:0,data:{open_id:'ou_expected'}});
   if(url.endsWith('/test_calendar'))return response({code:0,data:{calendar:{role:'reader'}}});
   if(url.endsWith('/coach_calendar'))return response({code:0,data:{calendar:{role:coachRole}}});
   return response({code:0,data:{items:[]}});
  }});
  const attempt=reader.begin();await reader.complete({code:'test',state:attempt.state,cookieState:attempt.state});
  await reader.verifyCalendar('coach_calendar');
  await reader.get('/calendar/v4/calendars/coach_calendar/events?start_time=1&end_time=2');
  coachRole='free_busy_reader';
  await assert.rejects(reader.verifyCalendar('coach_calendar'),{code:'calendar_detail_permission_missing'});
  const count=calls.length;
  await assert.rejects(reader.verifyCalendar('other_calendar'),{code:'calendar_path_denied'});
  await assert.rejects(reader.get('/calendar/v4/calendars/other_calendar/events'),{code:'calendar_path_denied'});
  assert.equal(calls.length,count);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('exchange diagnostics identify the upstream failure without leaking any credentials',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'calendar-reader-test-'));
 try{
  const reports=[];
  const reader=createCalendarUserReader({appId:'cli_test',appSecret:'hidden_secret',calendarId:'test_calendar',expectedOpenId:'ou_expected',redirectUri:'https://example.com/callback',storePath:join(dir,'calendar-user.enc'),encryptionKey:randomBytes(32).toString('base64'),diagnostic:x=>reports.push(x),fetchImpl:async()=>({...response({code:20004,error_description:'hidden_code hidden_secret hidden_refresh',refresh_token:'hidden_refresh'},400),headers:{get:()=> '20260923SAFE_TRACE'}})});
  const attempt=reader.begin();
  await assert.rejects(reader.complete({code:'hidden_code',state:attempt.state,cookieState:attempt.state}),e=>{assert.equal(e.code,'calendar_oauth_exchange_failed');assert.equal(e.diagnostic.upstreamCode,20004);assert.match(e.message,/授权码已过期/);assert.doesNotMatch(JSON.stringify(e),/hidden_code|hidden_secret|hidden_refresh/);return true;});
  assert.equal(reports.length,1);assert.equal(reports[0].requestId,'20260923SAFE_TRACE');
  assert.doesNotMatch(JSON.stringify(reports),/hidden_code|hidden_secret|hidden_refresh/);
  assert.equal((await reader.status()).authorized,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('malformed provider fields and trace identifiers are not returned or logged',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'calendar-reader-test-'));
 try{
  const reports=[];
  const reader=createCalendarUserReader({appId:'cli_test',appSecret:'test_secret',calendarId:'test_calendar',expectedOpenId:'ou_expected',redirectUri:'https://example.com/callback',storePath:join(dir,'calendar-user.enc'),encryptionKey:randomBytes(32).toString('base64'),diagnostic:x=>reports.push(x),fetchImpl:async()=>({...response({code:'secret-in-code',error_description:'secret-in-error',access_token:'secret-in-token'}),headers:{get:()=> 'secret-in-header\ninvalid'}})});
  const attempt=reader.begin();
  await assert.rejects(reader.complete({code:'unused',state:attempt.state,cookieState:attempt.state}),e=>{assert.equal(e.diagnostic.upstreamCode,null);assert.equal(e.diagnostic.requestId,null);assert.match(e.message,/未返回可续期/);return true;});
  assert.doesNotMatch(JSON.stringify(reports),/secret-in/);
  assert.equal((await reader.status()).authorized,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('parallel OAuth attempts keep the exact independent S256 verifier through form encoding',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'calendar-reader-test-'));
 try{
  const attempts=new Map(),seen=[];
  const reader=setup(dir,async(url,options)=>{
   if(url.endsWith('/oauth/v3/token')){
    const b=Object.fromEntries(new URLSearchParams(options.body));
    assert.equal(b.client_secret,'test_secret');assert.equal(b.redirect_uri,'https://example.com/fd-027340/live-center-workbench/api/lifecycle/calendar-auth/callback');
    assert.equal(createHash('sha256').update(b.code_verifier).digest('base64url'),attempts.get(b.code));seen.push(b.code);
    return response({code:0,access_token:'access',refresh_token:'refresh',expires_in:7200,refresh_token_expires_in:604800,scope});
   }
   if(url.endsWith('/user_info'))return response({code:0,data:{open_id:'ou_expected'}});
   return response({code:0,data:{calendar:{role:'reader'}}});
  });
  const a=reader.begin(),b=reader.begin();attempts.set('first',new URL(a.url).searchParams.get('code_challenge'));attempts.set('second',new URL(b.url).searchParams.get('code_challenge'));
  assert.notEqual(attempts.get('first'),attempts.get('second'));
  await reader.complete({code:'second',state:b.state,cookieState:b.state});await reader.complete({code:'first',state:a.state,cookieState:a.state});
  assert.deepEqual(seen,['second','first']);
  await assert.rejects(reader.complete({code:'first',state:a.state,cookieState:a.state}),{code:'calendar_oauth_state_invalid'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
