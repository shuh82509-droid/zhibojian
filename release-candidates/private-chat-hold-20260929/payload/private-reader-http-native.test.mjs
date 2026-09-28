// Only toy credentials, two fixture identities, an isolated temporary folder,
// and an injected provider. Native FS is intentional; no server/env is loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, lstat, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join, sep, basename} from 'node:path';
import {pathToFileURL} from 'node:url';

const moduleURL = name => process.env[name] ? pathToFileURL(resolve(process.env[name])).href : new URL(name === 'WIS_PRIVATE_READER_MODULE' ? './private-chat-reader.mjs' : './private-chat-auth.mjs', import.meta.url).href;
const {createPrivateChatReader, requiredScopes} = await import(moduleURL('WIS_PRIVATE_READER_MODULE'));
const {createPrivateChatAuth} = await import(moduleURL('WIS_PRIVATE_HTTP_MODULE'));
const actor = Object.freeze({name:'Fixture Owner', openId:'ou_fixture_owner', peerOpenId:'ou_fixture_peer'});
const auth = {ok:true, mode:'central', degraded:false, user:{number:'fixture', name:actor.name, open_id:actor.openId}};
const apiRequest = {method:'POST', headers:{origin:'https://fixture.invalid', 'x-requested-with':'XMLHttpRequest', 'sec-fetch-site':'same-origin'}};
function response() {
  return {statusCode:null, body:null, headers:{}, setHeader(name, value){this.headers[name]=value;},
    writeHead(status, headers){this.statusCode=status;Object.assign(this.headers, headers);}, end(body){this.body=body;}};
}
async function fixture(t) {
  const base = resolve(tmpdir());
  const directory = await mkdtemp(join(base, 'wis-private-source-qa-'));
  // Cleanup is restricted to this verified newly-created toy-only directory.
  t.after(async () => {
    const target = resolve(directory);
    assert.ok(target.startsWith(base+sep) && basename(target).startsWith('wis-private-source-qa-'));
    assert.equal((await lstat(target)).isDirectory(), true);
    await rm(target, {recursive:true, force:true});
  });
  const storePath = join(directory, 'private.enc');
  let at = 1_700_000_000_000, codeUnknown = false, refreshUnknown = false, readFailure = false;
  const count = {code:0, refresh:0, identity:0, pair:0, messages:0};
  const ok = data => ({ok:true, status:200, json:async () => data});
  const fetchImpl = async (url, options={}) => {
    if (url === 'https://open.feishu.cn/open-apis/authen/v2/oauth/token') {
      assert.equal(options.method, 'POST');assert.equal(options.redirect, 'error');
      assert.equal(options.headers['Content-Type'], 'application/json; charset=utf-8');
      const body = JSON.parse(options.body);
      assert.equal(body.client_id, 'fixture-app');assert.equal(body.client_secret, 'fixture-secret');
      assert.equal(body.scope, requiredScopes.join(' '));
      if (body.grant_type === 'authorization_code') {
        count.code++;
        assert.ok((await lstat(storePath+'.lock')).isDirectory());
        const marker = JSON.parse(await readFile(storePath+'.code-intent.json', 'utf8'));
        assert.equal(marker.kind, 'private_chat_code_exchange_intent');
        if (codeUnknown) throw Object.assign(new Error('toy-secret-code-result'), {code:'private_chat_unavailable'});
      } else {
        assert.equal(body.grant_type, 'refresh_token');count.refresh++;
        const marker = JSON.parse(await readFile(storePath+'.refresh-intent.json', 'utf8'));
        assert.equal(marker.kind, 'private_chat_refresh_intent');
        if (refreshUnknown) throw new Error('toy-secret-refresh-result');
      }
      return ok({code:0, access_token:'toy-access-'+(count.code+count.refresh), refresh_token:'toy-refresh-'+(count.code+count.refresh),
        scope:requiredScopes.join(' '), expires_in:600, refresh_token_expires_in:604800});
    }
    if (url === 'https://open.feishu.cn/open-apis/authen/v1/user_info') {count.identity++;return ok({code:0,data:{open_id:actor.openId}});}
    if (url.startsWith('https://open.feishu.cn/open-apis/im/v1/chat_p2p/batch_query?')) {
      count.pair++;assert.deepEqual(JSON.parse(options.body).chatter_ids, [actor.peerOpenId]);
      if (readFailure) throw new Error('toy-secret-get-failure');
      return ok({code:0,data:{p2p_chats:[{chat_id:'oc_fixture',chatter_id:actor.peerOpenId}]}});
    }
    if (url.startsWith('https://open.feishu.cn/open-apis/im/v1/messages?')) {count.messages++;return ok({code:0,data:{items:[],has_more:false}});}
    throw new Error('NO_REAL_PROVIDER_ALLOWED');
  };
  const options = {appId:'fixture-app',appSecret:'fixture-secret',expectedOpenId:actor.openId,peerOpenId:actor.peerOpenId,
    ownerLabel:actor.name,redirectUri:'https://fixture.invalid/fixture/api/lifecycle/calendar-auth/callback',storePath,
    encryptionKey:Buffer.alloc(32,1).toString('base64'),fetchImpl,now:()=>at};
  const reader = createPrivateChatReader(options);
  const handler = createPrivateChatAuth({actors:{fixture:actor},readers:{fixture:reader},basePath:'/fixture',publicOrigin:'https://fixture.invalid',
    enabled:true,verifyActor:async () => true,clock:()=>at,json(res,status,body){res.statusCode=status;res.body=body;return body;}});
  const range = () => ({startTime:Math.floor(at/1000)-60,endTime:Math.floor(at/1000)});
  async function authorize() {
    const start = response();await handler.handleApi(apiRequest,start,'/api/lifecycle/private-chat-auth/start',auth);
    assert.equal(start.statusCode,200);assert.equal(start.body.ok,true);
    const state = new URL(start.body.authorizeUrl).searchParams.get('state');
    const callback = response();
    await handler.handleCallback({method:'GET',headers:{cookie:start.headers['Set-Cookie'].split(';')[0]}},callback,
      new URL(options.redirectUri+'?state='+state+'&code=toy-code'));
    return callback;
  }
  return {reader,handler,count,storePath,options,range,authorize,
    advance:ms=>{at+=ms;},codeUnknown:()=>{codeUnknown=true;},refreshUnknown:()=>{refreshUnknown=true;},readFailure:()=>{readFailure=true;}};
}

