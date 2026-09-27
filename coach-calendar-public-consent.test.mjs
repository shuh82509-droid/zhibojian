import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {createCoachCalendarInviteStore} from './coach-calendar-invites.mjs';
import {createCoachCalendarAuth} from './coach-calendar-auth.mjs';
import {createCalendarUserReader} from './calendar-user-reader.mjs';

const basePath='/modules/live-room-management';
const origin='https://hub.fandow.com';
const callbackUrl=`${origin}${basePath}/api/lifecycle/calendar-auth/callback`;
const paths={invite:'/api/lifecycle/coach-calendar-auth/invite',consent:'/api/lifecycle/coach-calendar-auth/consent',start:'/api/lifecycle/coach-calendar-auth/public-start'};
const names={'官旗':'曾泳淇','优选':'李爽'};
const numbers={'官旗':'FD-024035','优选':'FD-028493'};
const openIds={'官旗':'ou_guanqi','优选':'ou_youxuan'};
function response(){return {headers:{},status:0,body:null,setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(body){this.body=body;}};}
function request(method,path,{body='',originHeader=origin,fetchSite='same-origin',xhr=false}={}) {
  return {method,url:basePath+path,headers:{host:'hub.fandow.com',origin:originHeader,'sec-fetch-site':fetchSite,
    ...(xhr?{'x-requested-with':'XMLHttpRequest'}:{}),...(body?{'content-type':'application/x-www-form-urlencoded'}:{})},
    async *[Symbol.asyncIterator](){if(body)yield Buffer.from(body);}};
}
async function fixture({publicEnabled=true,enabled=true,contactVerified=true,registeredCallback=callbackUrl}={}) {
  const dir=await mkdtemp(join(tmpdir(),'coach-consent-'));
  let verified=contactVerified;
  const invites=createCoachCalendarInviteStore({path:join(dir,'invitations.json'),signingKey:randomBytes(32).toString('base64')});
  const calls=[];let index=0;
  const readers=Object.fromEntries(Object.keys(names).map(room=>[room,{
    status:async()=>({configured:true,authorized:false}),
    begin:()=>({state:`coach-state-${++index}`,url:`https://accounts.feishu.cn/open-apis/authen/v1/authorize?room=${encodeURIComponent(room)}`}),
    complete:async args=>{calls.push({room,...args});if(args.state!==args.cookieState)throw Error('OAuth cookie mismatch');return {authorized:true};},
  }]));
  const auth=createCoachCalendarAuth({readers,coachNames:names,employeeNos:numbers,openIds,basePath,
    enabled,publicEnabled,readOnly:false,publicCallbackUrl:registeredCallback,invitations:invites,clock:()=>Date.now(),
    authorizeIssuer:async actor=>Boolean(actor?.ok && actor.mode==='central' && actor.permissions?.super_admin),
    verifyActor:async(room,openId,name,number)=>{
      assert.deepEqual([openId,name,number],[openIds[room],names[room],numbers[room]]);
      if(!verified)throw Error('employment unverified');
    },json:(res,status,data)=>{res.status=status;res.body=data;}});
  const administrator={ok:true,mode:'central',permissions:{super_admin:true}};
  async function issue(room='官旗',actor=administrator) {
    const path=`${paths.invite}?room=${encodeURIComponent(room)}`;
    const res=response();await auth.handleApi(request('POST',path,{xhr:true}),res,paths.invite,actor,new URL(origin+basePath+path));
    return res;
  }
  return {dir,invites,auth,calls,issue,administrator,setContactVerified:value=>{verified=value;}};
}

