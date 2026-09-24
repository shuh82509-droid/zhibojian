import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Script} from 'node:vm';
import {createCoachCalendarAuth} from './coach-calendar-auth.mjs';
import {createCalendarUserReader} from './calendar-user-reader.mjs';

const names={'官旗':'曾泳淇','优选':'李爽'};
const numbers={'官旗':'FD-024035','优选':'FD-028493'};
const openIds={'官旗':'ou_guanqi','优选':'ou_youxuan'};
function response(){
  return {headers:{},status:0,body:null,setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(body){this.body=body;}};
}
function fixture({enabled=true,readOnly=false}={}){
  const calls=[],readers={};let sequence=0;
  for(const room of Object.keys(names))readers[room]={
    status:async()=>({configured:true,authorized:false,reason:`等待${names[room]}授权`}),
    begin:()=>({state:`state-${++sequence}`,url:`https://accounts.feishu.cn/authorize?room=${encodeURIComponent(room)}`}),
    complete:async args=>{calls.push({room,...args});if(args.cookieState!==args.state)throw new Error('state mismatch');return {authorized:true};},
  };
  const json=(res,status,value)=>{res.status=status;res.body=value;};
  const auth=createCoachCalendarAuth({readers,coachNames:names,employeeNos:numbers,openIds,basePath:'/modules/live-room-management',enabled,readOnly,json,
    verifyActor:async(room,openId,name,number)=>{assert.equal(openId,openIds[room]);assert.equal(name,names[room]);assert.equal(number,numbers[room]);},clock:()=>1000});
  const person=room=>({ok:true,mode:'central',user:{number:numbers[room],name:names[room]},permissions:{allowed_modules:['live-room-management']}});
  const req=(room,method='POST')=>({method,headers:{'x-requested-with':'XMLHttpRequest',origin:'https://hub.fandow.com',host:'hub.fandow.com'},auth:person(room)});
  return {auth,calls,person,req};
}
test('本人 OA 工号与实时 contact 双重校验后才能独立发起只读授权',async()=>{
  const f=fixture(),res=response();
  assert.equal(await f.auth.handleApi(f.req('官旗'),res,'/api/lifecycle/coach-calendar-auth/start',f.person('官旗')),true);
  assert.equal(res.status,200);assert.match(res.body.authorizeUrl,/room=/);
  assert.match(res.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
  const other=response();
  const wrong={...f.person('官旗'),user:{number:numbers['官旗'],name:'同名不符'}};
  await f.auth.handleApi(f.req('官旗'),other,'/api/lifecycle/coach-calendar-auth/start',wrong);
  assert.equal(other.status,403);
  for(const unsafe of [{...f.person('官旗'),mode:'internal'},{...f.person('官旗'),degraded:true}]){
    const blocked=response();await f.auth.handleApi(f.req('官旗'),blocked,'/api/lifecycle/coach-calendar-auth/start',unsafe);
    assert.equal(blocked.status,403);
  }
  const status=response();await f.auth.handleApi(f.req('优选','GET'),status,'/api/lifecycle/coach-calendar-auth/status',f.person('优选'));
  assert.equal(status.body.room,'优选');assert.equal(status.body.calendar.authorized,false);
});
test('共享回调仅消费自身 state 和 HttpOnly cookie，未匹配状态留给原面试授权',async()=>{
  const f=fixture(),started=response();
  await f.auth.handleApi(f.req('官旗'),started,'/api/lifecycle/coach-calendar-auth/start',f.person('官旗'));
  const state=started.headers['Set-Cookie'].match(/=([^;]+)/)[1];
  const unknown=response();
  assert.equal(await f.auth.handleCallback({method:'GET',headers:{cookie:`live_coach_calendar_oauth_state=${state}`}},unknown,new URL('https://hub.fandow.com/callback?state=interview-state&code=ok')),false);
  const result=response();
  assert.equal(await f.auth.handleCallback({method:'GET',headers:{cookie:`live_coach_calendar_oauth_state=${state}`}},result,new URL(`https://hub.fandow.com/callback?state=${state}&code=ok`)),true);
  assert.equal(result.status,200);assert.match(result.body,/本人日历授权完成/);
  assert.deepEqual(f.calls,[{room:'官旗',code:'ok',state,cookieState:state}]);
  assert.equal(await f.auth.handleCallback({method:'GET',headers:{}},response(),new URL(`https://hub.fandow.com/callback?state=${state}&code=ok`)),false);
});
test('跨站发起、错误 cookie、候选只读和功能关闭均不保存授权',async()=>{
  const f=fixture(),bad=f.req('官旗');bad.headers.origin='https://evil.example';
  const denied=response();await f.auth.handleApi(bad,denied,'/api/lifecycle/coach-calendar-auth/start',f.person('官旗'));
  assert.equal(denied.status,403);
  const started=response();await f.auth.handleApi(f.req('优选'),started,'/api/lifecycle/coach-calendar-auth/start',f.person('优选'));
  const state=started.headers['Set-Cookie'].match(/=([^;]+)/)[1];
  const mismatched=response();await f.auth.handleCallback({method:'GET',headers:{cookie:'live_coach_calendar_oauth_state=wrong'}},mismatched,new URL(`https://hub.fandow.com/callback?state=${state}&code=ok`));
  assert.equal(mismatched.status,400);assert.equal(f.calls.length,1);
  for(const option of [{enabled:false},{readOnly:true}]){
    const locked=fixture(option),res=response();await locked.auth.handleApi(locked.req('官旗'),res,'/api/lifecycle/coach-calendar-auth/start',locked.person('官旗'));
    assert.equal(res.status,423);assert.equal(res.body.authorizeUrl,undefined);
  }
});
test('直播中心提供本人授权入口，页面脚本可解析且不开放跨域目标',()=>{
  const shell=readFileSync(new URL('./site/index.html',import.meta.url),'utf8');
  const page=readFileSync(new URL('./site/coach-calendar.html',import.meta.url),'utf8');
  assert.match(shell,/data-page="coach-calendar"/);
  assert.match(shell,/coach-calendar\.html/);
  assert.match(page,/本人飞书只读授权/);
  assert.match(page,/destination\.hostname!==['"]accounts\.feishu\.cn['"]/);
  const scripts=[...page.matchAll(/<script>([\s\S]*?)<\/script>/gu)];
  assert.equal(scripts.length,1);
  assert.doesNotThrow(()=>new Script(scripts[0][1]));
});

async function exerciseCoachOAuth(upstreamCode=0) {
  const dir=await mkdtemp(join(tmpdir(),'coach-oauth-route-'));
  const basePath='/modules/live-room-management';
  const redirectUri=`https://hub.fandow.com${basePath}/api/lifecycle/calendar-auth/callback`;
  const tokenFile=join(dir,'coach.enc');
  const diagnostics=[];
  let authorizationUrl;
  const providerResponse=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
  const reader=createCalendarUserReader({appId:'cli_test',appSecret:'mock_secret',calendarId:'coach_primary',expectedOpenId:'ou_guanqi',
    ownerLabel:'曾泳淇',requireOwnPrimaryCalendar:true,allowInstanceView:true,redirectUri,storePath:tokenFile,
    encryptionKey:randomBytes(32).toString('base64'),now:()=>1_000_000,diagnostic:value=>diagnostics.push(value),
    fetchImpl:async(url,options)=>{
      if(url==='https://accounts.feishu.cn/oauth/v3/token'){
        const request=new URLSearchParams(options.body);
        const authorization=new URL(authorizationUrl);
        assert.equal(options.method,'POST');
        assert.equal(options.headers['Content-Type'],'application/x-www-form-urlencoded');
        assert.equal(request.get('code'),'mock_one_use_code');
        assert.equal(request.get('redirect_uri'),authorization.searchParams.get('redirect_uri'));
        assert.equal(request.get('scope'),authorization.searchParams.get('scope'));
        assert.equal(createHash('sha256').update(request.get('code_verifier')).digest('base64url'),authorization.searchParams.get('code_challenge'));
        if(upstreamCode) return providerResponse({code:upstreamCode,error_description:'private mock provider detail'},400);
        return providerResponse({code:0,access_token:'mock_access_secret',refresh_token:'mock_refresh_secret',expires_in:7200,
          refresh_token_expires_in:604800,scope:'calendar:calendar:read calendar:calendar.event:read offline_access'});
      }
      if(url.endsWith('/authen/v1/user_info'))return providerResponse({code:0,data:{open_id:'ou_guanqi'}});
      if(url.includes('/calendars/primary?'))return providerResponse({code:0,data:{calendars:[{user_id:'ou_guanqi',calendar:{calendar_id:'coach_primary',type:'primary',is_deleted:false}}]}});
      if(url.endsWith('/calendars/coach_primary'))return providerResponse({code:0,data:{calendar:{role:'owner'}}});
      throw Error(`unexpected mock provider call: ${url}`);
    }});
  const auth=createCoachCalendarAuth({readers:{'官旗':reader},coachNames:{'官旗':'曾泳淇'},employeeNos:{'官旗':'FD-024035'},openIds:{'官旗':'ou_guanqi'},
    basePath,enabled:true,readOnly:false,json:(res,status,body)=>{res.status=status;res.body=body;},clock:()=>1_000_000,
    verifyActor:async(room,openId,name,number)=>assert.deepEqual([room,openId,name,number],['官旗','ou_guanqi','曾泳淇','FD-024035'])});
  const actor={ok:true,mode:'central',user:{number:'FD-024035',name:'曾泳淇'},permissions:{allowed_modules:['live-room-management']}};
  const start=response();
  const request={method:'POST',headers:{'x-requested-with':'XMLHttpRequest',origin:'https://hub.fandow.com',host:'hub.fandow.com'}};
  await auth.handleApi(request,start,'/api/lifecycle/coach-calendar-auth/start',actor);
  assert.equal(start.status,200);
  authorizationUrl=start.body.authorizeUrl;
  const authorization=new URL(authorizationUrl);
  assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
  assert.equal(authorization.searchParams.get('redirect_uri'),redirectUri);
  const state=authorization.searchParams.get('state');
  assert.match(start.headers['Set-Cookie'],new RegExp(`^live_coach_calendar_oauth_state=${state};`));
  assert.match(start.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/u);
  assert.match(start.headers['Set-Cookie'],/Path=\/modules\/live-room-management\/api\/lifecycle\/calendar-auth\/callback/u);
  const callback=response();
  await auth.handleCallback({method:'GET',headers:{cookie:start.headers['Set-Cookie'].split(';')[0]}},callback,
    new URL(`${redirectUri}?code=mock_one_use_code&state=${encodeURIComponent(state)}`));
  return {dir,tokenFile,reader,callback,diagnostics};
}

test('coach start → browser callback → real reader token exchange preserves PKCE and encrypts credential',async()=>{
  const run=await exerciseCoachOAuth();
  try{
    assert.equal(run.callback.status,200);
    assert.match(run.callback.body,/本人日历授权完成/u);
    assert.equal((await run.reader.status()).authorized,true);
    const stored=await readFile(run.tokenFile,'utf8');
    assert.doesNotMatch(stored,/mock_access_secret|mock_refresh_secret|ou_guanqi/u);
    assert.deepEqual(run.diagnostics,[]);
  }finally{await rm(run.dir,{recursive:true,force:true});}
});

test('provider 20049 leaves coach unauthorized and surfaces only safe PKCE diagnostic',async()=>{
  const run=await exerciseCoachOAuth(20049);
  try{
    assert.equal(run.callback.status,400);
    assert.match(run.callback.body,/PKCE 安全校验未通过/u);
    assert.doesNotMatch(run.callback.body,/mock_one_use_code|private mock provider detail/u);
    assert.equal((await run.reader.status()).authorized,false);
    assert.equal(run.diagnostics.length,1);
    assert.equal(run.diagnostics[0].upstreamCode,20049);
    assert.equal(run.diagnostics[0].pkceLocallyVerified,true);
    await assert.rejects(readFile(run.tokenFile,'utf8'),{code:'ENOENT'});
  }finally{await rm(run.dir,{recursive:true,force:true});}
});
