// Independent group-A attack fixtures. Synthetic memory only; no server/API/state imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';

const DEFAULT='H:/codex输出/直播五环节工作流-20260923/calendar-reviewtext-exact-20260928/candidate-2042';
const modulePath=process.env.WIS_REVIEWTEXT_MODULE || `${DEFAULT}/recruitment-content.mjs`;
const enginePath=process.env.WIS_REVIEWTEXT_ENGINE || `${DEFAULT}/lifecycle-engine.mjs`;
const bytes=path=>readFileSync(path);
const sha=value=>createHash('sha256').update(value).digest('hex');
const moduleSha=sha(bytes(modulePath)),engineSha=sha(bytes(enginePath));
// Any unexpected networking is a hard failure, not a synthetic success response.
globalThis.fetch=async()=>{throw new Error('independent synthetic fixtures prohibit networking');};
const content=await import(pathToFileURL(modulePath).href);
const engine=await import(pathToFileURL(enginePath).href);
const {projectRecruitmentMessageContent:project,inspectRecruitmentContent:inspectContent,
  inspectReviewText:inspectReview,inspectSubmissionSlots:inspectSlots}=content;
for(const [name,fn] of Object.entries({project,inspectContent,inspectReview,inspectSlots}))assert.equal(typeof fn,'function',`${name} export required`);
assert.equal(typeof engine.parseRecruitmentMessages,'function');

const NAME='测试甲',SECOND='测试乙',REVIEWER='ou_fixtureReviewer',SUBMITTER='ou_fixtureSubmitter',CHAT='oc_fixtureRecruitment';
const APPROVED='面试结果\n测试甲\n颜值：8 表现力：7\n结果：通过';
const clone=structuredClone;
const rawText=text=>JSON.stringify({text});
const node=(text,extra={})=>({tag:'text',text,...extra});
const rawPost=(text,{title='',rows=null,locale='zh_cn',extra={}}={})=>JSON.stringify({[locale]:{title,content:rows||text.split('\n').map(line=>[node(line)]),...extra}});
function message(raw,type='post',extra={}){
  const projected=project(raw,type);
  return {messageId:'om_fixtureReview',chatId:CHAT,type,sender:{id:REVIEWER,name:'虚构评审'},
    createdAt:'2026-09-28T09:00:00.000Z',updatedAt:'2026-09-28T09:00:00.000Z',
    reactions:{details:[]},...projected,...extra};
}
const review=(text=APPROVED,extra={})=>message(rawPost(text),'post',extra);
const slotText=(name=NAME)=>`求职者【${name}】是否符合【主播】的邀约标准`;
const submission=(text=slotText(),extra={})=>message(rawText(text),'text',{
  messageId:'om_fixtureSubmission',sender:{id:SUBMITTER},createdAt:'2026-09-28T08:00:00.000Z',updatedAt:'2026-09-28T08:00:00.000Z',
  reactions:{details:[{emojiType:'OK',operatorId:REVIEWER}]},...extra});
const later=(raw=rawText('测试甲 已淘汰。'),type='text',extra={})=>message(raw,type,{
  messageId:'om_fixtureLater',createdAt:'2026-09-28T09:30:00.000Z',updatedAt:'2026-09-28T09:30:00.000Z',...extra});
const offer=()=>message(rawText(`新人主播-${NAME}接受offer 9.30待入职`),'text',{
  messageId:'om_fixtureOffer',sender:{id:SUBMITTER},createdAt:'2026-09-28T10:00:00.000Z',updatedAt:'2026-09-28T10:00:00.000Z'});