test('预签邀请仅有已核验的管理员可签发，且不接受访客自选身份',async()=>{
  const f=await fixture();
  try {
    for(const actor of [null,{ok:true,mode:'central',permissions:{operation_admin:true}},{ok:true,mode:'internal',permissions:{super_admin:true}}]) {
      const denied=await f.issue('官旗',actor);assert.equal(denied.status,403);assert.equal(denied.body.inviteUrl,undefined);
    }
    const unknown=await f.issue('其他房间');assert.equal(unknown.status,400);
    const issued=await f.issue();assert.equal(issued.status,200);assert.equal(issued.body.room,'官旗');
    const url=new URL(issued.body.inviteUrl);
    assert.equal(url.origin,origin);assert.equal(url.pathname,basePath+paths.consent);
    assert.equal(url.search,'');
    assert.match(decodeURIComponent(url.hash.slice(8)),/^[A-Za-z0-9_-]{43}\.[0-9]{13}\.[A-Za-z0-9_-]{43}$/u);
    const crossOrigin=response();
    await f.auth.handleApi(request('POST',`${paths.invite}?room=官旗`,{xhr:true,originHeader:'https://evil.example'}),crossOrigin,paths.invite,f.administrator,
      new URL(origin+basePath+paths.invite+'?room=官旗'));
    assert.equal(crossOrigin.status,403);
  } finally {await rm(f.dir,{recursive:true,force:true});}
});

