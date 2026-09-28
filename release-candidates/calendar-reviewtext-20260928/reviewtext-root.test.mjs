import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {projectRecruitmentMessageContent as project,inspectRecruitmentContent,inspectSubmissionSlots,inspectReviewText} from './recruitment-content.mjs';
import {parseRecruitmentMessages,parseEmploymentMessages,mergeRecruitmentCandidates} from './lifecycle-engine.mjs';
globalThis.fetch=async()=>{throw new Error('root offline fixtures prohibit networking');};
const NAME='测试甲',OTHER='测试乙',ACTOR='ou_fixtureReviewer',CHAT='oc_fixtureGroup';
const template=name=>`求职者【${name}】是否符合【主播】的邀约标准`;
const syntax=name=>`面试结果\n${name}\n颜值：8 表现力：7\n结果：通过`;
function msg(text,type='text',extra={}) {
  const raw=JSON.stringify(type==='post'?{zh_cn:{title:'',content:text.split('\n').map(text=>[{tag:'text',text}])}}:{text});
  return {messageId:'om_fixtureSource',chatId:CHAT,type,sender:{id:'ou_fixtureSubmitter'},
    createdAt:'2026-09-28T08:00:00.000Z',updatedAt:'2026-09-28T08:00:00.000Z',
    ...project(raw,type),...extra};
}
const submission=(extra={})=>msg(template(NAME),'text',{reactions:{details:[{emojiType:'OK',operatorId:ACTOR}]},...extra});
const review=(extra={})=>msg(syntax(NAME),'post',{messageId:'om_fixtureReview',sender:{id:ACTOR},
  createdAt:'2026-09-28T09:00:00.000Z',updatedAt:'2026-09-28T09:00:00.000Z',...extra});
const parse=rows=>parseRecruitmentMessages(rows,{reviewerOpenId:ACTOR});
const find=value=>{const row=value.candidates.find(row=>row.name===NAME);assert.ok(row);return row;};
function held(value){const row=find(value);assert.equal(row.submissionEvidence.sourceId,'');
  assert.equal(row.submissionEvidence.initialReview,null);assert.equal(row.stage,'unmapped');
  assert.notEqual(row.reviewTextStatus,'text_ready');assert.equal(value.funnel.groupPassedCount,null);return row;}
test('approved engine ranges preserve all other frozen base bytes and safe reaction function',()=>{
  let base=readFileSync(new URL('./lifecycle-engine.base.mjs',import.meta.url),'utf8');
  let source=readFileSync(new URL('./lifecycle-engine.mjs',import.meta.url),'utf8');
  source=source.replace("import {inspectRecruitmentContent,inspectReviewText,inspectSubmissionSlots} from './recruitment-content.mjs';\n",'');
  const remove=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);assert.equal(text.indexOf(start,a+start.length),-1);return text.slice(0,a)+text.slice(b);};
  for(const [start,end] of [['function recruitmentSubmissionIdentity(','function offerEvent('],['export function parseRecruitmentMessages(','function calendarTitleNamesPerson(']]){
    base=remove(base,start,end);source=remove(source,start,end);
  }
  assert.equal(source,base);
});
test('strict text qualification never substitutes event binding, counts or stage',()=>{
  const value=parse([submission(),review()]),row=find(value);
  assert.equal(row.stage,'initial_pass');assert.equal(row.submissionEvidence.sourceId,'om_fixtureSource');
  assert.equal(row.reviewTextStatus,'text_ready');assert.equal(row.reviewBindingStatus,'pending');
  assert.equal(row.evaluationEvidence.passed,null);assert.equal(row.evaluationEvidence.textOutcome,true);
  assert.equal(value.reviewBindingVerified,false);assert.equal(value.funnel.groupEvaluatedCount,null);
  assert.equal(value.funnel.initialPassedCount,1);assert.equal(value.submittedCount,1);
});
for(const emoji of ['OK','No'])test(`duplicate same ${emoji} reaction is not a conflict`,()=>{
  const a=submission({reactions:{details:[{emojiType:emoji,operatorId:ACTOR},{emojiType:emoji,operatorId:ACTOR}]}});
  const row=find(parse([a,structuredClone(a),review()]));assert.equal(row.submissionEvidence.initialReview,emoji);
  assert.equal(row.stage,emoji==='OK'?'initial_pass':'initial_fail');
});
test('dual target reaction pending is invariant to list order and other actor reactions',()=>{
  const reactions=[{emojiType:'OK',operatorId:ACTOR},{emojiType:'No',operatorId:ACTOR},{emojiType:'OK',operatorId:'ou_fixtureOther'}];
  for(const details of [reactions,[...reactions].reverse()])held(parse([submission({reactions:{details}}),review()]));
});
for(const [field,value] of [['reviewContentContractVersion',undefined],['fullProjectionLength',undefined],['fullProjectionLength',999],
  ['parseError',true],['contentShapeVerified',false],['textTruncated',true],['reviewTextTruncated',true],
  ['hasMediaOrResource',true],['resourceCount',1],['unsupportedStyle',true],['isDeleted',true],
  ['contentFingerprint','a'.repeat(64)],['reviewTextFingerprint','a'.repeat(64)]])
  test(`same-ID initial full qualification drift ${field} holds both orderings`,()=>{
    const a=submission(),b={...structuredClone(a),[field]:value};
    for(const pair of [[a,b],[b,a]])held(parse([...pair,review()]));
  });
