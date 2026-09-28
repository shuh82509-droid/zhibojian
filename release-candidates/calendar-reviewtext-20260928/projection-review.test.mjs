import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {projectRecruitmentMessageContent as project,inspectRecruitmentContent as inspect,inspectReviewText as review,inspectSubmissionSlots as slots} from './recruitment-content.mjs';
import {parseRecruitmentMessages} from './lifecycle-engine.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const metadata = {messageId:'om_fixture_main',chatId:'oc_fixture_recruitment',type:'post',sender:{id:'ou_fixture_reviewer'},createdAt:'2026-09-28T08:00:00.000Z',updatedAt:'2026-09-28T08:00:00.000Z'};
const rawPost = lines => JSON.stringify({zh_cn:{title:'',content:lines.map(text => [{tag:'text',text}])}});
const message = (lines, extra={}) => ({...metadata,...project(rawPost(lines),'post'),...extra});
const validLines = ['面试结果','测试甲','颜值：8 表现力：7','结果：通过'];
const template = name => `求职者【${name}】是否符合【主播】的邀约标准`;

test('raw exact bytes/full versioned projection fingerprint, split nodes, no dedupe', () => {
  const raw = JSON.stringify({zh_cn:{title:'面试结果',content:[[{tag:'text',text:'测试',style:['bold']},{tag:'text',text:'甲'}],[{tag:'plain_text',text:'颜值：8 表现力：7'}],[{tag:'text',text:'结果：通过'}]]}});
  const value = {...metadata,...project(raw,'post')};
  assert.equal(value.reviewText,validLines.join('\n'));
  assert.equal(value.contentFingerprint,sha(raw));
  assert.equal(value.reviewTextFingerprint,sha(`feishu-textonly-v1\n${value.reviewText}`));
  assert.equal(review(value,'测试甲').passed,true);
  const duplicate = message([...validLines.slice(0,2),'测试甲',...validLines.slice(2)]);
  assert.equal(duplicate.reviewText.split('\n').filter(line => line==='测试甲').length,2);
  assert.equal(review(duplicate,'测试甲').status,'pending');
  assert.notEqual(project(`${raw} `,'post').contentFingerprint,value.contentFingerprint);
});

for (const outcome of ['通过','不通过','未通过']) test(`explicit syntax only ${outcome}`, () => {
  const value = message(['测试甲','表现力:7','颜值:8',`结果:${outcome}`]);
  assert.equal(review(value,'测试甲').status,'text_ready');
  assert.equal(review(value,'测试甲').passed,outcome==='通过');
  assert.deepEqual(review(value,'测试甲').scores,{'表现力':7,'颜值':8});
});
for (const outcome of ['没有通过','尚未通过','不是不通过','通过？','可以通过吗','如果通过','暂定通过','已淘汰','通过']) test(`ambiguous outcome ${outcome}`, () => {
  assert.equal(review(message([...validLines.slice(0,-1),outcome]),'测试甲').passed,null);
});
for (const lines of [
  ['面试结果','测试甲','颜值:8','结果:通过'],
  [...validLines.slice(0,-1),'测试乙：不通过','结果:通过'],
  [...validLines.slice(0,-1),'未知甲','颜值:9 表现力:9','结果:通过'],
  [...validLines,'之后另议'],
  [...validLines.slice(0,-1),'结果:通过','结果:通过'],
  ['面试结果','测试甲','颜值:8 颜值:9 表现力:7','结果:通过'],
  ['面试结果','测试甲','颜值:8表现力:7','结果:通过'],
  ['面试结果','测试甲','颜值:8, 表现力:7,','结果:通过'],
  ['面试结果','测试甲','颜值:Infinity 表现力:7','结果:通过'],
]) test(`closed grammar rejects ${JSON.stringify(lines)}`, () => assert.equal(review(message(lines),'测试甲').status,'pending'));