const parse=rows=>engine.parseRecruitmentMessages(rows,{reviewerOpenId:REVIEWER});
const candidate=result=>{const hit=result.candidates.find(item=>item.name===NAME);assert.ok(hit,'original synthetic submission remains visible');return hit;};
function pending(result,label=''){
  assert.equal(result.status,'pending',label);assert.ok(typeof result.reasonCode==='string'&&result.reasonCode.length,label||'explicit pending reason');
  assert.notEqual(result.passed,true,label);assert.notEqual(result.passed,false,label);
  if(Object.hasOwn(result,'sourceIds'))assert.equal(result.passed,null,`${label}: review parser must explicitly return null`);
}
function notBusinessGreen(result,label=''){
  const hit=candidate(result);
  assert.ok(!['interview_pass','interview_fail','hired'].includes(hit.stage),`${label}: stage ${hit.stage}`);
  assert.ok(hit.evaluationEvidence&&Object.hasOwn(hit.evaluationEvidence,'passed'),`${label}: explicit evaluation evidence required`);
  assert.equal(hit.evaluationEvidence.passed,null,`${label}: explicit unverified pass/fail`);
  assert.equal(hit.evaluationEvidence.status,'pending',`${label}: evidence not ready`);
  assert.equal(hit.reviewBindingStatus,'pending',`${label}: explicit unverified binding`);
  assert.equal(result.reviewBindingVerified,false,`${label}: strict false binding gate`);
  assert.equal(result.reviewSourceStatus,'pending',`${label}: overall review source pending`);
  assert.equal(result.funnel.groupEvaluatedCount,null,`${label}: measured interview count unavailable`);
  assert.equal(result.funnel.groupPassedCount,null,`${label}: group passed count is unverified, not measured 0`);
  assert.ok(!Object.values(result.interviewEvents||{}).flat().some(item=>['interview_pass','interview_fail'].includes(item.status)),`${label}: calendar clues not final outcome`);
  return hit;
}

test('selected pure module/engine SHA freeze (optional exact caller pins)',()=>{
  if(process.env.WIS_REVIEWTEXT_MODULE_SHA)assert.equal(moduleSha,process.env.WIS_REVIEWTEXT_MODULE_SHA);
  if(process.env.WIS_REVIEWTEXT_ENGINE_SHA)assert.equal(engineSha,process.env.WIS_REVIEWTEXT_ENGINE_SHA);
});
test('projection is real complete V1; raw fingerprint is SHA256 of exact bytes',()=>{
  const raw=rawPost(APPROVED),m=message(raw),result=inspectContent(m);
  assert.equal(m.reviewContentContractVersion,'feishu-textonly-v1');
  assert.equal(result.status,'text_ready');assert.equal(result.text,APPROVED);
  assert.equal(m.reviewText,APPROVED);assert.equal(m.contentFingerprint,sha(raw));
  assert.match(m.reviewTextFingerprint,/^[a-f0-9]{64}$/u);
  assert.equal(m.parseError,false);assert.equal(m.contentShapeVerified,true);
  assert.equal(m.textTruncated,false);assert.equal(m.reviewTextTruncated,false);
});
test('same-row text nodes concatenate without invented line break',()=>{
  const rows=[[node('面试结果')],[node('测试'),node('甲')],[node('颜值：8 '),node('表现力：7')],[node('结果：通过')]];
  const m=message(rawPost('',{rows}));assert.equal(m.reviewText,APPROVED);
  assert.equal(inspectReview(m,NAME).status,'text_ready');
});
for(const outcome of ['通过','不通过','未通过'])test(`strict one-person final ${outcome} is textual clue only`,()=>{
  const m=review(APPROVED.replace('结果：通过',`结果：${outcome}`)),r=inspectReview(m,NAME);
  assert.equal(r.status,'text_ready');assert.equal(r.passed,outcome==='通过');
  assert.ok(r.scores&&typeof r.scores==='object');assert.deepEqual(r.sourceIds,[m.messageId]);
  assert.equal(r.contentFingerprint,m.contentFingerprint);assert.equal(r.reviewTextFingerprint,m.reviewTextFingerprint);
});
test('post title is preserved in the full grammar rather than silently omitted',()=>{
  const m=message(rawPost(APPROVED.slice('面试结果\n'.length),{title:'面试结果'}));
  assert.equal(m.reviewText,APPROVED);assert.equal(inspectReview(m,NAME).status,'text_ready');
});
test('plain text cannot masquerade as selected post review',()=>pending(inspectReview(message(rawText(APPROVED),'text'),NAME)));
for(const text of [
  '面试结果\n测试甲\n颜值：8 表现力：7\n测试乙：不通过\n结果：通过',
  '面试结果\n测试甲\n颜值：8 表现力：7\n林秋禾\n颜值：1 表现力：1\n结果：通过',
  '面试结果\n测试甲\n颜值：8 表现力：7\n林秋禾口播自然\n结果：通过',
  APPROVED.replace('测试甲','测试甲 测试乙'),
])test(`unknown/second-person extra content ${sha(text).slice(0,8)} rejects without knownNames`,()=>pending(inspectReview(review(text),NAME)));
for(const outcome of ['没有通过','尚未通过','不是不通过','通过？','通过?','可以通过吗','是否通过','未通过？','如果通过','暂定通过','已淘汰'])
  test(`negation/question/conditional final ${outcome} is pending`,()=>pending(inspectReview(review(APPROVED.replace('结果：通过',outcome)),NAME)));
