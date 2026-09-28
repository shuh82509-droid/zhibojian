// Source-completeness contract attacks, separate from the frozen335 one-use suite.
// All identities/tokens/messages are fictional. Native FS only in newly-created temp directories.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,sep,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const hasModule=Object.hasOwn(process.env,'WIS_PRIVATE_SOURCE_READER_MODULE'),hasSha=Object.hasOwn(process.env,'WIS_PRIVATE_SOURCE_READER_SHA');
assert.equal(hasModule,hasSha,'source selector and raw SHA are paired');
const sourcePath=hasModule?process.env.WIS_PRIVATE_SOURCE_READER_MODULE:'H:/codex输出/直播五环节工作流-20260923/private-auth-hold-exact-20260929-0245/frozen/private-chat-reader.mjs';
const sourcePin=hasSha?process.env.WIS_PRIVATE_SOURCE_READER_SHA:'9b74ac9356e3679255a25c815c624de88778b999666553a3b109bad9c1cae5fd';
assert.match(sourcePin,/^[a-f0-9]{64}$/u);assert.equal(createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),sourcePin);
globalThis.fetch=async()=>{throw Error('REAL_PROVIDER_FORBIDDEN');};
const {createPrivateChatReader,requiredScopes}=await import(pathToFileURL(resolve(sourcePath)).href);
const now=1_700_000_000_000,nowSec=now/1000,start=nowSec-100,end=nowSec-10;
const owner='ou_source_fixture_owner',peer='ou_source_fixture_peer',chat='oc_sourceFixture';
const message=(id='om_fixture_1',extra={})=>({message_id:'om_'+createHash('sha256').update(id).digest('hex'),chat_id:chat,sender:{sender_type:'user',id_type:'open_id',id:owner},msg_type:'text',
 create_time:String((start+30)*1000),update_time:String((start+30)*1000),deleted:false,updated:false,body:{content:'{"text":"Fictional source message"}'},...extra});
const validPage=(items=[])=>({items,has_more:false});
async function fixture(t,pages=[validPage([message()])],{pairMissingPeer=false}={}){
 const tempBase=resolve(tmpdir()),directory=await mkdtemp(join(tempBase,'wis-private-source-0345-'));
 t.after(async()=>{const target=resolve(directory),info=await lstat(target);
  assert(target.startsWith(tempBase+sep)&&basename(target).startsWith('wis-private-source-0345-'));
  assert(info.isDirectory()&&!info.isSymbolicLink());await rm(target,{recursive:true,force:true});});
 let readPage=0;const count={code:0,refresh:0,user:0,pair:0,permissionSample:0,readPages:0},seenTokens=[];
 const ok=data=>({ok:true,status:200,json:async()=>data});
 const provider=async(url,options={})=>{
  if(url==='https://open.feishu.cn/open-apis/authen/v2/oauth/token'){
   const body=JSON.parse(options.body);assert.equal(body.client_id,'synthetic-source-app');assert.equal(body.client_secret,'synthetic-source-secret');
   assert.equal(body.scope,requiredScopes.join(' '));assert.equal(body.grant_type,'authorization_code');count.code++;
   return ok({code:0,access_token:'synthetic-source-access',refresh_token:'synthetic-source-refresh',expires_in:3600,refresh_token_expires_in:86400,scope:requiredScopes.join(' ')});
  }
  if(url==='https://open.feishu.cn/open-apis/authen/v1/user_info'){count.user++;return ok({code:0,data:{open_id:owner}});}
  const parsed=new URL(url);assert.equal(parsed.origin,'https://open.feishu.cn');
  if(parsed.pathname==='/open-apis/im/v1/chat_p2p/batch_query'){
   count.pair++;assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{chatter_ids:[peer]});
   return ok({code:0,data:{p2p_chats:[{chat_id:chat,...(pairMissingPeer?{}:{chatter_id:peer})}]}});
  }
  if(parsed.pathname==='/open-apis/im/v1/messages'){
   assert.equal(options.method,'GET');assert.equal(parsed.searchParams.get('container_id'),chat);
   if(parsed.searchParams.get('page_size')==='1'){count.permissionSample++;return ok({code:0,data:validPage()});}
   assert.equal(parsed.searchParams.get('page_size'),'50');count.readPages++;seenTokens.push(parsed.searchParams.get('page_token'));
   const body=typeof pages==='function'?pages(readPage++,parsed):pages[readPage++];
   assert.notEqual(body,undefined,'fixture must explicitly provide every provider page');
   return ok({code:0,data:JSON.parse(JSON.stringify(body))});
  }
  throw Error('UNAPPROVED_PROVIDER_PATH');
 };
 const reader=createPrivateChatReader({appId:'synthetic-source-app',appSecret:'synthetic-source-secret',expectedOpenId:owner,peerOpenId:peer,ownerLabel:'Fictional Source Owner',
  redirectUri:'https://fixture.invalid/private-source/callback',storePath:join(directory,'toy-grant.enc'),encryptionKey:Buffer.alloc(32,41).toString('base64'),fetchImpl:provider,now:()=>now});
 const attempt=reader.begin();assert.equal((await reader.complete({code:'synthetic-code',state:attempt.state,cookieState:attempt.state})).authorized,true);
 assert.deepEqual(await reader.status(),{configured:true,authorized:true,status:'authorized',recoveryRequired:false,retryAllowed:true});
 return {reader,count,seenTokens,read:range=>reader.readMessages(range??{startTime:start,endTime:end})};
}
async function mustNotClaimComplete(f,{pairEarly=false}={}){
 let result,error;try{result=await f.read();}catch(cause){error=cause;}
 assert(pairEarly?f.count.pair>=2:f.count.readPages>0,'negative must exercise actual source provider, not unrelated OAuth failure');
 if(error){assert.match(error.code,/^private_chat_/u);assert(!/authorization|oauth|configured|held/u.test(error.code),'reject must concern source, not credential fixture');return;}
 assert.notEqual(result?.complete,true,'incomplete/conflicting/out-of-bound source must not be marked complete');
}