for (const tag of ['img','at','a','media','unknown','file','video']) test(`resource node ${tag} blocked`, () => {
  const raw = JSON.stringify({content:[...validLines.map(text => [{tag:'text',text}]),[{tag,text:''}]]});
  const value = {...metadata,...project(raw,'post')};
  assert.equal(value.hasMediaOrResource,true); assert.equal(review(value,'测试甲').passed,null);
});
for (const style of [['lineThrough'],['italic'],['underline'],['bold','lineThrough'],['unknown'],'bold']) test(`unsupported style ${JSON.stringify(style)}`, () => {
  const raw = JSON.stringify({content:validLines.map(text => [{tag:'text',text,style}])});
  const value = {...metadata,...project(raw,'post')};
  assert.equal(value.unsupportedStyle,true); assert.equal(review(value,'测试甲').status,'pending');
});
for (const raw of ['{broken',JSON.stringify({text:'测试甲',extra:'hidden'}),JSON.stringify({zh_cn:{content:[]},en_us:{content:[]}}),JSON.stringify({title:'测试甲',content:[{tag:'text',text:'invalid row'}]}),JSON.stringify({content:[[{tag:'text',text:123}]]})]) test(`invalid raw shape ${raw}`, () => {
  assert.equal(inspect({...metadata,...project(raw,'post')}).status,'pending');
});
test('limit and full resource count precede display truncation', () => {
  const full = `${validLines.join('\n')}\n${'文'.repeat(8100)}\n${template('测试乙')}`;
  const value = message([full]);
  assert.equal(value.reviewText.length,8000); assert.equal(value.reviewTextTruncated,true);
  assert.equal(value.reviewTextFingerprint,sha(`feishu-textonly-v1\n${full}`));
  assert.equal(slots(value).visibleSlotCount,1); assert.equal(slots(value).status,'pending');
  const raw = JSON.stringify({content:Array.from({length:21},(_,index) => [{tag:'img',image_key:`fixture_${index}`}])});
  const media = project(raw,'post'); assert.equal(media.resources.length,20); assert.equal(media.resourceCount,21); assert.equal(media.hasMediaOrResource,true);
  assert.deepEqual(media.resources[0],{type:'image',key:'fixture_0'});
});
for (const name of ['Alice','','测试乙','测试甲']) test(`complete slot ${name || 'empty'}`, () => {
  const value = message([template('测试甲'),template(name)]), result = slots(value);
  assert.equal(result.visibleSlotCount,2); assert.equal(result.parsedCompleteSlotCount,2);
  assert.equal(result.status,['测试乙','测试甲'].includes(name) ? 'complete' : 'pending');
  assert.ok(result.names.includes('测试甲'));
});
for (const suffix of ['求职者【测试乙','求职者【】','求职者Alice','求\u202a职者【测试乙','求\u2066职者【Alice】是否符合【主播】的邀约标准','求 职 者【测试乙】是否符合【主播】的邀约标准']) test(`partial/normalized marker ${suffix}`, () => {
  const result = slots(message([template('测试甲'),suffix]));
  assert.equal(result.status,'pending'); assert.equal(result.visibleSlotCount,2); assert.deepEqual(result.names,['测试甲']);
});
test('full slot consumed across bold node boundaries with exact spans', () => {
  const text = template('测试甲');
  const raw = JSON.stringify({content:[[{tag:'text',text:'求职',style:['bold']},{tag:'text',text:text.slice(2)}]]});
  const result = slots({...metadata,...project(raw,'post')});
  assert.equal(result.status,'complete'); assert.deepEqual(result.spans,[{start:0,end:text.length,name:'测试甲',complete:true,identityValid:true}]);
});
for (const change of [{reviewContentContractVersion:undefined},{parseError:'false'},{contentShapeVerified:1},{reviewTextTruncated:undefined},{textTruncated:undefined},{hasMediaOrResource:undefined},{unsupportedStyle:undefined},{resourceCount:undefined},{text:'UI fallback'},{messageId:''},{chatId:''},{sender:{id:''}},{createdAt:'2026-02-30T08:00:00.000Z'},{updatedAt:null},{updatedAt:'2026-09-27T08:00:00.000Z'},{deleted:true},{isDeleted:true},{recalled:true},{reviewTextFingerprint:'a'.repeat(64)}]) test(`old/invalid projection ${JSON.stringify(change)}`, () => assert.equal(inspect(message(validLines,change)).status,'pending'));
test('text is content-readable but not a post review and no fallback is accepted', () => {
  const value = {...metadata,type:'text',...project(JSON.stringify({text:validLines.join('\n')}),'text')};
  assert.equal(inspect(value).status,'text_ready'); assert.equal(review(value,'测试甲').status,'pending');
  assert.equal(inspect({...metadata,text:validLines.join('\n')}).status,'pending');
});