for(const [label,text] of [
  ['missing performance','面试结果\n测试甲\n颜值：8\n结果：通过'],
  ['missing looks','面试结果\n测试甲\n表现力：7\n结果：通过'],
  ['missing result','面试结果\n测试甲\n颜值：8 表现力：7'],
  ['two results',`${APPROVED}\n结果：不通过`],
  ['content after result',`${APPROVED}\n后续待复核`],
  ['duplicate name',APPROVED.replace('测试甲','测试甲\n测试甲')],
  ['duplicate score',APPROVED.replace('颜值：8 表现力：7','颜值：8 表现力：7\n颜值：8 表现力：7')],
  ['non-finite score',APPROVED.replace('颜值：8','颜值：Infinity')],
  ['media marker',APPROVED.replace('结果：通过','[Media:image]\n结果：通过')],
])test(`closed full-line grammar ${label}`,()=>{const m=review(text);assert.equal(m.reviewText,text);pending(inspectReview(m,NAME));});
test('raw repeated rows survive projection; no dedupe makes duplicate score legitimate',()=>{
  const text=APPROVED.replace('测试甲','测试甲\n测试甲');const m=review(text);
  assert.equal(m.reviewText,text);assert.equal(m.reviewText.match(/测试甲/gu).length,2);pending(inspectReview(m,NAME));
});
for(const [label,n] of [
  ['image',{tag:'img',image_key:'img_fixture'}],['at',{tag:'at',user_id:'ou_fixtureOther'}],
  ['link',{tag:'a',text:'结果：通过',href:'https://invalid.test/fixture'}],['unknown',{tag:'unknown',text:'结果：通过'}],
  ['lineThrough',node('结果：通过',{style:['lineThrough']})],['unknownStyle',node('结果：通过',{style:['unknown']})],
])test(`visible semantic projection ${label} stays pending`,()=>{
  const rows=APPROVED.split('\n').map(line=>[node(line)]);rows.at(-1).push(n);
  const m=message(rawPost('',{rows}));pending(inspectContent(m));pending(inspectReview(m,NAME));
});
test('resource beyond a displayed first twenty cannot disappear from full source gate',()=>{
  const rows=APPROVED.split('\n').map(line=>[node(line)]);
  rows.push(Array.from({length:21},(_,i)=>({tag:'img',image_key:`img_fixture_${i}`})));
  const m=message(rawPost('',{rows}));assert.equal(m.hasMediaOrResource,true);pending(inspectContent(m));pending(inspectReview(m,NAME));
});
for(const [label,raw,type] of [
  ['invalid JSON','{','post'],
  ['multi locale',JSON.stringify({zh_cn:{title:'',content:[[node(APPROVED)]]},en_us:{title:'',content:[[node('hidden')]]}}),'post'],
  ['unknown post field',rawPost(APPROVED,{extra:{unknown:'测试乙'}}),'post'],
  ['unknown text field',JSON.stringify({text:APPROVED,unknown:'测试乙'}),'text'],
  ['nonstring text',JSON.stringify({text:123}),'text'],
  ['unknown nested content',JSON.stringify({zh_cn:{title:'',content:[{text:APPROVED}]}}),'post'],
  ['long full source',rawPost(`${APPROVED}\n${'合成'.repeat(4050)}\n测试乙 不通过`),'post'],
])test(`uninspectable projection ${label}`,()=>{const m=message(raw,type);pending(inspectContent(m));pending(inspectReview(m,NAME));});
for(const field of ['reviewContentContractVersion','reviewText','contentFingerprint','reviewTextFingerprint','parseError','contentShapeVerified','textTruncated','reviewTextTruncated','hasMediaOrResource','unsupportedStyle','resourceCount','resources','fullProjectionLength'])
  test(`old cached field missing ${field} cannot be trusted`,()=>{const m=review();delete m[field];pending(inspectContent(m));pending(inspectReview(m,NAME));});
