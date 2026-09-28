import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseRecruitmentMessages,assessmentSubmissionFor} from './lifecycle-engine.mjs';
const reviewer='ou_fixtureReviewer',name='测试甲',id='om_fixtureOne';
const submit=(extra={})=>({messageId:id,type:'text',createdAt:'2026-09-28T01:00:00.000Z',
  sender:{id:'ou_fixtureSender'},text:`求职者【${name}】是否符合【主播】的邀约标准`,
  reactions:{details:[{emojiType:'OK',operatorId:reviewer}]},...extra});
const review=()=>({messageId:'om_fixtureReview',type:'text',createdAt:'2026-09-28T02:00:00.000Z',
  sender:{id:reviewer},text:`${name}\n颜值 8\n面试结果：通过`});
const parse=rows=>parseRecruitmentMessages(rows,{reviewerOpenId:reviewer});
function pending(rows){const value=parse([...rows,review()]),candidate=value.candidates.find(x=>x.name===name);
  assert.equal(candidate.stage,'unmapped');assert.equal(candidate.submissionEvidence.sourceId,'');
  assert.equal(candidate.submissionEvidence.initialReview,null);assert.equal(value.funnel.initialPendingCount,1);
  assert.equal(value.funnel.initialPassedCount,0);assert.equal(value.funnel.groupPassedCount,0);
  assert.equal(value.funnel.groupEvaluatedCount,0);assert.equal(Object.values(value.interviewEvents).flat().length,0);
  assert.equal(assessmentSubmissionFor({...value,coverage:{chatMessages:10,capped:false}},
    {candidateName:name,submissionMessageId:id,outcome:'pass'}).status,'pending');return value;}
const read=file=>readFileSync(new URL(file,import.meta.url),'utf8');
test('composed engine preserves every prior-candidate byte outside the two group B ranges',()=>{
  const base=read('lifecycle-engine.base.mjs'),current=read('lifecycle-engine.mjs');
  assert.equal(createHash('sha256').update(base).digest('hex'),'d90bbca1858b1131dfdaa8a7d6a81c7a17f305bd51e6a912105cad755b544133');
  function outside(text){for(const [start,end] of [['function reviewerReaction(','function interviewEvaluation('],
    ['export function parseRecruitmentMessages(','function calendarTitleNamesPerson(']]){
      const from=text.indexOf(start),to=text.indexOf(end,from);assert.ok(from>=0&&to>from);
      assert.equal(text.indexOf(start,from+start.length),-1);text=text.slice(0,from)+text.slice(to);}return text;}
  assert.equal(outside(base),outside(current));
  assert.equal(createHash('sha256').update(read('server.js')).digest('hex'),'e345f9f11ff3bd14bd6417b011e9bc584dbcb676efd2acc82d162c0257adc39c');
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
test('recalled source is absent rather than a live identity alternative',()=>{
  const value=parse([submit({messageId:'om_fixtureOld',deleted:true}),submit(),review()]);
  assert.equal(value.submissionMessageCounts[name],1);assert.equal(value.candidates[0].stage,'interview_pass');
});
test('semantic OK repeats and emoji/operator aliases stay stable',()=>{
  const a=submit(),b=submit({reactions:{details:[{emoji_type:'OK',operator:{open_id:reviewer}},{emojiType:'OK',operatorId:reviewer}]}});
  const value=parse([a,b,review()]);assert.equal(value.submissionMessageCounts[name],1);assert.equal(value.funnel.groupPassedCount,1);
});
test('retained media in exact copies does not manufacture duplicate identity',()=>{
  const a=submit({resources:[{type:'image',key:'synthetic_only'}]});
  const value=parse([a,structuredClone(a),review()]);assert.equal(value.submissionMessageCounts[name],1);
  assert.equal(value.funnel.groupPassedCount,1);
});