const server = readFileSync(new URL('./server.js',import.meta.url),'utf8');
const getChatSource = server.slice(server.indexOf('async function getChatMessages('),server.indexOf('\nasync function findChatByName('));
const uiSource = server.slice(server.indexOf('function parseMessageContent('),server.indexOf('async function getChatMessages('));
async function readThroughServer(sourceKey,rawItems,cache=new Map()) {
  let fetches=0, cacheCalls=0; const reactionIds=[];
  const context = {URLSearchParams,Date,projectRecruitmentMessageContent:project,feishuCache:cache,
    feishuChats:{recruitment:{chatId:'oc_fixture_recruitment',name:'fixture'},coaching:{chatId:'oc_fixture_coaching',name:'fixture'}},
    FeishuError:class extends Error {},activeChatMessages:items=>items.filter(item=>item?.deleted!==true),
    feishuGet:async()=>{fetches+=1;return {items:rawItems,has_more:false}},
    getMessageReactions:async ids=>{reactionIds.push(...ids);return new Map()},
    cached:async(key,ttl,load)=>{cacheCalls+=1; if(cache.has(key))return cache.get(key).value;const value=await load();cache.set(key,{value});return value;}};
  vm.createContext(context);vm.runInContext(`${uiSource}\n${getChatSource}\nthis.run=getChatMessages`,context);
  const first=await context.run(sourceKey,20), second=await context.run(sourceKey,20,{fresh:true});
  return {first,second,fetches,cacheCalls,cache,reactionIds};
}
const apiItem = extra => ({message_id:'om_fixture_api',chat_id:'oc_fixture_recruitment',msg_type:'post',body:{content:rawPost(validLines)},sender:{id:'ou_fixture_reviewer'},create_time:String(Date.parse(metadata.createdAt)),update_time:String(Date.parse(metadata.updatedAt)),...extra});
test('actual recruitment server path invokes full pure projector and never caches bodies', async()=>{
  const cache=new Map([['chat:recruitment:20:0:0',{value:{messages:[{text:'legacy cached green'}]}}]]), result=await readThroughServer('recruitment',[apiItem()],cache);
  assert.equal(result.fetches,2);assert.equal(result.cacheCalls,0);assert.equal(cache.size,1);
  assert.equal(inspect(result.first.messages[0]).status,'text_ready');assert.equal(review(result.first.messages[0],'测试甲').passed,true);
  assert.equal(cache.get('chat:recruitment:20:0:0').value.messages[0].text,'legacy cached green');
});
for (const flag of ['deleted','is_deleted','isDeleted','recalled','is_recalled']) test(`raw API tombstone retained ${flag}`,async()=>{
  const result=await readThroughServer('recruitment',[apiItem({[flag]:true})]);
  assert.equal(result.first.messages.length,1);assert.equal(result.first.deletedMessageCount,1);assert.deepEqual(result.reactionIds,[]);
  assert.equal(result.first.messages[0].deleted,true);assert.equal(result.first.messages[0].isDeleted,true);assert.equal(result.first.messages[0].recalled,true);
  assert.equal(inspect(result.first.messages[0]).status,'pending');
});
test('nonrecruitment old display/cache/filter behavior remains separate',async()=>{
  const result=await readThroughServer('coaching',[apiItem(),apiItem({message_id:'om_fixture_deleted',deleted:true})]);
  assert.equal(result.cacheCalls,1);assert.equal(result.first.messages.length,1);
  assert.equal(result.first.messages[0].reviewContentContractVersion,undefined);assert.equal(result.cache.size,1);
});
test('recruitment invalid raw API timestamp becomes pending without throwing',async()=>{
  const result=await readThroughServer('recruitment',[apiItem({create_time:'invalid'})]);
  assert.equal(result.first.messages[0].createdAt,null);assert.equal(inspect(result.first.messages[0]).status,'pending');
});
test('server scope: exact base bytes outside import/getChatMessages/four binding guard lines',()=>{
  const base=readFileSync(new URL('./server.base.js',import.meta.url),'utf8');
  assert.equal(sha(base),'e345f9f11ff3bd14bd6417b011e9bc584dbcb676efd2acc82d162c0257adc39c');
  let reverted=server.replace("import {projectRecruitmentMessageContent} from './recruitment-content.mjs';\n",'');
  const oldStart=base.indexOf('async function getChatMessages('),oldEnd=base.indexOf('\nasync function findChatByName(');
  const newStart=reverted.indexOf('async function getChatMessages('),newEnd=reverted.indexOf('\nasync function findChatByName(');
  reverted=reverted.slice(0,newStart)+base.slice(oldStart,oldEnd)+reverted.slice(newEnd);
  const changes=[
    ["advanceStage:parsed.reviewBindingVerified===true && Boolean(recruitmentReviewerOpenId)","advanceStage:Boolean(recruitmentReviewerOpenId)",2],
    ["status: parsed.reviewBindingVerified===true && recruitmentReviewerOpenId","status: recruitmentReviewerOpenId",1],
    ["status:parsed.reviewBindingVerified===true && recruitmentReviewerOpenId","status:recruitmentReviewerOpenId",1],
  ];
  for(const [from,to,count] of changes){assert.equal(reverted.split(from).length-1,count);reverted=reverted.split(from).join(to);}
  assert.equal(reverted,base);
});
test('actual raw API->server projection->engine: later tombstone invalidates provisional review',async()=>{
  const submission=apiItem({message_id:'om_fixture_submission',body:{content:rawPost([template('测试甲')])},sender:{id:'ou_fixture_submitter'}});
  const valid=apiItem({message_id:'om_fixture_review',create_time:String(Date.parse('2026-09-28T08:01:00.000Z')),update_time:String(Date.parse('2026-09-28T08:01:00.000Z'))});
  const later=apiItem({message_id:'om_fixture_recalled',is_recalled:true,body:{content:'unavailable'},create_time:String(Date.parse('2026-09-28T08:02:00.000Z')),update_time:String(Date.parse('2026-09-28T08:02:00.000Z'))});
  const result=await readThroughServer('recruitment',[submission,valid,later]);
  result.first.messages[0].reactions={details:[{emojiType:'OK',operatorId:'ou_fixture_reviewer'}]};
  const parsed=parseRecruitmentMessages(result.first.messages,{reviewerOpenId:'ou_fixture_reviewer'}),candidate=parsed.candidates.find(item=>item.name==='测试甲');
  assert.equal(candidate.reviewTextStatus,'pending');assert.equal(candidate.reviewPendingReason,'later_review_opaque');
  assert.deepEqual(candidate.reviewSourceIds,['om_fixture_review','om_fixture_recalled']);assert.equal(candidate.evaluationEvidence.passed,null);
  assert.equal(parsed.reviewBindingVerified,false);assert.equal(parsed.funnel.groupPassedCount,null);
});
test('actual raw API->server projection->engine: complete review stays clue only',async()=>{
  const submission=apiItem({message_id:'om_fixture_submission',body:{content:rawPost([template('测试甲')])},sender:{id:'ou_fixture_submitter'}});
  const valid=apiItem({message_id:'om_fixture_review',create_time:String(Date.parse('2026-09-28T08:01:00.000Z')),update_time:String(Date.parse('2026-09-28T08:01:00.000Z'))});
  const result=await readThroughServer('recruitment',[submission,valid]);
  result.first.messages[0].reactions={details:[{emojiType:'OK',operatorId:'ou_fixture_reviewer'}]};
  const parsed=parseRecruitmentMessages(result.first.messages,{reviewerOpenId:'ou_fixture_reviewer'}),candidate=parsed.candidates.find(item=>item.name==='测试甲');
  assert.equal(candidate.stage,'initial_pass');assert.equal(candidate.reviewTextStatus,'text_ready');assert.equal(candidate.evaluationEvidence.textOutcome,true);
  assert.equal(candidate.evaluationEvidence.passed,null);assert.equal(parsed.reviewBindingVerified,false);assert.equal(parsed.funnel.groupPassedCount,null);
});