for(const [field,value] of [['parseError','false'],['contentShapeVerified',1],['textTruncated','false'],['reviewTextTruncated',0],['hasMediaOrResource',null],['reviewContentContractVersion','old-v0']])
  test(`non-strict required field ${field}=${value}`,()=>{const m=review();m[field]=value;pending(inspectContent(m));pending(inspectReview(m,NAME));});
test('display fallback with green-looking text does not restore missing reviewText',()=>{
  const m=review();delete m.reviewText;m.text=APPROVED;pending(inspectContent(m));pending(inspectReview(m,NAME));
});
test('raw edit and style mutation change raw fingerprint even when visible wording agrees',()=>{
  const a=rawPost(APPROVED),b=JSON.stringify(JSON.parse(a),null,2),rows=APPROVED.split('\n').map(line=>[node(line,{style:['bold']})]);
  const p1=project(a,'post'),p2=project(b,'post'),p3=project(rawPost('',{rows}),'post');
  assert.notEqual(p1.contentFingerprint,p2.contentFingerprint);assert.notEqual(p1.contentFingerprint,p3.contentFingerprint);
  assert.equal(p1.reviewText,p2.reviewText);assert.equal(p1.reviewText,p3.reviewText);
});

test('complete one-person submission slot uses full projection and exact non-overlap span',()=>{
  const m=submission(),r=inspectSlots(m);assert.equal(r.status,'complete');assert.deepEqual(r.names,[NAME]);
  assert.equal(r.visibleSlotCount,1);assert.equal(r.parsedCompleteSlotCount,1);assert.equal(r.validatedIdentitySlotCount,1);
  assert.equal(r.spans.length,1);assert.ok(r.spans[0]&&typeof r.spans[0]==='object');
});
test('complete non-submission content reports none rather than fabricated identity',()=>assert.equal(inspectSlots(review()).status,'none'));
for(const second of [
  '求职者【Alice】是否符合【主播】的邀约标准',
  '求职者【】是否符合【主播】的邀约标准','求职者【测试乙',
  '求职者【测试乙】是否符合','求职者【测试乙】是否符合【助理】的邀约标准',
  '求职者【测试乙】','求 职 者【测试乙','求\u200b职者【测试乙',
  '求\u2066职者【Alice】是否符合【主播】的邀约标准','求\u202d职者【测试乙',
])test(`mixed valid and malformed/nonHan slot ${sha(second).slice(0,8)} holds whole source`,()=>{
  const m=submission(`${slotText()}\n${second}`),r=inspectSlots(m);assert.equal(r.status,'pending');assert.ok(r.reasonCode);
  assert.ok(r.names.includes(NAME),'known first person retained as clue, not discarded');assert.ok(r.visibleSlotCount>=2);
  assert.notEqual(r.visibleSlotCount,r.validatedIdentitySlotCount);
});
test('candidate marker split across same-row nodes is not hidden from slot scan',()=>{
  const rows=[[node(slotText())],[node('求'),node('职者【Alice】是否符合【主播】的邀约标准')]];
  const r=inspectSlots(message(rawPost('',{rows})));assert.equal(r.status,'pending');assert.equal(r.visibleSlotCount,2);
});