test('control: explicit boolean terminal page, unique IDs and fixed user pair returns both messages',async t=>{
 const f=await fixture(t,[validPage([message(),message('om_fixture_2',{sender:{sender_type:'user',id_type:'open_id',id:peer}})])]);
 const result=await f.read();assert.equal(result.complete,true);assert.equal(result.items.length,2);assert.equal(f.count.readPages,1);assert.equal(f.count.refresh,0);
});
test('control: normal two pages and identical replayed ID deduplicate without fabricating a third record',async t=>{
 const m=message(),f=await fixture(t,[{items:[m],has_more:true,page_token:'cursor_fixture'},validPage([m,message('om_fixture_2')])]);
 const result=await f.read();assert.equal(result.complete,true);assert.deepEqual(result.items.map(m=>m.message_id),[message().message_id,message('om_fixture_2').message_id]);assert.deepEqual(f.seenTokens,[null,'cursor_fixture']);
});
test('control: missing cursor when more=true rejects, no partial complete',async t=>{
 const f=await fixture(t,[{items:[message()],has_more:true}]);await assert.rejects(f.read(),{code:'private_chat_incomplete'});assert.equal(f.count.readPages,1);
});
test('control: repeated cursor rejects before requesting a third page',async t=>{
 const f=await fixture(t,[{items:[message()],has_more:true,page_token:'repeat'},{items:[message('om_fixture_2')],has_more:true,page_token:'repeat'}]);
 await assert.rejects(f.read(),{code:'private_chat_incomplete'});assert.equal(f.count.readPages,2);
});
test('control: 100-page cap rejects without returning a partial complete result',async t=>{
 const f=await fixture(t,index=>({items:[message('om_fixture_'+index)],has_more:true,page_token:'cursor_'+index}));
 await assert.rejects(f.read(),{code:'private_chat_incomplete'});assert.equal(f.count.readPages,100);
});
test('control: exact old 120-day span predicate does not silently become a source-age policy',async t=>{
 const f=await fixture(t,[validPage()]);const result=await f.read({startTime:1000,endTime:1060});assert.equal(result.complete,true);assert.equal(f.count.readPages,1);
});
test('control: requested span over120days and end after now+60 fail before any additional provider read',async t=>{
 const f=await fixture(t),before={...f.count};await assert.rejects(f.read({startTime:1000,endTime:1000+120*86400+1}),{code:'private_chat_range_invalid'});
 await assert.rejects(f.read({startTime:nowSec,endTime:nowSec+61}),{code:'private_chat_range_invalid'});assert.deepEqual(f.count,before);
});
test('control: actual wrong chat and user outside fixed pair already reject',async t=>{
 for(const item of [message('om_wrong_chat',{chat_id:'oc_other'}),message('om_wrong_user',{sender:{sender_type:'user',id_type:'open_id',id:'ou_outside'}})]){
  const f=await fixture(t,[validPage([item])]);await assert.rejects(f.read(),{code:'private_chat_pair_unverified'});
 }
});