for(const [field,value] of [['messageId','bad-source'],['chatId','wronggroup'],['sender',{id:'wrongactor'}],
  ['createdAt','2026-02-30T08:00:00.000Z'],['createdAt','2026-09-28T24:00:00.000Z'],['updatedAt','2026-09-27T00:00:00.000Z']])
  test(`initial invalid identity ${field} never turns text into verified source`,()=>held(parse([submission({[field]:value}),review()])));
test('same-name independent source IDs retained as real alternatives, not count zero',()=>{
  const value=parse([submission(),submission({messageId:'om_fixtureSecond'}),review()]);held(value);
  assert.equal(value.submissionMessageCounts[NAME],2);assert.equal(find(value).submissionEvidenceAlternatives.length,2);
});
test('unrelated second valid submission still has its independent initial result',()=>{
  const other=msg(template(OTHER),'text',{messageId:'om_fixtureOther',reactions:{details:[{emojiType:'OK',operatorId:ACTOR}]}});
  const value=parse([submission(),submission({messageId:'om_fixtureDuplicate'}),other]);held(value);
  const row=value.candidates.find(row=>row.name===OTHER);assert.equal(row.submissionEvidence.initialReview,'OK');
  assert.equal(row.submissionEvidence.sourceId,'om_fixtureOther');assert.equal(row.stage,'initial_pass');
});
for(const second of ['求职者【Alice】是否符合【主播】的邀约标准','求职者【】是否符合【主播】的邀约标准',
  '求职者【测试乙','求\u202a职者【测试乙','求\u2066职者【Alice】是否符合【主播】的邀约标准'])
  test(`whole mixed source withheld; unknown identities never guessed ${second.slice(0,12)}`,()=>{
    const a=submission({...project(JSON.stringify({text:`${template(NAME)}\n${second}`}), 'text')});
    assert.equal(inspectSubmissionSlots(a).status,'pending');const value=parse([a,review()]);held(value);
    assert.equal(value.submittedCount,null);assert.equal(value.dailyCounts['2026-09-28'],null);
    assert.equal(value.submittedClueCount,1);assert.equal(value.candidates.length,1);
  });
test('source array and reaction objects remain unmodified',()=>{
  const rows=[submission(),review()],before=JSON.stringify(rows);parse(rows);assert.equal(JSON.stringify(rows),before);
});
test('withdrawal of one same-ID page holds the earlier valid initial source',()=>{
  const a=submission(),b={...structuredClone(a),deleted:true,text:'',reviewText:''};
  for(const pair of [[a,b],[b,a]])held(parse([...pair,review()]));
});
test('independent actual employment date and timeline remain facts under recruitment pending',()=>{
  const value=parse([submission(),review()]);const employment=parseEmploymentMessages([
    msg(`${NAME} 已入职`,'text',{messageId:'om_fixtureEmployment',sender:{id:ACTOR}})
  ],{reviewerOpenId:ACTOR});
  const merged=mergeRecruitmentCandidates(value.candidates,employment.candidates),row=merged.find(row=>row.name===NAME);
  assert.equal(row.stage,'hired');assert.equal(row.actualStartDate,'2026-09-28');
  assert.equal(row.evaluationEvidence.passed,null);assert.equal(row.reviewBindingStatus,'pending');
  assert.ok(row.timeline.some(item=>item[1].includes('入职')));
});
test('source formatting changes raw fingerprint without silently deduping grammar',()=>{
  const a=review();assert.equal(inspectRecruitmentContent(a).status,'text_ready');
  const raw=JSON.stringify({zh_cn:{title:'',content:syntax(NAME).split('\n').map(text=>[{tag:'text',text}])}},null,2);
  const b={...a,...project(raw,'post')};assert.notEqual(a.contentFingerprint,b.contentFingerprint);
  assert.equal(a.reviewText,b.reviewText);assert.equal(inspectReviewText(b,NAME).status,'text_ready');
  assert.notEqual(find(parse([submission(),a,b])).reviewTextStatus,'text_ready');
});