// Integration: no calendar/event/reviewer binding exists in these inputs.
for(const outcome of ['通过','不通过','未通过'])test(`engine strict ${outcome} never becomes final business state`,()=>{
  const rows=[submission(),review(APPROVED.replace('结果：通过',`结果：${outcome}`))],result=parse(rows);
  const hit=notBusinessGreen(result,outcome);assert.equal(hit.submissionEvidence.initialReview,'OK');
  assert.equal(result.funnel.initialPassedCount,1);assert.ok(['initial_pass','pending_feedback'].includes(hit.stage));
});
for(const text of [APPROVED.replace('结果：通过','没有通过'),APPROVED.replace('结果：通过','通过？'),APPROVED.replace('结果：通过','测试乙：不通过\n结果：通过')])
  test(`engine rejected review keeps unique initial OK ${sha(text).slice(0,8)}`,()=>{
    const hit=notBusinessGreen(parse([submission(),review(text)]));assert.equal(hit.submissionEvidence.initialReview,'OK');
  });
for(const [label,laterMessage] of [
  ['same-name eliminated',()=>later()],['nameless reply eliminated',()=>later(rawText('已淘汰'),'text',{replyId:'om_fixtureReview',parentId:'om_fixtureReview'})],
  ['opaque image',()=>later(JSON.stringify({image_key:'img_fixtureLater'}),'image')],
  ['opaque card',()=>later(JSON.stringify({elements:[]}),'interactive')],
  ['empty reviewer text',()=>later(rawText(''))],
  ['long reviewer text',()=>later(rawText('合成'.repeat(4050)))],
])test(`engine later ${label} invalidates text clue, not initial OK`,()=>{
  const result=parse([submission(),review(),laterMessage()]);const hit=notBusinessGreen(result,label);
  assert.equal(hit.submissionEvidence.initialReview,'OK');
  assert.notEqual(hit.reviewTextStatus,'text_ready');assert.notEqual(hit.evaluationEvidence?.reviewTextStatus,'text_ready');
});
test('engine duplicate same-ID edited review cannot pick old or newer green by array order',()=>{
  const a=review(),b=review(APPROVED.replace('结果：通过','没有通过'),{updatedAt:'2026-09-28T09:10:00.000Z'});
  for(const rows of [[a,b],[b,a]]){const hit=notBusinessGreen(parse([submission(),...rows]));assert.notEqual(hit.reviewTextStatus,'text_ready');assert.notEqual(hit.evaluationEvidence?.reviewTextStatus,'text_ready');}
});
for(const [label,change] of [
  ['missing V1 contract',m=>{delete m.reviewContentContractVersion;}],
  ['missing full projection length',m=>{delete m.fullProjectionLength;}],
  ['changed full projection length',m=>{m.fullProjectionLength+=1;}],
  ['isDeleted recall alias',m=>{m.isDeleted=true;}],
])test(`engine same-ID qualification fields differ ${label} cannot hide after valid copy`,()=>{
  const a=review(),b=clone(a);change(b);pending(inspectReview(b,NAME));
  for(const rows of [[a,b],[b,a]]){
    const result=parse([submission(),...rows]),hit=notBusinessGreen(result,label);
    assert.notEqual(hit.reviewTextStatus,'text_ready',`${label}: qualification cannot be first-copy wins`);
    assert.equal(result.funnel.groupTextQualifiedClueCount,0,`${label}: invalid whole source cannot enter qualified clue count`);
  }
});
test('engine selected review withdrawal does not keep historical text_ready',()=>{
  const hit=notBusinessGreen(parse([submission(),review(APPROVED,{deleted:true})]));
  assert.equal(hit.submissionEvidence.initialReview,'OK');assert.notEqual(hit.reviewTextStatus,'text_ready');
});
test('engine green-looking old cached post without V1 stays unverified',()=>{
  const m=review();delete m.reviewContentContractVersion;const hit=notBusinessGreen(parse([submission(),m]));assert.notEqual(hit.reviewTextStatus,'text_ready');
});
for(const emoji of ['No',null])test(`engine initial ${emoji||'pending'} remains original despite review and offer`,()=>{
  const source=submission(slotText(),{reactions:{details:emoji?[{emojiType:emoji,operatorId:REVIEWER}]:[]}});
  const hit=notBusinessGreen(parse([source,review(),offer()]));assert.equal(hit.submissionEvidence.initialReview,emoji);
  assert.equal(hit.stage,emoji==='No'?'initial_fail':'unmapped');
});
test('engine offer cannot launder unbound strict text into interview pass',()=>notBusinessGreen(parse([submission(),review(),offer()])));
for(const second of ['求职者【Alice】是否符合【主播】的邀约标准','求职者【测试乙'])test(`engine malformed second slot freezes known first scope ${sha(second).slice(0,8)}`,()=>{
  const result=parse([submission(`${slotText()}\n${second}`),review(),offer()]);const hit=notBusinessGreen(result);
  assert.equal(hit.submissionEvidence.sourceId,'');assert.equal(hit.submissionEvidence.initialReview,null);assert.equal(hit.stage,'unmapped');
});
test('engine group-B dual initial reaction cannot be restored by textual clue',()=>{
  const result=parse([submission(slotText(),{reactions:{details:[{emojiType:'OK',operatorId:REVIEWER},{emojiType:'No',operatorId:REVIEWER}]}}),review(),offer()]);
  const hit=notBusinessGreen(result);assert.equal(hit.submissionEvidence.sourceId,'');assert.equal(hit.submissionEvidence.initialReview,null);
});
test('engine exact duplicate projected pages keep legitimate initial OK and provisional grammar clue',()=>{
  const s=submission(),r=review(),result=parse([s,clone(s),r,clone(r)]),hit=notBusinessGreen(result);
  assert.equal(hit.submissionEvidence.initialReview,'OK');assert.equal(result.submissionMessageCounts[NAME],1);
  assert.equal(hit.reviewTextStatus,'text_ready');assert.equal(hit.evaluationEvidence.textOutcome,true);
  assert.equal(result.funnel.groupTextQualifiedClueCount,1);
});
test('engine same-name different submission IDs stay ambiguous under actual V1 projection',()=>{
  const result=parse([submission(),submission(slotText(),{messageId:'om_fixtureSubmission2'}),review(),offer()]);
  const hit=notBusinessGreen(result);assert.equal(hit.submissionEvidence.sourceId,'');assert.equal(hit.submissionEvidence.initialReview,null);
  assert.equal(result.submissionMessageCounts[NAME],2);assert.equal(result.funnel.groupTextQualifiedClueCount,0);
});
test('engine one submission ID repeated same-person slots does not manufacture unique identity',()=>{
  const result=parse([submission(`${slotText()}\n${slotText()}`),review(),offer()]);
  const hit=notBusinessGreen(result);assert.equal(hit.submissionEvidence.sourceId,'');assert.equal(hit.submissionEvidence.initialReview,null);
});
test('engine synthetic inputs remain byte-observed unchanged',()=>{
  const rows=[submission(),review(),later()],before=JSON.stringify(rows);parse(rows);assert.equal(JSON.stringify(rows),before);
});

