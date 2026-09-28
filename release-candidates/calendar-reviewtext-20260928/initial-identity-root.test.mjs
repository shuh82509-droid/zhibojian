import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const candidatePath=process.env.WIS_IDENTITY_REVIEW_ENGINE;
assert.ok(candidatePath,'Set WIS_IDENTITY_REVIEW_ENGINE to an explicit pure candidate engine. No default target.');
const candidateUrl=pathToFileURL(candidatePath);
const {parseRecruitmentMessages,assessmentSubmissionFor}=await import(candidateUrl.href);
const {projectRecruitmentMessageContent}=await import(new URL('./recruitment-content.mjs',candidateUrl).href);
function content(text,type='text') {
  const raw=type==='post'
    ? {title:'',content:text.split('\n').map(line=>[{tag:'text',text:line}])}
    : {text};
  return projectRecruitmentMessageContent(JSON.stringify(raw),type==='post'?'post':'text');
}
const reviewer='ou_fixtureReviewer',name='测试甲',id='om_fixtureOne';
const submit=(extra={})=>{
  const body=extra.text ?? `求职者【${name}】是否符合【主播】的邀约标准`;
  const type=extra.type ?? 'text';
  // Non-text kind overrides deliberately model an observed type/projection drift.
  return {messageId:id,chatId:'oc_fixtureRecruitment',type,
    createdAt:'2026-09-28T01:00:00.000Z',updatedAt:'2026-09-28T01:00:00.000Z',
    sender:{id:'ou_fixtureSender'},...content(body,type),
    reactions:{details:[{emojiType:'OK',operatorId:reviewer}]},...extra};
};
const review=()=>({messageId:'om_fixtureReview',chatId:'oc_fixtureRecruitment',type:'post',
  createdAt:'2026-09-28T02:00:00.000Z',updatedAt:'2026-09-28T02:00:00.000Z',
  sender:{id:reviewer},...content(`${name}\n颜值 8\n表现力 8\n结果：通过`,'post')});
const parse=rows=>parseRecruitmentMessages(rows,{reviewerOpenId:reviewer});
function pending(rows){const value=parse([...rows,review()]),candidate=value.candidates.find(x=>x.name===name);
  assert.equal(candidate.stage,'unmapped');assert.equal(candidate.submissionEvidence.sourceId,'');
  assert.equal(candidate.submissionEvidence.initialReview,null);assert.equal(value.funnel.initialPendingCount,1);
  assert.equal(value.funnel.initialPassedCount,null);assert.equal(value.funnel.initialPassedClueCount,0);assert.equal(value.funnel.groupPassedCount,null);
  assert.equal(value.funnel.groupEvaluatedCount,null);assert.equal(Object.values(value.interviewEvents).flat().length,0);
  assert.equal(assessmentSubmissionFor({...value,coverage:{chatMessages:10,capped:false}},
    {candidateName:name,submissionMessageId:id,outcome:'pass'}).status,'pending');return value;}
