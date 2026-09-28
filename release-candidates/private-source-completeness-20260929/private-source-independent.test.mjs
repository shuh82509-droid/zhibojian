import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createCipheriv,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Only a toy encrypted grant in a unique os.tmpdir is used. Provider is stubbed;
// no OAuth exchange, real credential, native API, server or remote action.
const defaultPin='0940c0b81b4ae7d17e73962eda36b5b527f86de7211314ea6c68901d304f5272';
const explicitPath=process.env.WIS_PRIVATE_SOURCE_MODULE,explicitPin=process.env.WIS_PRIVATE_SOURCE_SHA;
if(Boolean(explicitPath)!==Boolean(explicitPin))throw new Error('path and SHA must be paired');
const modulePath=explicitPath||fileURLToPath(new URL('../private-source-completeness-20260929-0345/candidate/private-chat-reader.mjs',import.meta.url));
const expectedPin=explicitPin||defaultPin;
if(!/^[a-f0-9]{64}$/u.test(expectedPin))throw new Error('invalid module SHA');
const source=readFileSync(modulePath),actualPin=createHash('sha256').update(source).digest('hex');
if(actualPin!==expectedPin)throw new Error('source pin mismatch');
const {createPrivateChatReader,requiredScopes}=await import('data:text/javascript;base64,'+source.toString('base64'));
const NOW=1780000000123,END=Math.floor(NOW/1000)-100,START=END-60,CHAT='oc_ToyPair',USER='ou_ToyOwner',PEER='ou_ToyPeer';
const secret='SYNTHETIC_BODY_SECRET_NOT_REAL';
const message=(id='om_ToyA',time=START*1000,patch={})=>({message_id:id,chat_id:CHAT,sender:{id:USER,id_type:'open_id',sender_type:'user',tenant_key:'toyTenant'},create_time:String(time),update_time:String(time),deleted:false,updated:false,msg_type:'text',body:{content:JSON.stringify({text:'合成测试正文，不是真实私聊'})},...patch});
const response=(data,ok=true,code=0)=>({ok,async json(){return JSON.parse(JSON.stringify({code,msg:'toy-only',data}));}});
const terminal=(items=[])=>({items,has_more:false});
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
async function fixture(t,pages=[terminal()],options={}){
  const tempPrefix=join(tmpdir(),'wis-private-source-fixture-'),directory=await mkdtemp(tempPrefix),storePath=join(directory,'toy-grant.enc');
  t.after(async()=>{const absolute=resolve(directory);if(!absolute.startsWith(resolve(tempPrefix)))throw new Error('invalid temporary cleanup scope');await rm(absolute,{recursive:true,force:true});});
  const key=Buffer.alloc(32,0x37),appId='toy_app';
  const context=Buffer.from(JSON.stringify(['private-chat-v1',appId,USER,PEER,requiredScopes]));
  const grant={openId:USER,accessToken:'toyAccessNoRealCredential',refreshToken:'toyRefreshNoRealCredential',accessExpiresAt:NOW+86400000,refreshExpiresAt:NOW+864000000,scopes:requiredScopes.join(' ')};
  const iv=Buffer.alloc(12,0x42),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(context);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(grant),'utf8'),cipher.final()]);
  await writeFile(storePath,JSON.stringify({version:2,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}),{mode:0o600});
  const originalGrant=await readFile(storePath),ctx={pages,requests:[],pageCalls:0,pairCalls:0,tokenPosts:0,at:NOW,found:{p2p_chats:[{chat_id:CHAT,chatter_id:PEER}]}};
  const reader=createPrivateChatReader({appId,appSecret:'toyAppSecretNoRealCredential',expectedOpenId:USER,peerOpenId:PEER,ownerLabel:'合成测试本人',redirectUri:'https://oa.synthetic.invalid/live/api/lifecycle/calendar-auth/callback',storePath,encryptionKey:key.toString('base64'),now:()=>ctx.at,
    async fetchImpl(input,request){
      const url=new URL(input);ctx.requests.push({url,request});
      if(url.pathname.endsWith('/oauth/token')){ctx.tokenPosts++;throw new Error('no real or synthetic token exchange is expected here');}
      if(url.pathname==='/open-apis/im/v1/chat_p2p/batch_query'){ctx.pairCalls++;if(options.pair)return options.pair(ctx);return response(ctx.found);}
      if(url.pathname==='/open-apis/im/v1/messages'){const index=ctx.pageCalls++;if(options.page)return options.page(index,ctx);if(!ctx.pages[index])throw new Error(secret);return response(ctx.pages[index]);}
      throw new Error('unexpected path');
    }});
  return {ctx,reader,storePath,originalGrant,async read(range={startTime:START,endTime:END}){return reader.readMessages(range);},async unchanged(){assert.deepEqual(await readFile(storePath),originalGrant);assert.equal(ctx.tokenPosts,0);assert.equal((await reader.status()).status,'authorized');await assert.rejects(lstat(storePath+'.lock'),e=>e.code==='ENOENT');}};
}
async function rejects(f,code='private_chat_incomplete',range){let returned;await assert.rejects(async()=>{returned=await f.read(range);},failure=>{assert.equal(failure.code,code);assert.equal(String(failure.message).includes(secret),false);return true;});assert.equal(returned,undefined);assert.equal(f.ctx.requests.some(r=>r.url.searchParams.get('container_id_type')==='thread'),false);await f.unchanged();}

