// Independent private reader one-use risk fixtures. Source+memory only; no store/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import vm from 'node:vm';
const root='H:/codex输出/直播五环节工作流-20260923';
const oldPin='8eff752b765aed9ac10db7ca0493ee5a8b6f54dd619cc20bcc6239b8e419bf69';
const hasModule=Object.hasOwn(process.env,'WIS_PRIVATE_READER_MODULE'),hasPin=Object.hasOwn(process.env,'WIS_PRIVATE_READER_SHA');
assert.equal(hasModule,hasPin,'source selector and SHA must be paired');
const sourcePath=hasModule?process.env.WIS_PRIVATE_READER_MODULE:root+'/private-auth-hold-exact-20260929-0245/reference/private-chat-reader.mjs';
const sourcePin=hasPin?process.env.WIS_PRIVATE_READER_SHA:oldPin;
assert.match(sourcePin,/^[a-f0-9]{64}$/u);
const source=readFileSync(sourcePath);
assert.equal(crypto.createHash('sha256').update(source).digest('hex'),sourcePin);
const text=new TextDecoder('utf-8',{fatal:true}).decode(source);
globalThis.fetch=async()=>{throw Error('REAL_NETWORK_FORBIDDEN');};
const scopes=['im:chat:read','im:message:readonly','im:message.p2p_msg:get_as_user','offline_access'];
const owner='ou_synthetic_owner',peer='ou_synthetic_peer',appId='cli_synthetic_private';
const SECRET='SYNTHETIC_PRIVATE_ONE_USE_SECRET_NOT_FOR_PUBLIC';
const code='synthetic_authorization_code',access='synthetic_access_token',refresh='synthetic_refresh_token';
const tokenUrl='https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const key=Buffer.alloc(32,17),baseNow=1_700_000_000_000;
const contextAAD=Buffer.from(JSON.stringify(['private-chat-v1',appId,owner,peer,scopes]));
const contextSha256=crypto.createHash('sha256').update(contextAAD).digest('hex');
const response=data=>({ok:true,status:200,headers:{get(){return null;}},json:async()=>data});
function encryptGrant(record){
 const cipher=crypto.createCipheriv('aes-256-gcm',key,Buffer.alloc(12,3));cipher.setAAD(contextAAD);
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(record),'utf8'),cipher.final()]);
 return JSON.stringify({version:2,iv:Buffer.alloc(12,3).toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')});
}
async function harness({seed=false,expired=false,tokenReply=null,providerThrow=false,wrongUser=false,badPair=false,badMessage=false}={}){
 let now=baseNow,lastMutation=null,fault=null,pauseToken=null,ordinaryFail=false;
 const store='/synthetic-private-fixture/grant.enc',lock=store+'.lock',codeIntent=store+'.code-intent.json',refreshIntent=store+'.refresh-intent.json';
 const files=new Map(),dirs=new Set(['/synthetic-private-fixture']),events=[],requests=[],logs=[];
 const counters={code:0,refresh:0,user:0,pair:0,messages:0,grantReads:0};
 const failure=()=>Object.assign(Error(SECRET),{code:'EIO'});
 const role=p=>p.includes('.code-intent.json')||p.includes('.refresh-intent.json')?'intent':p===store||p.startsWith(store+'.')&&!p.endsWith('.lock')?'grant':'directory';
 function event(kind,p,after=false,extra={}){
  const e={kind,path:p,after,role:role(p),lastMutation,...extra};events.push(e);
  if(fault&&fault.match(e)){const action=fault;fault=null;action.hit++;if(action.effect)return action.effect(e);throw failure();}
 }
 const fs={
  async mkdir(p,options={}){event('mkdir',p);if(dirs.has(p)){if(options.recursive)return;throw Object.assign(Error('exists'),{code:'EEXIST'});}dirs.add(p);event('mkdir',p,true);},
  async stat(p){event('stat',p);if(!files.has(p)&&!dirs.has(p))throw Object.assign(Error('absent'),{code:'ENOENT'});return {isFile:()=>files.has(p),isDirectory:()=>dirs.has(p),isSymbolicLink:()=>false};},
  async lstat(p){event('lstat',p);if(!files.has(p)&&!dirs.has(p))throw Object.assign(Error('absent'),{code:'ENOENT'});return {isFile:()=>files.has(p),isDirectory:()=>dirs.has(p),isSymbolicLink:()=>false};},
  async readFile(p){event('read',p);if(p===store)counters.grantReads++;if(!files.has(p))throw Object.assign(Error('absent'),{code:'ENOENT'});
   const value=files.get(p),alter=event('read',p,true,{value});return alter===undefined?value:alter;},
  async open(p,flags){
   event('open',p,false,{flags});
   if(flags==='r'){if(!dirs.has(p))throw failure();return {async sync(){event('dirsync',p);event('dirsync',p,true);},async close(){event('dirclose',p);}};}
   assert.equal(flags,'wx');if(files.has(p))throw Object.assign(Error('exists'),{code:'EEXIST'});files.set(p,'');
   return {async writeFile(value){event('write',p);files.set(p,String(value));event('write',p,true);},
    async sync(){event('filesync',p);event('filesync',p,true);},async close(){event('fileclose',p);event('fileclose',p,true);}};
  },
  async rename(from,to){event('rename',to,false,{from});if(!files.has(from))throw failure();files.set(to,files.get(from));files.delete(from);lastMutation=to===store?'grant':'intent';event('rename',to,true,{from});},
  async unlink(p){event('unlink',p);if(!files.delete(p))throw Object.assign(Error('absent'),{code:'ENOENT'});lastMutation=role(p)==='intent'?'clearintent':'grant';event('unlink',p,true);},
  async rmdir(p){event('rmdir',p);if(!dirs.delete(p))throw Object.assign(Error('absent'),{code:'ENOENT'});lastMutation='release';event('rmdir',p,true);}
 };
 const ctx=vm.createContext({Buffer,URL,URLSearchParams,AbortSignal,Date,process:{platform:'linux'},console:{warn(...args){logs.push(args);},log(...args){logs.push(args);}},fetch:globalThis.fetch});
 function synthetic(name,ns){return new vm.SyntheticModule(Object.keys(ns),function(){for(const k of Object.keys(ns))this.setExport(k,ns[k]);},{context:ctx,identifier:name});}
 const imports=new Map();
 const module=new vm.SourceTextModule(text,{context:ctx,identifier:'independent-private-reader:'+sourcePin});
 await module.link(async specifier=>{
  if(!imports.has(specifier)){
   if(specifier==='node:crypto')imports.set(specifier,synthetic(specifier,crypto));
   else if(specifier==='node:path')imports.set(specifier,synthetic(specifier,path));
   else if(specifier==='node:fs/promises')imports.set(specifier,synthetic(specifier,fs));
   else throw Error('UNAPPROVED_IMPORT_'+specifier);
  }return imports.get(specifier);
 });await module.evaluate();
 assert.deepEqual(Array.from(module.namespace.requiredScopes),scopes);
 const provider=async(url,options={})=>{
  requests.push({url,options});
  if(url===tokenUrl){
   assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.match(options.headers['Content-Type'],/^application\/json/u);
   const body=JSON.parse(options.body);assert.equal(body.client_id,appId);assert.equal(body.client_secret,SECRET);assert.equal(body.scope,scopes.join(' '));
   if(body.grant_type==='authorization_code'){counters.code++;assert.equal(body.code,code);assert(body.code_verifier);assert.equal(body.redirect_uri,'https://fixture.invalid/private/callback');}
   else{assert.equal(body.grant_type,'refresh_token');counters.refresh++;assert.equal(body.refresh_token,refresh);}
   if(pauseToken)await pauseToken.promise;
   if(providerThrow)throw failure();
   if(tokenReply)return typeof tokenReply==='function'?tokenReply(body):tokenReply;
   return response({code:0,access_token:access,refresh_token:refresh,expires_in:3600,refresh_token_expires_in:86400,scope:scopes.join(' ')});
  }
  assert(url.startsWith('https://open.feishu.cn/open-apis/'),'only exact approved base');
  if(url.endsWith('/authen/v1/user_info')){counters.user++;return response({code:0,data:{open_id:wrongUser?'ou_synthetic_other':owner}});}
  if(ordinaryFail)throw failure();
  if(url.includes('/im/v1/chat_p2p/batch_query?')){
   counters.pair++;assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{chatter_ids:[peer]});
   return response({code:0,data:{p2p_chats:badPair?[]:[{chat_id:'oc_syntheticPair',chatter_id:peer}]}});
  }
  if(url.includes('/im/v1/messages?')){counters.messages++;return response({code:0,data:{items:badMessage?[{chat_id:'oc_wrong',sender:{sender_type:'user',id:owner},message_id:'m_x'}]:[],has_more:false}});}
  throw Error('UNEXPECTED_PROVIDER_PATH');
 };
 const make=()=>module.namespace.createPrivateChatReader({appId,appSecret:SECRET,expectedOpenId:owner,peerOpenId:peer,ownerLabel:'Fictional Owner',
  redirectUri:'https://fixture.invalid/private/callback',storePath:store,encryptionKey:key.toString('base64'),fetchImpl:provider,now:()=>now});
 const record={openId:owner,accessToken:access,refreshToken:refresh,accessExpiresAt:now+(expired?1000:3600000),refreshExpiresAt:now+86400000,scopes:scopes.join(' '),verifiedAt:new Date(now).toISOString()};
 if(seed)files.set(store,encryptGrant(record));
 const reader=make();
 return {reader,make,files,dirs,events,requests,logs,counters,store,lock,codeIntent,refreshIntent,
  setFault(match,effect){fault={match,effect,hit:0};return fault;},
  setPause(){let resolve;const promise=new Promise(r=>resolve=r);pauseToken={promise,resolve};return pauseToken;},
  setOrdinaryFail(value){ordinaryFail=value;},advance(ms){now+=ms;},
  async complete(r=reader){const begun=r.begin();const result=await r.complete({code,state:begun.state,cookieState:begun.state});return {begun,result};},
  operation(mode,r=reader){return mode==='code'?this.complete(r):r.verify();},
  seed(recordOverride={}){files.set(store,encryptGrant({...record,...recordOverride}));}
 };
}
const posts=h=>h.counters.code+h.counters.refresh;
function blocked(status){assert.equal(status.authorized,false);assert.equal(status.retryAllowed,false);assert(['recovery_required','busy'].includes(status.status));}
function safeError(e){assert.equal(String(e?.message).includes(SECRET),false);}
async function expectFailure(operation){try{await operation;}catch(e){safeError(e);return e;}assert.fail('must reject uncertain operation');}
async function quarantine(h,{restart=true}={}){
 const before=h.counters.grantReads;const status=await h.reader.status();blocked(status);assert.equal(h.counters.grantReads,before,'held/busy must gate before reading old grant');
 const beforePosts=posts(h);
 for(const r of restart?[h.reader,h.make()]:[h.reader]){
  blocked(await r.status());await expectFailure(r.verify());await expectFailure(r.readMessages({startTime:Math.floor(baseNow/1000)-10,endTime:Math.floor(baseNow/1000)}));
  await expectFailure(h.complete(r));assert.equal(posts(h),beforePosts,'no one-use resend after held/restart/cache');
 }
 assert.equal(h.logs.length,0,'no OAuth or private data logging');
}
function intentSafety(h,kind){
 const raw=h.files.get(kind==='code'?h.codeIntent:h.refreshIntent);
 assert.equal(typeof raw,'string');const item=JSON.parse(raw);
 assert.deepEqual(Object.keys(item).sort(),['attemptId','contextSha256','createdAt','kind','schemaVersion']);
 assert.equal(item.schemaVersion,1);assert.equal(item.kind,kind==='code'?'private_chat_code_exchange_intent':'private_chat_refresh_intent');
 assert.equal(item.contextSha256,contextSha256);assert.match(item.attemptId,/^[a-f0-9]{32}$/u);assert.equal(new Date(item.createdAt).toISOString(),item.createdAt);
 for(const hidden of [SECRET,code,access,refresh,'code_verifier','cookieState'])assert.equal(raw.includes(hidden),false);
}
test('preserve public five methods, exact scopes, pchat S256 and fixed redirect with no FS/provider begin',async()=>{
 const h=await harness();assert.deepEqual(Object.keys(h.reader).sort(),['begin','complete','readMessages','status','verify']);
 const before=h.events.length,begun=h.reader.begin(),url=new URL(begun.url);
 assert.match(begun.state,/^pchat_/u);assert.equal(url.origin,'https://accounts.feishu.cn');assert.equal(url.searchParams.get('scope'),scopes.join(' '));
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('redirect_uri'),'https://fixture.invalid/private/callback');
 assert.equal(h.events.length,before);assert.equal(posts(h),0);assert.equal(h.requests.length,0);
});
test('preserve valid own/peer v2 JSON exchange and encrypted exact-context grant',async()=>{
 const h=await harness(),done=await h.complete();assert.equal(done.result.authorized,true);assert.equal(posts(h),1);assert.equal(h.counters.code,1);assert.equal(h.counters.refresh,0);
 assert.equal(h.files.size,1);assert(h.files.has(h.store));assert.equal(h.dirs.has(h.lock),false);
 const raw=h.files.get(h.store);for(const value of [SECRET,code,access,refresh,owner,peer])assert.equal(raw.includes(value),false);
 assert.equal((await h.reader.status()).authorized,true);assert.equal((await h.reader.verify()).verified,true);
});
test('wrong cookie and consumed state reject before token POST without recovery claims',async()=>{
 const h=await harness(),attempt=h.reader.begin();
 await assert.rejects(h.reader.complete({code,state:attempt.state,cookieState:'pchat_other'}),{code:'private_chat_oauth_state_invalid'});
 await assert.rejects(h.reader.complete({code,state:attempt.state,cookieState:attempt.state}),{code:'private_chat_oauth_state_invalid'});
 assert.equal(posts(h),0);assert.equal(h.files.size,0);
});
const preFaults={
 open:e=>e.kind==='open'&&e.role==='intent'&&!e.after,
 write:e=>e.kind==='write'&&e.role==='intent'&&!e.after,
 filesync:e=>e.kind==='filesync'&&e.role==='intent'&&!e.after,
 fileclose:e=>e.kind==='fileclose'&&e.role==='intent'&&!e.after,
 rename:e=>e.kind==='rename'&&e.role==='intent'&&!e.after,
 dirsync:e=>e.kind==='dirsync'&&e.lastMutation==='intent'&&!e.after,
 readback:e=>e.kind==='read'&&e.role==='intent'&&!e.after
};
for(const mode of ['code','refresh'])for(const [phase,match]of Object.entries(preFaults))test('pre-POST '+mode+' intent '+phase+' failure cannot consume token',async()=>{
 const h=await harness({seed:mode==='refresh',expired:mode==='refresh'}),fault=h.setFault(match);
 await expectFailure(h.operation(mode));assert.equal(fault.hit,1,'fault must reach actual intent phase');
 assert.equal(posts(h),0,'intent write/sync/close/rename/dirsync/readback failure precedes POST');
 await quarantine(h);
});
const malformedGrant=[
 ['object access_token',{access_token:{value:access}}],['array refresh_token',{refresh_token:[refresh]}],
 ['CRLF access token',{access_token:access+'\r\nX: '+SECRET}],['NUL refresh token',{refresh_token:refresh+'\0'}],
 ['nonstring scope',{scope:[scopes.join(' ')]}],['string expires',{expires_in:'3600'}],
 ['fractional expiry',{expires_in:1.5}],['unsafe absolute expiry',{refresh_token_expires_in:Number.MAX_SAFE_INTEGER}],
];
for(const mode of ['code','refresh'])for(const [label,alter]of malformedGrant)test('strict '+mode+' grant '+label+' stays quarantined before identity/private GET',async()=>{
 const h=await harness({seed:mode==='refresh',expired:mode==='refresh',tokenReply:()=>response({code:0,access_token:access,refresh_token:refresh,expires_in:3600,refresh_token_expires_in:86400,scope:scopes.join(' '),...alter})});
 await expectFailure(h.operation(mode));assert.equal(posts(h),1);assert.equal(h.counters.user,0);assert.equal(h.counters.pair,0);assert.equal(h.counters.messages,0);
 await quarantine(h);intentSafety(h,mode);
});
for(const mode of ['code','refresh'])test('unknown '+mode+' network result stays held across instance restart with no second POST',async()=>{
 const h=await harness({seed:mode==='refresh',expired:mode==='refresh',providerThrow:true});
 await expectFailure(h.operation(mode));assert.equal(posts(h),1);intentSafety(h,mode);await quarantine(h);
});
for(const mode of ['code','refresh'])for(const [label,tokenReply]of [
 ['malformed JSON',()=>({ok:true,status:200,json:async()=>{throw Error(SECRET);}})],
 ['unknown HTTP success',()=>response({code:0})],
 ['provider rejection',()=>({ok:false,status:503,json:async()=>({code:999,msg:SECRET})})],
 ['scope missing',()=>response({code:0,access_token:access,refresh_token:refresh,expires_in:3600,refresh_token_expires_in:86400,scope:'offline_access'})],
])test('one-use '+mode+' '+label+' never becomes a retry permit',async()=>{
 const h=await harness({seed:mode==='refresh',expired:mode==='refresh',tokenReply});await expectFailure(h.operation(mode));
 assert.equal(posts(h),1);assert.equal(h.counters.user,0);await quarantine(h);intentSafety(h,mode);
});
const grantFaults={
 write:e=>e.kind==='write'&&e.role==='grant'&&!e.after,
 filesync:e=>e.kind==='filesync'&&e.role==='grant'&&!e.after,
 fileclose:e=>e.kind==='fileclose'&&e.role==='grant'&&!e.after,
 rename:e=>e.kind==='rename'&&e.path.endsWith('/grant.enc')&&!e.after,
 dirsync:e=>e.kind==='dirsync'&&e.lastMutation==='grant'&&!e.after,
 readback:e=>e.kind==='read'&&e.path.endsWith('/grant.enc')&&e.lastMutation==='grant'&&e.after
};
for(const mode of ['code','refresh'])for(const [phase,match]of Object.entries(grantFaults))test('post-POST '+mode+' encrypted save '+phase+' failure blocks cached/restarted reads',async()=>{
 const h=await harness({seed:mode==='refresh',expired:mode==='refresh'}),fault=h.setFault(match);
 await expectFailure(h.operation(mode));assert.equal(fault.hit,1);assert.equal(posts(h),1);await quarantine(h);
});
for(const mode of ['code','refresh'])for(const [phase,match]of Object.entries({
 intent_unlink:e=>e.kind==='unlink'&&e.role==='intent'&&!e.after,
 intent_unlink_after_effect:e=>e.kind==='unlink'&&e.role==='intent'&&e.after,
 clear_dirsync:e=>e.kind==='dirsync'&&e.lastMutation==='clearintent'&&!e.after,
 lock_release_after_effect:e=>e.kind==='rmdir'&&e.path.endsWith('.lock')&&e.after
}))test('successful '+mode+' exchange then '+phase+' failure retains last durable anchor',async()=>{
 const h=await harness({seed:mode==='refresh',expired:mode==='refresh'}),fault=h.setFault(match);
 await expectFailure(h.operation(mode));assert.equal(fault.hit,1);assert.equal(posts(h),1);await quarantine(h);
});
for(const marker of ['code','refresh','lock'])test('preexisting '+marker+' blocks status/fast valid cache/verify/read/complete before old grant read',async()=>{
 const h=await harness({seed:true});if(marker==='lock')h.dirs.add(h.lock);else h.files.set(marker==='code'?h.codeIntent:h.refreshIntent,'{malformed synthetic marker}');
 await quarantine(h);assert.equal(posts(h),0);assert.equal(h.counters.grantReads,0);assert.equal(h.requests.length,0);
});
test('marker filesystem status failure is conservative quarantine, never reads old valid cache',async()=>{
 const h=await harness({seed:true}),f=h.setFault(e=>['stat','lstat'].includes(e.kind)&&e.path===h.codeIntent&&!e.after);
 blocked(await h.reader.status());assert.equal(f.hit,1);assert.equal(h.counters.grantReads,0);assert.equal(posts(h),0);
});
for(const option of ['wrongUser','badPair','badMessage'])test('post-code fixed person/pair verification failure remains held: '+option,async()=>{
 const h=await harness({[option]:true});await expectFailure(h.complete());assert.equal(posts(h),1);assert.equal(h.files.has(h.store),false);await quarantine(h);
});
test('ordinary nonrotating private GET failure does not create permanent refresh/code hold',async()=>{
 const h=await harness({seed:true});h.setOrdinaryFail(true);await expectFailure(h.reader.verify());
 assert.equal(posts(h),0);assert.equal(h.files.has(h.codeIntent),false);assert.equal(h.files.has(h.refreshIntent),false);assert.equal(h.dirs.has(h.lock),false);
 assert.equal((await h.reader.status()).authorized,true);h.setOrdinaryFail(false);assert.equal((await h.reader.verify()).verified,true);
});
test('concurrent unknown refresh is at most one POST, and no cache/restart can consume it again',async()=>{
 const h=await harness({seed:true,expired:true,providerThrow:true}),pause=h.setPause();
 const resultsPromise=Promise.allSettled([h.reader.verify(),h.reader.verify()]);await new Promise(setImmediate);assert.equal(posts(h),1);
 pause.resolve();const results=await resultsPromise;assert(results.every(r=>r.status==='rejected'));assert.equal(posts(h),1);await quarantine(h);
});
test('concurrent successful distinct code callbacks consume at most one code and preserve a saved grant',async()=>{
 const h=await harness(),a=h.reader.begin(),b=h.reader.begin(),pause=h.setPause();
 const resultsPromise=Promise.allSettled([h.reader.complete({code,state:a.state,cookieState:a.state}),h.reader.complete({code,state:b.state,cookieState:b.state})]);
 await new Promise(setImmediate);assert.equal(posts(h),1);pause.resolve();const results=await resultsPromise;
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(posts(h),1);assert.equal((await h.reader.status()).authorized,true);
});
test('code callback lifetime is rechecked after durable intent I/O immediately before POST',async()=>{
 const h=await harness();const f=h.setFault(e=>e.kind==='dirsync'&&e.lastMutation==='intent'&&!e.after,()=>{h.advance(600_001);});
 await expectFailure(h.complete());assert.equal(f.hit,1);assert.equal(posts(h),0,'expired callback must not consume code after slow intent disk I/O');await quarantine(h);
});
test('refresh expiration is rechecked after durable intent I/O immediately before POST',async()=>{
 const h=await harness({seed:true,expired:true});h.seed({refreshExpiresAt:baseNow+1000});
 const f=h.setFault(e=>e.kind==='dirsync'&&e.lastMutation==='intent'&&!e.after,()=>{h.advance(1001);});
 await expectFailure(h.reader.verify());assert.equal(f.hit,1);assert.equal(posts(h),0,'expired refresh must not POST after slow intent disk I/O');await quarantine(h);
});
for(const mode of ['code','refresh'])test('in-flight '+mode+' process restart sees durable intent and cannot issue another exchange',async()=>{
 const h=await harness({seed:mode==='refresh',expired:mode==='refresh',providerThrow:true}),pause=h.setPause();
 const resultPromise=Promise.allSettled([h.operation(mode)]);await new Promise(setImmediate);assert.equal(posts(h),1);
 intentSafety(h,mode);const second=h.make();blocked(await second.status());
 await expectFailure(second.verify());await expectFailure(second.readMessages({startTime:Math.floor(baseNow/1000)-10,endTime:Math.floor(baseNow/1000)}));
 await expectFailure(h.complete(second));assert.equal(posts(h),1,'restart while previous request is unresolved cannot consume another code/refresh');
 pause.resolve();const [result]=await resultPromise;assert.equal(result.status,'rejected');await quarantine(h);
});
test('grant save exact encrypted bytes readback mismatch must quarantine even if JSON decryptable',async()=>{
 const h=await harness(),f=h.setFault(e=>e.kind==='read'&&e.path===h.store&&e.lastMutation==='grant'&&e.after,e=>e.value+' ');
 await expectFailure(h.complete());assert.equal(f.hit,1);assert.equal(posts(h),1);await quarantine(h);
});
for(const mode of ['code','refresh'])test('grant success but malformed/wrong owner user_info rejects and remains held: '+mode,async()=>{
 const h=await harness({seed:mode==='refresh',expired:mode==='refresh',wrongUser:true});
 await expectFailure(h.operation(mode));assert.equal(posts(h),1);assert.equal(h.counters.user,1);assert.equal(h.counters.pair,0);await quarantine(h);
});
for(const mode of ['code','refresh'])test('post-intent '+mode+' clock rollback rejects before POST and retains hold',async()=>{
 const h=await harness({seed:mode==='refresh',expired:mode==='refresh'}),f=h.setFault(e=>e.kind==='dirsync'&&e.lastMutation==='intent'&&!e.after,()=>{h.advance(-1);});
 await expectFailure(h.operation(mode));assert.equal(f.hit,1);assert.equal(posts(h),0);await quarantine(h);
});
