// Source-only tests. All identities, grants and messages are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCipheriv,createHash} from 'node:crypto';
const selected=process.env.WIS_PRIVATE_READER_MODULE, pin=process.env.WIS_PRIVATE_READER_SHA;
assert.ok(selected&&pin,'exact source selector and SHA required');
assert.match(pin,/^[a-f0-9]{64}$/u);
assert.equal(createHash('sha256').update(readFileSync(selected)).digest('hex'),pin);
const {createPrivateChatReader,requiredScopes}=await import(pathToFileURL(resolve(selected)).href);
const NOW=1_700_000_000_000,owner='ou_fixture_owner',peer='ou_fixture_peer',chat='oc_fixturePair';
const range={startTime:1_699_999_940,endTime:1_700_000_000};
const message=(id='om_fixture1',ms=NOW-1000)=>({message_id:id,chat_id:chat,
  sender:{id:owner,id_type:'open_id',sender_type:'user'},msg_type:'text',
  create_time:String(ms),deleted:false,updated:false,body:{content:'{"text":"toy conclusion only"}'}});
const page=(items=[],has_more=false,page_token)=>({items,has_more,...(page_token===undefined?{}:{page_token})});
async function fixture(t,pages,{pair={p2p_chats:[{chat_id:chat,chatter_id:peer}]}}={}) {
  const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'wis-private-completeness-'));
  t.after(async()=>{const target=resolve(directory);assert.ok(target.startsWith(base+sep)&&basename(target).startsWith('wis-private-completeness-'));
    assert.equal((await lstat(target)).isDirectory(),true);await rm(target,{recursive:true,force:true});});
  const store=join(directory,'toy.enc'),key=Buffer.alloc(32,9),appId='cli_fixture';
  const aad=Buffer.from(JSON.stringify(['private-chat-v1',appId,owner,peer,requiredScopes]));
  const cipher=createCipheriv('aes-256-gcm',key,Buffer.alloc(12,8));cipher.setAAD(aad);
  const record={openId:owner,accessToken:'toy-cached-access',refreshToken:'toy-refresh',
    accessExpiresAt:NOW+3_600_000,refreshExpiresAt:NOW+86_400_000,scopes:requiredScopes.join(' ')};
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(record),'utf8'),cipher.final()]);
  await writeFile(store,JSON.stringify({version:2,iv:Buffer.alloc(12,8).toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')}),{flag:'wx',mode:0o600});
  const original=await readFile(store),calls=[],queries=[];let next=0;
  const reader=createPrivateChatReader({appId,appSecret:'toy-secret',expectedOpenId:owner,peerOpenId:peer,
    ownerLabel:'Fixture Owner',redirectUri:'https://fixture.invalid/callback',storePath:store,
    encryptionKey:key.toString('base64'),now:()=>NOW,fetchImpl:async(url,options)=>{
      calls.push({url,method:options.method});assert.equal(options.redirect,'error');
      assert.equal(options.headers.Authorization,'Bearer toy-cached-access');
      if(url.startsWith('https://open.feishu.cn/open-apis/im/v1/chat_p2p/batch_query?')){
        assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{chatter_ids:[peer]});
        return {ok:true,json:async()=>({code:0,data:pair})};
      }
      assert.ok(url.startsWith('https://open.feishu.cn/open-apis/im/v1/messages?'),'NO_REAL_PROVIDER_OR_OAUTH_ALLOWED');
      assert.equal(options.method,'GET');const query=new URL(url).searchParams;queries.push(Object.fromEntries(query));
      assert.equal(query.get('container_id'),chat);assert.equal(query.get('container_id_type'),'chat');
      assert.equal(query.get('page_size'),'50');assert.equal(query.get('sort_type'),'ByCreateTimeAsc');
      assert.equal(query.get('start_time'),String(range.startTime));assert.equal(query.get('end_time'),String(range.endTime));
      const value=pages[next++];if(value instanceof Error)throw value;
      return {ok:true,json:async()=>({code:0,data:value})};
    }});
  async function unchanged(){assert.deepEqual(await readFile(store),original);assert.equal((await reader.status()).authorized,true);
    await assert.rejects(lstat(store+'.lock'),{code:'ENOENT'});
    await assert.rejects(lstat(store+'.refresh-intent.json'),{code:'ENOENT'});
    await assert.rejects(lstat(store+'.code-intent.json'),{code:'ENOENT'});
    assert.equal(calls.some(c=>c.url.includes('/oauth/token')),false);}
  return {reader,calls,queries,read:()=>reader.readMessages(range),unchanged};
}
test('valid empty terminal page is complete without inventing a conclusion',async t=>{
  const f=await fixture(t,[page()]);assert.deepEqual(await f.read(),{items:[],complete:true});await f.unchanged();
});
test('two pages retain raw fixed-person messages and opaque cursor exactly',async t=>{
  const first=message(),second=message('om_fixture2',NOW),cursor='opaque+/= %';
  const f=await fixture(t,[page([first],true,cursor),page([second])]);
  assert.deepEqual(await f.read(),{items:[first,second],complete:true});assert.equal(f.queries[0].page_token,undefined);
  assert.equal(f.queries[1].page_token,cursor);await f.unchanged();
});
test('identical overlap deduplicates even if JSON object keys reorder',async t=>{
  const first=message(),copy=Object.fromEntries(Object.entries(first).reverse()),last=message('om_fixture2',NOW);
  copy.sender=Object.fromEntries(Object.entries(first.sender).reverse());
  const f=await fixture(t,[page([first],true,'next'),page([copy,last])]);
  assert.deepEqual(await f.read(),{items:[first,last],complete:true});await f.unchanged();
});
for(const [label,value] of [['missing',undefined],['null',null],['zero',0],['one',1],['string false','false'],['string true','true'],['array',[]],['object',{}]])
  test('reject non-boolean has_more '+label,async t=>{const source={items:[message()]};if(value!==undefined)source.has_more=value;
    const f=await fixture(t,[source]);await assert.rejects(f.read(),{code:'private_chat_incomplete'});assert.equal(f.queries.length,1);await f.unchanged();});
for(const [label,value] of [['missing',undefined],['null',null],['number',7],['array',[]],['object',{}],['empty',''],['newline','next\n']])
  test('reject unusable next cursor '+label,async t=>{const f=await fixture(t,[page([message()],true,value)]);
    await assert.rejects(f.read(),{code:'private_chat_incomplete'});assert.equal(f.queries.length,1);await f.unchanged();});
test('repeated opaque cursor fails before a third page',async t=>{const f=await fixture(t,[page([],true,'loop'),page([],true,'loop')]);
  await assert.rejects(f.read(),{code:'private_chat_incomplete'});assert.equal(f.queries.length,2);await f.unchanged();});
test('terminal empty cursor remains compatible',async t=>{const f=await fixture(t,[page([message()],false,'')]);assert.equal((await f.read()).complete,true);await f.unchanged();});
for(const cursor of ['unexpected',null,1])test('terminal cursor must not contradict terminal state '+String(cursor),async t=>{
  const f=await fixture(t,[page([],false,cursor)]);await assert.rejects(f.read(),{code:'private_chat_incomplete'});await f.unchanged();});
const malformed=[
 ['missing message ID',m=>{delete m.message_id;}],['nonstring message ID',m=>{m.message_id=7;}],['empty message ID',m=>{m.message_id='';}],
 ['wrong message ID prefix',m=>{m.message_id='oc_fixture';}],['missing creation time',m=>{delete m.create_time;}],
 ['numeric creation time',m=>{m.create_time=NOW;}],['seconds not ms',m=>{m.create_time='1700000000';}],
 ['nonnumeric creation time',m=>{m.create_time='secret-invalid';}],['unsafe ms',m=>{m.create_time='9007199254740992';}],
 ['missing deleted flag',m=>{delete m.deleted;}],['string updated flag',m=>{m.updated='false';}],
 ['missing body',m=>{delete m.body;}],['nonstring content',m=>{m.body.content={text:'toy'};}],['missing type',m=>{delete m.msg_type;}]
];
for(const [label,mutate] of malformed)test('reject malformed record '+label,async t=>{const m=message();mutate(m);const f=await fixture(t,[page([m])]);
  await assert.rejects(f.read(),{code:'private_chat_incomplete'});await f.unchanged();});
for(const [label,mutate] of [
 ['missing sender',m=>{delete m.sender;}],['app sender',m=>{m.sender.sender_type='app';}],
 ['anonymous sender',m=>{m.sender.sender_type='anonymous';}],['unknown sender',m=>{m.sender.sender_type='unknown';}],
 ['wrong ID type',m=>{m.sender.id_type='app_id';}],['missing ID type',m=>{delete m.sender.id_type;}],
 ['outside participant',m=>{m.sender.id='ou_other';}],['wrong chat',m=>{m.chat_id='oc_other';}]
])test('unverified participant blocks this source window '+label,async t=>{const m=message();mutate(m);const f=await fixture(t,[page([m])]);
  await assert.rejects(f.read(),{code:'private_chat_pair_unverified'});await f.unchanged();});
test('missing peer echo cannot establish fixed pair',async t=>{const f=await fixture(t,[],{pair:{p2p_chats:[{chat_id:chat}]}});
  await assert.rejects(f.read(),{code:'private_chat_pair_unverified'});assert.equal(f.queries.length,0);await f.unchanged();});
test('non-record item fails without returning a partial prefix',async t=>{const f=await fixture(t,[page([message(),null])]);
  await assert.rejects(f.read(),{code:'private_chat_pair_unverified'});await f.unchanged();});
for(const [label,ms] of [['start boundary',range.startTime*1000],['last final millisecond',(range.endTime+1)*1000-1]])
 test('accept ms '+label,async t=>{const f=await fixture(t,[page([message('om_edge',ms)])]);assert.equal((await f.read()).complete,true);await f.unchanged();});
for(const [label,ms] of [['before requested start',range.startTime*1000-1],['after requested final second',(range.endTime+1)*1000]])
 test('reject ms '+label,async t=>{const f=await fixture(t,[page([message('om_edge',ms)])]);await assert.rejects(f.read(),{code:'private_chat_incomplete'});await f.unchanged();});
for(const [label,mutate] of [
 ['content edited',m=>{m.body.content='{"text":"different toy conclusion"}';}],['sender changed',m=>{m.sender.id=peer;}],
 ['recalled later',m=>{m.deleted=true;}],['timestamp changed',m=>{m.create_time=String(NOW);}],
 ['new unknown field',m=>{m.extra='changed';}]
])test('conflicting duplicate ID blocks complete '+label,async t=>{const a=message(),b=structuredClone(a);mutate(b);
 const f=await fixture(t,[page([a],true,'next'),page([b])]);await assert.rejects(f.read(),{code:'private_chat_incomplete'});await f.unchanged();});
test('descending new message time blocks complete across pages',async t=>{const f=await fixture(t,[page([message('om_late',NOW)],true,'next'),page([message()])]);
 await assert.rejects(f.read(),{code:'private_chat_incomplete'});await f.unchanged();});
for(const id of ['omt_fixture',null,0])test('thread root does not prove complete discussion '+String(id),async t=>{const m=message();m.thread_id=id;
 const f=await fixture(t,[page([m])]);await assert.rejects(f.read(),{code:'private_chat_incomplete'});assert.equal(f.queries.length,1);await f.unchanged();});
test('empty optional thread marker is compatible',async t=>{const m=message();m.thread_id='';const f=await fixture(t,[page([m])]);assert.equal((await f.read()).complete,true);await f.unchanged();});
test('page size overflow cannot become complete',async t=>{const f=await fixture(t,[page(Array.from({length:51},(_,i)=>message('om_fixture'+i)))]);
 await assert.rejects(f.read(),{code:'private_chat_incomplete'});await f.unchanged();});
test('100-page cap is bounded and fails without partial data',async t=>{const f=await fixture(t,Array.from({length:100},(_,i)=>page([],true,'cursor'+i)));
 await assert.rejects(f.read(),{code:'private_chat_incomplete'});assert.equal(f.queries.length,100);await f.unchanged();});
test('second page fetch error does not return the valid prefix or mutate grant',async t=>{const f=await fixture(t,[page([message()],true,'next'),Error('toy-secret-raw-error')]);
 await assert.rejects(f.read(),e=>e.code==='private_chat_unavailable'&&!e.message.includes('toy-secret'));await f.unchanged();});