test('full-byte source is pinned before isolated import',()=>assert.equal(actualPin,expectedPin));
test('normal empty terminal proves window only and leaves grant unchanged',async t=>{const f=await fixture(t);assert.deepEqual(await f.read(),{items:[],complete:true});await f.unchanged();});
test('two-page request preserves fixed pair, seconds, sort, size and only advances cursor',async t=>{
  const a=message(),b=message('om_ToyB',START*1000+1,{sender:{id:PEER,id_type:'open_id',sender_type:'user'}});
  const f=await fixture(t,[{items:[a],has_more:true,page_token:'toyCursor1'},terminal([b])]);
  const result=await f.read();assert.equal(result.complete,true);assert.deepEqual(result.items,[a,b]);assert.equal(f.ctx.pageCalls,2);
  const pair=f.ctx.requests[0];assert.equal(pair.url.searchParams.get('chatter_id_type'),'open_id');assert.deepEqual(JSON.parse(pair.request.body),{chatter_ids:[PEER]});
  const [first,second]=f.ctx.requests.slice(1).map(request=>request.url);
  assert.equal(first.searchParams.has('page_token'),false);assert.equal(second.searchParams.get('page_token'),'toyCursor1');
  for(const url of [first,second]){assert.equal(url.pathname,'/open-apis/im/v1/messages');assert.equal(url.searchParams.get('container_id_type'),'chat');assert.equal(url.searchParams.get('container_id'),CHAT);assert.equal(url.searchParams.get('start_time'),String(START));assert.equal(url.searchParams.get('end_time'),String(END));assert.equal(url.searchParams.get('sort_type'),'ByCreateTimeAsc');assert.equal(url.searchParams.get('page_size'),'50');}
  for(const request of f.ctx.requests.slice(1)){assert.equal(request.request.method,'GET');assert.equal(request.request.redirect,'error');assert.equal(request.request.headers.Authorization,'Bearer toyAccessNoRealCredential');}
  await f.unchanged();
});
for(const [label,time]of [['start inclusive',START*1000],['end first millisecond',END*1000],['entire final second',END*1000+999]])test('requested second convention '+label,async t=>{const f=await fixture(t,[terminal([message('om_ToyA',time)])]);assert.equal((await f.read()).complete,true);await f.unchanged();});
for(const [label,time]of [['before start',START*1000-1],['next second',(END+1)*1000]])test('adjacent second must not leak into requested window '+label,async t=>{const f=await fixture(t,[terminal([message('om_ToyA',time)])]);await rejects(f);});
for(const [label,value]of [['seconds mistaken for ms',String(START)],['numeric',START*1000],['leading zero','0'+START*1000],['decimal',String(START*1000)+'.0'],['exponent','1e12'],['negative','-1'],['zero','0'],['overflow','9007199254740993']])test('invalid create_time shape '+label,async t=>{const f=await fixture(t,[terminal([message('om_ToyA',START*1000,{create_time:value})])]);await rejects(f);});
for(const [label,patch,code]of [
  ['app source',{sender:{id:'cli_toy',id_type:'app_id',sender_type:'app'}},'private_chat_pair_unverified'],
  ['anonymous source',{sender:{id:USER,id_type:'open_id',sender_type:'anonymous'}},'private_chat_pair_unverified'],
  ['unknown source',{sender:{id:USER,id_type:'open_id',sender_type:'unknown'}},'private_chat_pair_unverified'],
  ['foreign user',{sender:{id:'ou_other',id_type:'open_id',sender_type:'user'}},'private_chat_pair_unverified'],
  ['user_id not open_id',{sender:{id:USER,id_type:'user_id',sender_type:'user'}},'private_chat_pair_unverified'],
  ['wrong chat',{chat_id:'oc_other'},'private_chat_pair_unverified'],
  ['missing message ID',{message_id:undefined},'private_chat_incomplete'],['bad message ID',{message_id:'om_bad/id'},'private_chat_incomplete'],
  ['missing deleted',{deleted:undefined},'private_chat_incomplete'],['nonbool updated',{updated:'false'},'private_chat_incomplete'],
  ['nonstring content',{body:{content:{text:secret}}},'private_chat_incomplete'],['missing msg_type',{msg_type:undefined},'private_chat_incomplete'],
])test('fixed source/shape failclosed '+label,async t=>{const f=await fixture(t,[terminal([message('om_ToyA',START*1000,patch)])]);await rejects(f,code);});
test('non-user evidence blocks only its window, not future valid window or cached grant',async t=>{const f=await fixture(t,[terminal([message('om_ToyA',START*1000,{sender:{id:'cli_toy',id_type:'app_id',sender_type:'app'}})])]);await rejects(f,'private_chat_pair_unverified');f.ctx.pages.push(terminal([message()]));assert.equal((await f.read()).complete,true);await f.unchanged();});
for(const [label,found]of [['missing chatter',{p2p_chats:[{chat_id:CHAT}]}],['wrong peer',{p2p_chats:[{chat_id:CHAT,chatter_id:USER}]}],['multiple chats',{p2p_chats:[{chat_id:CHAT,chatter_id:PEER},{chat_id:'oc_other',chatter_id:PEER}]}],['wrong ID',{p2p_chats:[{chat_id:'oc_bad-id',chatter_id:PEER}]}]])test('resolve fixed pair cannot use browser or ambiguous IDs '+label,async t=>{const f=await fixture(t);f.ctx.found=found;await rejects(f,'private_chat_pair_unverified');assert.equal(f.ctx.pageCalls,0);});
for(const [label,extra]of [['missing has_more',{}],['string false',{has_more:'false'}],['null has_more',{has_more:null}],['true no token',{has_more:true}],['true empty token',{has_more:true,page_token:''}],['true token number',{has_more:true,page_token:4}],['true token CRLF',{has_more:true,page_token:'toy\r\nCursor'}],['terminal stale cursor',{has_more:false,page_token:'toyCursor'}],['terminal null cursor',{has_more:false,page_token:null}]])test('strict page envelope '+label,async t=>{const f=await fixture(t,[{items:[message()],...extra}]);await rejects(f);assert.equal(f.ctx.pageCalls,1);});
test('empty advancing page remains pending until explicit terminal',async t=>{const f=await fixture(t,[{items:[],has_more:true,page_token:'emptyPage'},terminal([message()])]);assert.equal((await f.read()).items.length,1);assert.equal(f.ctx.pageCalls,2);await f.unchanged();});
test('repeated cursor cannot loop or return earlier partial items',async t=>{const f=await fixture(t,[{items:[message()],has_more:true,page_token:'repeat'},{items:[],has_more:true,page_token:'repeat'}]);await rejects(f);assert.equal(f.ctx.pageCalls,2);});
test('page length over documented 50 cannot be complete',async t=>{const f=await fixture(t,[terminal(Array.from({length:51},(_,i)=>message('om_Toy'+i,START*1000+i)))]);await rejects(f);});
test('100-page ceiling requires terminal within budget',async t=>{const f=await fixture(t,Array.from({length:100},(_,i)=>({items:[],has_more:true,page_token:'cursor'+i})));await rejects(f);assert.equal(f.ctx.pageCalls,100);});
test('100th page explicit terminal is accepted without a 101st request',async t=>{const f=await fixture(t,[...Array.from({length:99},(_,i)=>({items:[],has_more:true,page_token:'cursor'+i})),terminal()]);assert.equal((await f.read()).complete,true);assert.equal(f.ctx.pageCalls,100);await f.unchanged();});
test('identical overlap ID is not duplicated and key order is harmless',async t=>{const a=message(),reordered={body:{content:a.body.content},sender:{tenant_key:'toyTenant',sender_type:'user',id_type:'open_id',id:USER},...Object.fromEntries(Object.entries(a).filter(([key])=>!['body','sender'].includes(key)))};const f=await fixture(t,[{items:[a],has_more:true,page_token:'overlap'},terminal([reordered,message('om_ToyB',START*1000+1)])]);const r=await f.read();assert.equal(r.items.length,2);assert.equal(r.complete,true);await f.unchanged();});
for(const [label,patch]of [['changed body',{body:{content:JSON.stringify({text:secret})}}],['deleted changed',{deleted:true}],['updated changed',{updated:true}],['update_time changed',{update_time:String(START*1000+1)}],['unknown field changed',{extra:{evidence:'different'}}]])test('same ID conflict never silently dedupes '+label,async t=>{const f=await fixture(t,[{items:[message()],has_more:true,page_token:'overlap'},terminal([message('om_ToyA',START*1000,patch)])]);await rejects(f);});
test('new messages out of ascending order cannot be complete',async t=>{const f=await fixture(t,[{items:[message('om_ToyA',START*1000+2)],has_more:true,page_token:'ordered'},terminal([message('om_ToyB',START*1000+1)])]);await rejects(f);});
test('overlap already-seen older ID does not falsely break ascending new IDs',async t=>{const a=message(),b=message('om_ToyB',START*1000+1),c=message('om_ToyC',START*1000+2);const f=await fixture(t,[{items:[a,b],has_more:true,page_token:'overlap'},terminal([a,c])]);assert.equal((await f.read()).items.length,3);await f.unchanged();});
for(const value of ['omt_toy',null,false,{},' '])test('thread root/malformed thread marker cannot imply complete discussion '+JSON.stringify(value),async t=>{const f=await fixture(t,[terminal([message('om_ToyA',START*1000,{thread_id:value})])]);await rejects(f);assert.equal(f.ctx.pageCalls,1);});
test('ordinary reply metadata with no thread marker remains chat-window data only',async t=>{const item=message('om_ToyA',START*1000,{root_id:'om_Root',parent_id:'om_Parent'}),f=await fixture(t,[terminal([item])]);assert.deepEqual((await f.read()).items,[item]);await f.unchanged();});
test('explicit recalled tombstone is preserved, not invented as a passed evaluation',async t=>{const item=message('om_ToyA',START*1000,{deleted:true,body:{content:'This message was recalled'}}),f=await fixture(t,[terminal([item])]);const result=await f.read();assert.equal(result.items[0].deleted,true);assert.equal(Object.hasOwn(result,'passed'),false);await f.unchanged();});
for(const mode of ['throw','reject upstream','bad JSON','missing page data'])test('failure after earlier page cannot return partial complete '+mode,async t=>{const f=await fixture(t,[],{page(index){if(index===0)return response({items:[message()],has_more:true,page_token:'next'});if(mode==='throw')throw new Error(secret);if(mode==='reject upstream')return response({items:[]},false,230027);if(mode==='bad JSON')return {ok:true,async json(){throw new Error(secret);}};return response({});}});await rejects(f,mode==='throw'||mode==='bad JSON'?'private_chat_unavailable':mode==='reject upstream'?'private_chat_access_failed':'private_chat_incomplete');assert.equal(f.ctx.pageCalls,2);});
test('late source page failure does not erase grant or permanently quarantine ordinary GET',async t=>{const f=await fixture(t,[],{page(index){if(index===0)throw new Error(secret);return response(terminal([message()]));}});await rejects(f,'private_chat_unavailable');assert.equal((await f.read()).complete,true);await f.unchanged();});
test('concurrent reader uses store lock instead of interleaving a second pagination',async t=>{const d=defer(),f=await fixture(t,[],{page(){return d.promise;}});const reading=f.read();while(f.ctx.pageCalls===0)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(f.read(),e=>e.code==='private_chat_authorization_busy');assert.equal(f.ctx.pageCalls,1);d.resolve(response(terminal([message()])));assert.equal((await reading).complete,true);await f.unchanged();});
for(const [label,range]of [['noninteger',{startTime:START+0.5,endTime:END}],['numeric string',{startTime:String(START),endTime:END}],['reversed',{startTime:END,endTime:START}],['zero',{startTime:0,endTime:END}],['over120day span',{startTime:END-120*86400-1,endTime:END}],['future beyond60',{startTime:START,endTime:Math.floor(NOW/1000)+61}]])test('invalid requested range makes no provider call '+label,async t=>{const f=await fixture(t);await rejects(f,'private_chat_range_invalid',range);assert.equal(f.ctx.requests.length,0);});

// Minimal cursor counterexamples: no assumed opaque cursor regex. A value made
// entirely of whitespace cannot be an independently verified paging progress.
for(const [label,cursor]of [['ASCII space',' '],['unicode separator','\u2028']])test('whitespace-only paging cursor is pending, not complete '+label,async t=>{const f=await fixture(t,[{items:[message()],has_more:true,page_token:cursor},terminal()]);await rejects(f);assert.equal(f.ctx.pageCalls,1);});