const readCandidate=file=>readFileSync(new URL(file,candidateUrl),'utf8');
const sha=text=>createHash('sha256').update(text).digest('hex');
test('strict content adaptation preserves prior group B semantics and outside-scope bytes',()=>{
  const base=readCandidate('lifecycle-engine.base.mjs'),current=readCandidate('lifecycle-engine.mjs');
  assert.equal(sha(base),'54271b172fdf96b903fab2187bc717244422ac02184da45ccb926cf068d95954');
  const addedImport="import {inspectRecruitmentContent,inspectReviewText,inspectSubmissionSlots} from './recruitment-content.mjs';\n";
  function outside(text){
    text=text.replace(addedImport,'');
    for(const [start,end] of [
      ['function recruitmentSubmissionIdentity(','function offerEvent('],
      ['export function parseRecruitmentMessages(','function calendarTitleNamesPerson(']
    ]){
      const from=text.indexOf(start),to=text.indexOf(end,from);assert.ok(from>=0&&to>from);
      assert.equal(text.indexOf(start,from+start.length),-1);text=text.slice(0,from)+text.slice(to);
    }return text;
  }
  assert.equal(outside(base),outside(current));
  const reaction=current.slice(current.indexOf('function reviewerReaction('),current.indexOf('function recruitmentSubmissionIdentity('));
  assert.equal(sha(reaction),'3304d9ccc96987c20b8ce4275a8d281e1c509346d867a0bd5aa6193853cde5a1');
});
for(const [label,extra] of [
  ['impossible date',{createdAt:'2026-02-30T01:00:00.000Z'}],
  ['hour rollover',{createdAt:'2026-09-28T24:00:00.000Z'}],
  ['non-ISO timestamp',{createdAt:'2026-09-28'}],
  ['unexpected message kind',{type:'image'}],
  ['review truncation',{reviewTextTruncated:true}],
  ['raw text mismatch',{reviewText:'不同的合成正文'}],
  ['repeated name in same source',{text:`求职者【${name}】是否符合【主播】的邀约标准\n求职者【${name}】是否符合【主播】的邀约标准`}],
])test(`invalid observed source ${label} is pending`,()=>pending([submit(extra)]));
for(const [label,extra] of [
  ['update timestamp',{updatedAt:'2026-09-28T01:05:00.000Z'}],
  ['chat identity',{chatId:'oc_fixtureOtherChat'}],
  ['sender identity',{sender:{id:'ou_fixtureOtherSender'}}],
  ['media projection',{resources:[{type:'image',key:'synthetic_only'}]}],
  ['truncation marker',{textTruncated:true}],
  ['raw text differs',{reviewText:'不同的合成正文'}],
  ['unreadable message kind',{type:'image',text:''}],
])for(const reverse of [false,true])test(`same source ${label} drift pending, reverse=${reverse}`,()=>{
  const a=submit(),b=submit(extra);pending(reverse?[b,a]:[a,b]);
});
test('recalled same-name source remains an unresolved identity alternative, not silently erased',()=>{
  const value=parse([submit({messageId:'om_fixtureOld',deleted:true}),submit(),review()]);
  assert.equal(value.submissionMessageCounts[name],2);assert.equal(value.candidates[0].stage,'unmapped');
  assert.equal(value.candidates[0].submissionEvidence.sourceId,'');assert.equal(value.candidates[0].submissionEvidence.initialReview,null);
  assert.equal(value.candidates[0].submissionEvidenceAlternatives.length,2);assert.equal(value.funnel.initialPassedClueCount,0);
  assert.equal(value.funnel.initialPassedCount,null);assert.equal(value.funnel.groupPassedCount,null);
});
test('semantic OK repeats and emoji/operator aliases stay stable',()=>{
  const a=submit(),b=submit({reactions:{details:[{emoji_type:'OK',operator:{open_id:reviewer}},{emojiType:'OK',operatorId:reviewer}]}});
  const value=parse([a,b,review()]);assert.equal(value.submissionMessageCounts[name],1);assert.equal(value.funnel.groupPassedCount,null);
  assert.equal(value.candidates[0].stage,'initial_pass');assert.equal(value.candidates[0].submissionEvidence.initialReview,'OK');
  assert.equal(value.candidates[0].submissionEvidence.sourceId,id);assert.equal(value.funnel.initialPassedCount,1);
  assert.equal(value.candidates[0].reviewTextStatus,'text_ready');assert.equal(value.candidates[0].evaluationEvidence.passed,null);
});
test('retained media in exact copies does not manufacture duplicate identity and stays pending',()=>{
  const a=submit({resources:[{type:'image',key:'synthetic_only'}]});
  const value=parse([a,structuredClone(a),review()]);assert.equal(value.submissionMessageCounts[name],1);
  assert.equal(value.candidates[0].stage,'unmapped');assert.equal(value.candidates[0].submissionEvidence.sourceId,'');
  assert.equal(value.candidates[0].submissionEvidence.initialReview,null);
  assert.equal(value.candidates[0].submissionEvidenceAlternatives.length,1);
  assert.equal(value.funnel.initialPassedClueCount,0);assert.equal(value.funnel.initialPassedCount,null);
  assert.equal(value.funnel.groupPassedCount,null);assert.equal(value.funnel.groupEvaluatedCount,null);
});