test('native paired happy code and cached verify keep the exact four-scope two-person contract', async t => {
  const f = await fixture(t),callback = await f.authorize();
  assert.equal(callback.statusCode,200);assert.match(callback.body,/考核私聊授权完成/u);
  assert.deepEqual(await f.reader.status(),{configured:true,authorized:true,status:'authorized',recoveryRequired:false,retryAllowed:true});
  const res=response();await f.handler.handleApi(apiRequest,res,'/api/lifecycle/private-chat-auth/verify',auth);
  assert.equal(res.statusCode,200);assert.deepEqual(res.body,{ok:true,verification:{verified:true,sampleAvailable:false}});
  assert.deepEqual(f.count,{code:1,refresh:0,identity:1,pair:2,messages:2});
  const raw=await readFile(f.storePath,'utf8');assert.equal(JSON.parse(raw).version,2);
  assert.equal(raw.includes('toy-access'),false);assert.equal(raw.includes('toy-refresh'),false);
  await assert.rejects(lstat(f.storePath+'.lock'),{code:'ENOENT'});
});

test('native paired unknown refresh leaves marker+lock and same/fresh consumers make no replay', async t => {
  const f=await fixture(t);assert.equal((await f.authorize()).statusCode,200);
  const original=await readFile(f.storePath);f.advance(600001);f.refreshUnknown();
  const res=response();await f.handler.handleApi(apiRequest,res,'/api/lifecycle/private-chat-auth/verify',auth);
  assert.equal(res.statusCode,409);assert.equal(res.body.code,'private_chat_authorization_held');
  assert.equal(JSON.stringify(res.body).includes('toy-secret'),false);
  const fresh=createPrivateChatReader(f.options);
  for(const reader of [f.reader,fresh]) {
    const state=await reader.status();assert.equal(state.authorized,false);assert.equal(state.recoveryRequired,true);assert.equal(state.retryAllowed,false);
    await assert.rejects(reader.verify(),{code:'private_chat_authorization_held'});
    await assert.rejects(reader.readMessages(f.range()),{code:'private_chat_authorization_held'});
  }
  const again=response();await f.handler.handleApi(apiRequest,again,'/api/lifecycle/private-chat-auth/start',auth);
  assert.equal(again.statusCode,409);assert.equal(again.body.authorizeUrl,undefined);assert.equal(again.headers['Set-Cookie'],undefined);
  assert.equal(f.count.code,1);assert.equal(f.count.refresh,1);assert.deepEqual(await readFile(f.storePath),original);
  assert.equal((await lstat(f.storePath+'.lock')).isDirectory(),true);
  const marker=await readFile(f.storePath+'.refresh-intent.json','utf8');assert.equal(marker.includes('toy-'),false);
});

test('native paired unknown code cannot become success or a second exchange from a fresh reader', async t => {
  const f=await fixture(t);f.codeUnknown();const callback=await f.authorize();
  assert.equal(callback.statusCode,409);assert.equal(callback.body.includes('toy-secret'),false);assert.match(callback.body,/请勿刷新回调页/u);
  const fresh=createPrivateChatReader(f.options),state=await fresh.status();
  assert.equal(state.recoveryRequired,true);assert.equal(state.retryAllowed,false);
  await assert.rejects(fresh.verify(),{code:'private_chat_authorization_held'});
  const next=response();await f.handler.handleApi(apiRequest,next,'/api/lifecycle/private-chat-auth/start',auth);
  assert.equal(next.statusCode,409);assert.equal(f.count.code,1);assert.equal(f.count.refresh,0);assert.equal(f.count.identity,0);
  const marker=await readFile(f.storePath+'.code-intent.json','utf8');assert.equal(marker.includes('toy-'),false);assert.equal(marker.includes('pchat_'),false);
});

test('native ordinary cached message GET failure releases lock, never reflects raw data, and does not rotate', async t => {
  const f=await fixture(t);assert.equal((await f.authorize()).statusCode,200);f.readFailure();
  const res=response();await f.handler.handleApi(apiRequest,res,'/api/lifecycle/private-chat-auth/verify',auth);
  assert.equal(res.statusCode,409);assert.equal(JSON.stringify(res.body).includes('toy-secret'),false);
  assert.equal((await f.reader.status()).authorized,true);assert.equal(f.count.refresh,0);
  await assert.rejects(lstat(f.storePath+'.lock'),{code:'ENOENT'});
});

test('native unknown marker content blocks an otherwise cached valid grant without parsing secrets', async t => {
  const f=await fixture(t);assert.equal((await f.authorize()).statusCode,200);
  await writeFile(f.storePath+'.refresh-intent.json','untrusted-toy-marker',{flag:'wx',mode:0o600});
  const before={...f.count};assert.equal((await f.reader.status()).recoveryRequired,true);
  await assert.rejects(f.reader.verify(),{code:'private_chat_authorization_held'});
  assert.deepEqual(f.count,before);
});