// Execute only the exact source getter/UI helpers in a deny-network VM, never startup.
const serverPath=process.env.WIS_REVIEWTEXT_SERVER || `${DEFAULT}/server.js`;
const serverBytes=bytes(serverPath),serverSource=serverBytes.toString('utf8');
const getterStart=serverSource.indexOf('async function getChatMessages('),getterEnd=serverSource.indexOf('async function findChatByName(',getterStart);
const uiStart=serverSource.indexOf('function parseMessageContent(');
assert.ok(uiStart>=0&&getterStart>uiStart&&getterEnd>getterStart);
const getter=serverSource.slice(getterStart,getterEnd),uiHelpers=serverSource.slice(uiStart,getterStart);
const api=(id,raw,time,sender=REVIEWER,extra={})=>({message_id:id,chat_id:CHAT,msg_type:'post',body:{content:raw},
  sender:{id:sender},create_time:String(Date.parse(time)),update_time:String(Date.parse(time)),...extra});
const apiSubmission=()=>api('om_fixtureSubmission',rawPost(slotText()),'2026-09-28T08:00:00.000Z',SUBMITTER);
const apiReview=()=>api('om_fixtureReview',rawPost(APPROVED),'2026-09-28T09:00:00.000Z');
async function throughActualGetter(items){
  const reactionCalls=[],cache=new Map([['chat:recruitment:20:0:0',{value:{messages:[{text:'stale synthetic green'}]}}]]);
  const context={URLSearchParams,Date,projectRecruitmentMessageContent:project,feishuCache:cache,
    feishuChats:{recruitment:{chatId:CHAT,name:'synthetic'}},FeishuError:class extends Error{},
    activeChatMessages:rows=>rows.filter(row=>row?.deleted!==true),
    feishuGet:async path=>{assert.match(path,/^\/im\/v1\/messages\?/u);return {items,has_more:false};},
    getMessageReactions:async ids=>{
      reactionCalls.push(Array.from(ids));
      return new Map(ids.map(id=>[id,{details:id==='om_fixtureSubmission'?[{emojiType:'OK',operatorId:REVIEWER}]:[]} ]));
    },cached:async()=>{throw new Error('recruitment bodies must never be cached');}};
  vm.createContext(context);vm.runInContext(`${uiHelpers}\n${getter}\nthis.getter=getChatMessages;`,context,{timeout:1000});
  const result=await context.getter('recruitment',20,{fresh:true});
  assert.equal(cache.get('chat:recruitment:20:0:0').value.messages[0].text,'stale synthetic green');
  return {result,reactionCalls};
}
test('actual getter SHA exact freeze (optional caller pin)',()=>{
  if(process.env.WIS_REVIEWTEXT_SERVER_SHA)assert.equal(sha(serverBytes),process.env.WIS_REVIEWTEXT_SERVER_SHA);
});
test('raw API getter keeps exact reaction target and builds strict review only as clue, without post-projection mutation',async()=>{
  const {result,reactionCalls}=await throughActualGetter([apiSubmission(),apiReview()]);
  assert.deepEqual(reactionCalls,[['om_fixtureSubmission','om_fixtureReview']]);
  const rows=Array.from(result.messages),s=rows.find(row=>row.messageId==='om_fixtureSubmission');
  assert.equal(s.reactions.details[0].operatorId,REVIEWER);assert.equal(s.reviewContentContractVersion,'feishu-textonly-v1');
  const parsed=parse(rows),hit=notBusinessGreen(parsed);assert.equal(hit.submissionEvidence.initialReview,'OK');
  assert.equal(hit.stage,'initial_pass');assert.equal(hit.reviewTextStatus,'text_ready');assert.equal(hit.evaluationEvidence.textOutcome,true);
});
for(const flag of ['deleted','is_deleted','isDeleted','recalled','is_recalled'])test(`raw API actual getter ${flag} tombstone reaches engine but not reaction request`,async()=>{
  const tombstone=api('om_fixtureLater','unavailable','2026-09-28T09:30:00.000Z',REVIEWER,{[flag]:true});
  const {result,reactionCalls}=await throughActualGetter([apiSubmission(),apiReview(),tombstone]);
  assert.equal(result.messages.length,3);assert.equal(result.deletedMessageCount,1);
  assert.deepEqual(reactionCalls,[['om_fixtureSubmission','om_fixtureReview']]);
  const parsed=parse(Array.from(result.messages)),hit=notBusinessGreen(parsed,flag);
  assert.equal(hit.submissionEvidence.initialReview,'OK');assert.equal(hit.reviewTextStatus,'pending');
  assert.equal(hit.reviewPendingReason,'later_review_opaque');assert.deepEqual(hit.reviewSourceIds,['om_fixtureReview','om_fixtureLater']);
});