for(const [label,alter]of [['missing',{}],['null',{has_more:null}],['numeric zero',{has_more:0}],['empty string',{has_more:''}]])test('P1 terminal has_more '+label+' is unknown, not a complete source',async t=>{
 const f=await fixture(t,[{items:[message()],...alter}]);await mustNotClaimComplete(f);
});
for(const [label,has_more]of [['numeric true',1],['string false','false'],['object',{}]])test('P1 nonboolean has_more '+label+' cannot become complete by a later page',async t=>{
 const f=await fixture(t,[{items:[message()],has_more,page_token:'cursor'},validPage([message('om_fixture_2')])]);await mustNotClaimComplete(f);
});
for(const [label,page_token]of [['object',{cursor:'toy'}],['array',['cursor']],['number',123],['whitespace','  ']])test('P1 cursor '+label+' must not be coerced into a verified paging chain',async t=>{
 const f=await fixture(t,[{items:[message()],has_more:true,page_token},validPage([message('om_fixture_2')])]);await mustNotClaimComplete(f);
});
for(const [label,id]of [['missing',undefined],['empty',''],['number',123],['object',{id:'toy'}]])test('P1 message ID '+label+' cannot be used as a complete-source identity key',async t=>{
 const first=message(),second=message('om_fixture_2',{body:{content:'{"text":"second fictional record"}'}});
 if(id===undefined){delete first.message_id;delete second.message_id;}else{first.message_id=id;second.message_id=id;}
 const f=await fixture(t,[validPage([first,second])]);await mustNotClaimComplete(f);
});
test('P1 same message ID with conflicting content across pages is pending, not first-version complete',async t=>{
 const f=await fixture(t,[{items:[message()],has_more:true,page_token:'cursor'},validPage([message('om_fixture_1',{body:{content:'{"text":"later contradictory record"}'}})])]);await mustNotClaimComplete(f);
});
for(const [label,sender]of [['missing',undefined],['app third identity',{sender_type:'app',id:'cli_outside'}],['missing type',{id:'ou_outside'}]])test('P1 sender '+label+' is not verified fixed-person assessment evidence',async t=>{
 const f=await fixture(t,[validPage([message('om_fixture_1',{sender})])]);await mustNotClaimComplete(f);
});
test('SOURCE-CONTRACT missing peer field lacks separately verified P2P response schema evidence',async t=>{
 const f=await fixture(t,[validPage([message()])],{pairMissingPeer:true});await mustNotClaimComplete(f,{pairEarly:true});
});
// Parent supplied the complete primary list.md snapshot; it explicitly defines create_time string milliseconds.
// Strict in-window corroboration is our fail-closed assessment-source contract; no 120-day start-age rule is added.
for(const [label,create_time]of [['missing',undefined],['invalid','not-a-time'],['before request',String((start-100)*1000)],['after request',String((end+100)*1000)]])test('SOURCE-CONTRACT time '+label+' cannot be certified by an unchecked query alone',async t=>{
 const f=await fixture(t,[validPage([message('om_fixture_1',{create_time})])]);await mustNotClaimComplete(f);
});
test('P1 user sender with app_id namespace cannot be certified as one of two open_id identities',async t=>{
 const f=await fixture(t,[validPage([message('om_fixture_1',{sender:{sender_type:'user',id_type:'app_id',id:owner}})])]);await mustNotClaimComplete(f);
});
test('P1 chat-root thread does not prove complete discussion when no thread reader is called',async t=>{
 const f=await fixture(t,[validPage([message('om_fixture_1',{thread_id:'omt_fixture_thread'})])]);await mustNotClaimComplete(f);assert.equal(f.count.readPages,1);
});