test('邀请十分钟、签名与持久一次性消费均 fail closed',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'coach-invite-store-'));
  let now=1_700_000_000_000;
  const key=randomBytes(32).toString('base64'),path=join(dir,'invitations.json');
  const store=createCoachCalendarInviteStore({path,signingKey:key,clock:()=>now});
  try {
    const issued=await store.issue('官旗',openIds['官旗']);
    assert.equal((await store.inspect(issued.token)).openId,openIds['官旗']);
    const tampered=issued.token.slice(0,-1)+(issued.token.endsWith('x')?'y':'x');
    await assert.rejects(store.inspect(tampered),{code:'coach_invite_invalid'});
    const reopened=createCoachCalendarInviteStore({path,signingKey:key,clock:()=>now});
    assert.equal((await reopened.consume(issued.token)).room,'官旗');
    await assert.rejects(store.inspect(issued.token),{code:'coach_invite_invalid'});
    await assert.rejects(store.consume(issued.token),{code:'coach_invite_invalid'});
    const later=await store.issue('优选',openIds['优选']);now=later.expiresAt;
    await assert.rejects(store.consume(later.token),{code:'coach_invite_invalid'});
    const wrongKey=createCoachCalendarInviteStore({path,signingKey:randomBytes(32).toString('base64'),clock:()=>1_700_000_000_000});
    await assert.rejects(wrongKey.inspect(later.token),{code:'coach_invite_invalid'});
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('两次并发使用同一邀请，最多一次进入飞书授权',async()=>{
  const f=await fixture();
  try {
    const issued=await f.issue();const token=decodeURIComponent(new URL(issued.body.inviteUrl).hash.slice(8));
    const form=`invite=${encodeURIComponent(token)}`;
    const responses=await Promise.all([0,1].map(async()=>{
      const res=response();await f.auth.handlePublic(request('POST',paths.start,{body:form}),res,paths.start,new URL(origin+basePath+paths.start));return res;
    }));
    assert.deepEqual(responses.map(item=>item.status).sort(),[303,409]);
    assert.equal(responses.filter(item=>item.status===303).length,1);
  } finally {await rm(f.dir,{recursive:true,force:true});}
});

test('无需中枢会话的本人邀请页经同源表单、单次 state 与 cookie 才完成；不会暴露中枢入口',async()=>{
  const f=await fixture();
  try {
    const issued=await f.issue();const link=new URL(issued.body.inviteUrl),token=decodeURIComponent(link.hash.slice(8));
    const landing=response();await f.auth.handlePublic(request('GET',paths.consent),landing,paths.consent,new URL(link.origin+link.pathname));
    assert.equal(landing.status,200);assert.match(landing.body,/无需登录中枢/u);
    assert.equal(landing.body.includes(token),false);
    assert.doesNotMatch(landing.body,/ou_guanqi|FD-024035/u);
    assert.match(landing.headers['Content-Security-Policy'],/form-action 'self'/u);
    assert.match(landing.headers['Content-Security-Policy'],/script-src 'nonce-/u);
    assert.equal(landing.headers['Referrer-Policy'],'no-referrer');
    const script=landing.body.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/u)?.[1];
    assert.ok(script);
    const controls={invite:{value:''},submit:{disabled:true},status:{textContent:''}},historyCalls=[];
    new Script(script).runInNewContext({location:{hash:`#invite=${encodeURIComponent(token)}`,pathname:link.pathname},
      history:{replaceState:(...args)=>historyCalls.push(args)},document:{getElementById:id=>controls[id]},decodeURIComponent});
    assert.equal(controls.invite.value,token);assert.equal(controls.submit.disabled,false);
    assert.equal(historyCalls.length,1);
    const queryLink=response();await f.auth.handlePublic(request('GET',paths.consent),queryLink,paths.consent,
      new URL(`${origin}${basePath}${paths.consent}?invite=${encodeURIComponent(token)}`));
    assert.equal(queryLink.status,400);assert.equal(String(queryLink.body).includes(token),false);
    const form=`invite=${encodeURIComponent(token)}`;
    for(const [originHeader,fetchSite] of [['https://evil.example','cross-site'],['', 'same-origin']]) {
      const rejected=response();await f.auth.handlePublic(request('POST',paths.start,{body:form,originHeader,fetchSite}),rejected,paths.start,new URL(origin+basePath+paths.start));
      assert.equal(rejected.status,403);
    }
    const started=response();await f.auth.handlePublic(request('POST',paths.start,{body:form}),started,paths.start,new URL(origin+basePath+paths.start));
    assert.equal(started.status,303);assert.match(started.headers.Location,/^https:\/\/accounts\.feishu\.cn\//u);
    assert.match(started.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/u);
    assert.equal(started.headers['Referrer-Policy'],'no-referrer');
    const state=started.headers['Set-Cookie'].match(/=([^;]+)/u)[1];
    const wrong=response();await f.auth.handleCallback(request('GET','/api/lifecycle/calendar-auth/callback'),wrong,
      new URL(`${callbackUrl}?state=${state}&code=mock`));
    assert.equal(wrong.status,400);assert.equal(f.calls.length,1); // The real reader rejects before token exchange.
    const second=response();assert.equal(await f.auth.handleCallback(request('GET','/api/lifecycle/calendar-auth/callback'),second,
      new URL(`${callbackUrl}?state=${state}&code=mock`)),false);
    const replay=response();await f.auth.handlePublic(request('POST',paths.start,{body:form}),replay,paths.start,new URL(origin+basePath+paths.start));
    assert.equal(replay.status,409);
  } finally {await rm(f.dir,{recursive:true,force:true});}
});

test('正确 cookie 的本人回调成功，身份状态改变则拒绝并不换取凭据',async()=>{
  for(const contactVerified of [true,false]) {
    const f=await fixture();
    try {
      const issued=await f.issue();const token=decodeURIComponent(new URL(issued.body.inviteUrl).hash.slice(8));
      const started=response();await f.auth.handlePublic(request('POST',paths.start,{body:`invite=${encodeURIComponent(token)}`}),started,paths.start,
        new URL(origin+basePath+paths.start));
      assert.equal(started.status,303);
      const state=started.headers['Set-Cookie'].match(/=([^;]+)/u)[1];
      const callback=response();
      const cookies=started.headers['Set-Cookie'].split(';')[0];
      const req=request('GET','/api/lifecycle/calendar-auth/callback');req.headers.cookie=cookies;
      if(!contactVerified)f.setContactVerified(false);
      await f.auth.handleCallback(req,callback,new URL(`${callbackUrl}?state=${state}&code=mock`));
      assert.equal(callback.status,contactVerified?200:400);assert.equal(f.calls.length,contactVerified?1:0);
      if(contactVerified)assert.doesNotMatch(callback.body,/返回直播中心/u);
    } finally {await rm(f.dir,{recursive:true,force:true});}
  }
});

test('公开邀请完整走原飞书 PKCE reader：错账号、错主日历拒存，正确本人加密保存',async()=>{
  for(const mode of ['wrong-user','wrong-primary','valid']) {
    const dir=await mkdtemp(join(tmpdir(),'coach-consent-reader-'));
    const now=1_700_000_000_000, redirectUri=`${origin}${basePath}/api/lifecycle/calendar-auth/callback`;
    let authorizationUrl='',tokenRequests=0;
    const provider=body=>({ok:true,status:200,json:async()=>body});
    try {
      const reader=createCalendarUserReader({appId:'cli_test',appSecret:'mock_secret',calendarId:'coach_primary',
        expectedOpenId:openIds['官旗'],ownerLabel:names['官旗'],requireOwnPrimaryCalendar:true,allowInstanceView:true,
        redirectUri,storePath:join(dir,'coach.enc'),encryptionKey:randomBytes(32).toString('base64'),now:()=>now,
        fetchImpl:async(url,options)=>{
          if(url.endsWith('/oauth/v3/token')) {
            tokenRequests++;
            const body=new URLSearchParams(options.body),authorization=new URL(authorizationUrl);
            assert.equal(body.get('redirect_uri'),redirectUri);
            assert.equal(body.get('code_verifier')?.length>43,true);
            assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
            return provider({code:0,access_token:'mock_access',refresh_token:'mock_refresh',expires_in:7200,
              refresh_token_expires_in:604800,scope:'calendar:calendar:read calendar:calendar.event:read offline_access'});
          }
          if(url.endsWith('/user_info')) return provider({code:0,data:{open_id:mode==='wrong-user'?'ou_other':openIds['官旗']}});
          if(url.includes('/calendars/primary?')) return provider({code:0,data:{calendars:[{user_id:mode==='wrong-primary'?'ou_other':openIds['官旗'],
            calendar:{calendar_id:'coach_primary',type:'primary',is_deleted:false}}]}});
          if(url.endsWith('/calendars/coach_primary')) return provider({code:0,data:{calendar:{role:'owner'}}});
          throw Error('unexpected mocked Feishu endpoint');
        }});
      const invitations=createCoachCalendarInviteStore({path:join(dir,'invitations.json'),signingKey:randomBytes(32).toString('base64'),clock:()=>now});
      const auth=createCoachCalendarAuth({readers:{'官旗':reader},coachNames:{'官旗':names['官旗']},employeeNos:{'官旗':numbers['官旗']},
        openIds:{'官旗':openIds['官旗']},basePath,enabled:true,publicEnabled:true,readOnly:false,publicCallbackUrl:redirectUri,
        invitations,clock:()=>now,authorizeIssuer:async()=>true,verifyActor:async()=>{},json:(res,status,data)=>{res.status=status;res.body=data;}});
      const invite=await invitations.issue('官旗',openIds['官旗']);
      const started=response();await auth.handlePublic(request('POST',paths.start,{body:`invite=${encodeURIComponent(invite.token)}`}),started,paths.start,
        new URL(origin+basePath+paths.start));
      assert.equal(started.status,303);authorizationUrl=started.headers.Location;
      const state=new URL(authorizationUrl).searchParams.get('state');
      const callback=response(),req=request('GET','/api/lifecycle/calendar-auth/callback');
      req.headers.cookie=started.headers['Set-Cookie'].split(';')[0];
      await auth.handleCallback(req,callback,new URL(`${redirectUri}?state=${state}&code=mock_one_time_code`));
      assert.equal(callback.status,mode==='valid'?200:400);
      assert.equal((await reader.status()).authorized,mode==='valid');
      assert.equal(tokenRequests,1);
    } finally {await rm(dir,{recursive:true,force:true});}
  }
});

test('新公共入口默认 OFF，且路由只开放最小 consent 与 public-start',async()=>{
  const f=await fixture({publicEnabled:false});
  try {
    const denied=await f.issue();assert.equal(denied.status,423);
    const page=response();await f.auth.handlePublic(request('GET',paths.consent),page,paths.consent,new URL(origin+basePath+paths.consent+'?invite=fake'));
    assert.equal(page.status,423);
    assert.equal(await f.auth.handlePublic(request('GET','/api/lifecycle/coach-calendar-auth/status'),response(),'/api/lifecycle/coach-calendar-auth/status',new URL(origin)),false);
    const server=readFileSync(new URL('./server.js',import.meta.url),'utf8');
    assert.ok(server.indexOf('coachCalendarAuth.handlePublic(req,res,routePath,url)')<server.indexOf('const auth = await authorizeCentral(req)'));
    assert.match(server,/COACH_CALENDAR_PUBLIC_CONSENT_ENABLED === 'true'/u);
  } finally {await rm(f.dir,{recursive:true,force:true});}
});

test('免登录入口必须绑定正式 HTTPS Host 与完整的已登记回调路径',async()=>{
  for(const registeredCallback of [
    'https://evil.example'+basePath+'/api/lifecycle/calendar-auth/callback',
    origin+basePath+'/api/lifecycle/calendar-auth/other',
    'http://hub.fandow.com'+basePath+'/api/lifecycle/calendar-auth/callback',
    callbackUrl+'?unexpected=1',
  ]) {
    const f=await fixture({registeredCallback});
    try {assert.equal((await f.issue()).status,423);} finally {await rm(f.dir,{recursive:true,force:true});}
  }
  const f=await fixture();
  try {
    const wrongHost=request('GET',paths.consent);wrongHost.headers.host='another.fandow.com';
    const res=response();await f.auth.handlePublic(wrongHost,res,paths.consent,new URL(origin+basePath+paths.consent));
    assert.equal(res.status,421);
  } finally {await rm(f.dir,{recursive:true,force:true});}
});

test('公共回调 Host 被替换时拒绝换取凭据，并单次消费 state',async()=>{
  const f=await fixture();
  try {
    const issued=await f.issue(),token=decodeURIComponent(new URL(issued.body.inviteUrl).hash.slice(8));
    const started=response();await f.auth.handlePublic(request('POST',paths.start,{body:`invite=${encodeURIComponent(token)}`}),started,
      paths.start,new URL(origin+basePath+paths.start));
    assert.equal(started.status,303);
    const state=started.headers['Set-Cookie'].match(/=([^;]+)/u)[1];
    const wrongHost=request('GET','/api/lifecycle/calendar-auth/callback');
    wrongHost.headers.host='evil.example';wrongHost.headers.cookie=started.headers['Set-Cookie'].split(';')[0];
    const blocked=response();assert.equal(await f.auth.handleCallback(wrongHost,blocked,new URL(`${callbackUrl}?state=${state}&code=mock`)),true);
    assert.equal(blocked.status,421);assert.equal(f.calls.length,0);
    const retry=request('GET','/api/lifecycle/calendar-auth/callback');retry.headers.cookie=wrongHost.headers.cookie;
    assert.equal(await f.auth.handleCallback(retry,response(),new URL(`${callbackUrl}?state=${state}&code=mock`)),false);
  } finally {await rm(f.dir,{recursive:true,force:true});}
});

test('管理员 UI 只展示签发与人工一对一投递，不开放自动发送',()=>{
  const shell=readFileSync(new URL('./site/index.html',import.meta.url),'utf8');
  const page=readFileSync(new URL('./site/coach-calendar-admin.html',import.meta.url),'utf8');
  assert.match(shell,/data-page="coach-calendar-admin" hidden/u);
  assert.match(shell,/hidden=!payload\.permissions\?\.super_admin/u);
  assert.match(page,/仅在已批准的一对一飞书会话中发给/u);
  assert.match(page,/当前页面未发送任何消息/u);
  assert.doesNotMatch(page,/\/api\/messages\/send|im\/v1\/messages/u);
  const script=page.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script);assert.doesNotThrow(()=>new Script(script));
  const server=readFileSync(new URL('./server.js',import.meta.url),'utf8');
  assert.match(server,/requestPath==='\/coach-calendar-admin\.html'/u);
  assert.match(server,/'X-Frame-Options':'SAMEORIGIN'/u);
  assert.match(server,/frame-ancestors 'self'/u);
  assert.match(server,/sha256-\$\{createHash\('sha256'\)/u);
});
