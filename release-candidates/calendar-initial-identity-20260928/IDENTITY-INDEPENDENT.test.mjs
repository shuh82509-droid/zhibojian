// Independent synthetic source/identity fixtures only. Never import server or real state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const candidatePath=process.env.WIS_IDENTITY_REVIEW_ENGINE;
assert.ok(candidatePath,'Set WIS_IDENTITY_REVIEW_ENGINE to the explicitly selected pure candidate engine. No default target.');
const engineBytes=readFileSync(candidatePath);
const engineSha=createHash('sha256').update(engineBytes).digest('hex');
const engine=await import(pathToFileURL(candidatePath).href);
const {parseRecruitmentMessages,mergeRecruitmentCandidates,parseEmploymentMessages,structuredAssessmentSummary,assessmentSubmissionFor}=engine;
const REVIEWER='ou_syntheticReviewer',OTHER_USER='ou_syntheticUnrelated',NAME='周小雨',OTHER='林小满';
const SOURCE='om_syntheticSubmission',SECOND='om_syntheticSubmission2',STAMP='2026-09-28T08:00:00.000Z';
const plain=structuredClone;
const reaction=(emoji,operatorId=REVIEWER)=>({emojiType:emoji,operatorId});
const submissionText=name=>`面试官好，麻烦看一下求职者【${name}】是否符合【主播】的邀约标准`;
const submit=(name=NAME,extra={})=>({messageId:SOURCE,createdAt:STAMP,type:'text',sender:{id:'ou_syntheticSubmitter'},text:submissionText(name),reactions:{details:[reaction('OK')]},...extra});
const review=(passed=true,extra={})=>({messageId:'om_syntheticReview',createdAt:'2026-09-28T09:00:00.000Z',type:'text',sender:{id:REVIEWER},text:`${NAME}\n颜值 8\n面试结果：${passed?'通过':'不通过'}`,...extra});
const offer=(extra={})=>({messageId:'om_syntheticOffer',createdAt:'2026-09-28T10:00:00.000Z',type:'text',sender:{id:'ou_syntheticSubmitter'},text:`新人主播-${NAME}接受offer 9.30待入职`,...extra});
const parse=rows=>parseRecruitmentMessages(rows,{reviewerOpenId:REVIEWER});
const person=(result,name=NAME)=>{const hit=result.candidates.find(item=>item.name===name);assert.ok(hit,`synthetic ${name} remains visible`);return hit;};
function countsPending(result,people=1){
 assert.equal(result.funnel.initialPassedCount,0);assert.equal(result.funnel.initialFailedCount,0);
 assert.equal(result.funnel.initialPendingCount,people);assert.equal(result.funnel.groupEvaluatedCount,0);assert.equal(result.funnel.groupPassedCount,0);
}
function identityPending(result,name=NAME){
 const hit=person(result,name);
 assert.ok(!['initial_pass','initial_fail','interview_pass','interview_fail','pending_feedback','hired'].includes(hit.stage),`identity held stage ${hit.stage}`);
 assert.equal(hit.submissionEvidence?.sourceId,'');assert.equal(hit.submissionEvidence?.initialReview,null);
 assert.ok(hit.evaluationEvidence?.passed!==true&&hit.evaluationEvidence?.passed!==false);
 assert.equal(assessmentSubmissionFor({...result,coverage:{capped:false,chatMessages:20}},{candidateName:name,submissionMessageId:SOURCE,outcome:'pass'}).status,'pending');
}
function safeInitial(result,expected){
 const hit=person(result);assert.equal(hit.stage,expected);assert.equal(hit.submissionEvidence.sourceId,SOURCE);
 assert.equal(result.funnel.groupEvaluatedCount,0);assert.equal(result.funnel.groupPassedCount,0);
}

test('candidate explicit SHA pin (when caller freezes SHA)',()=>{if(process.env.WIS_IDENTITY_REVIEW_SHA)assert.equal(engineSha,process.env.WIS_IDENTITY_REVIEW_SHA);});
for(const emoji of ['OK','No'])test(`unique full submission ${emoji} keeps legitimate initial result`,()=>{
 const result=parse([submit(NAME,{reactions:{details:[reaction(emoji)]}})]),hit=person(result);
 assert.equal(hit.submissionEvidence.initialReview,emoji);assert.equal(hit.stage,emoji==='OK'?'initial_pass':'initial_fail');
 assert.equal(result.submissionMessageCounts[NAME],1);assert.equal(result.funnel[emoji==='OK'?'initialPassedCount':'initialFailedCount'],1);
 assert.equal(result.funnel.initialPendingCount,0);
});
for(const passed of [true,false])test(`unique OK permits legitimate single interview ${passed?'pass':'fail'}`,()=>{
 const result=parse([submit(),review(passed)]);assert.equal(person(result).stage,passed?'interview_pass':'interview_fail');
 assert.equal(result.funnel.groupEvaluatedCount,1);assert.equal(result.funnel.groupPassedCount,passed?1:0);
});
test('unique OK permits scheduled offer without inventing actual onboarding',()=>{
 const result=parse([submit(),offer()]),hit=person(result);assert.equal(hit.stage,'interview_pass');assert.equal(hit.startDate,'2026-09-30');assert.ok(!hit.actualStartDate);
});
for(const details of [[reaction('OK'),reaction('No')],[reaction('No'),reaction('OK')],[reaction('OK'),reaction('OK'),reaction('No')]])test(`reviewer dual reaction is pending regardless of order ${JSON.stringify(details.map(x=>x.emojiType))}`,()=>{
 const result=parse([submit(NAME,{reactions:{details}}),review(),offer()]);identityPending(result);countsPending(result);assert.equal(result.submissionMessageCounts[NAME],1);
});
test('same approved reaction repeated and unrelated negative do not change unique OK',()=>{
 const result=parse([submit(NAME,{reactions:{details:[reaction('No',OTHER_USER),reaction('OK'),reaction('OK')]}})]);
 safeInitial(result,'initial_pass');assert.equal(result.funnel.initialPassedCount,1);
});
test('exact repeated page is not a second identity or second submission count',()=>{
 const source=submit(),result=parse([source,plain(source),plain(source),review()]);
 assert.equal(result.submissionMessageCounts[NAME],1);assert.equal(result.submittedCount,1);assert.equal(result.dailyCounts['2026-09-28'],1);
 assert.equal(person(result).stage,'interview_pass');assert.equal(result.funnel.initialPassedCount,1);assert.equal(result.funnel.groupPassedCount,1);
});
test('same ID page reaction-order difference with same reviewer semantics is stable',()=>{
 const a=submit(NAME,{reactions:{details:[reaction('OK'),reaction('No',OTHER_USER)]}}),b=plain(a);b.reactions.details.reverse();
 const result=parse([a,b,review()]);assert.equal(person(result).stage,'interview_pass');assert.equal(result.submissionMessageCounts[NAME],1);
});

const duplicateMutations=[
 ['different valid submission body',a=>({...a,text:`${a.text}\n合成不同正文`})],
 ['now non-submission body',a=>({...a,text:'该内容已经变更，无法核验'})],
 ['now empty body',a=>({...a,text:''})],
 ['same-day exact timestamp drift',a=>({...a,createdAt:'2026-09-28T08:00:01.000Z'})],
 ['different day drift',a=>({...a,createdAt:'2026-09-27T08:00:00.000Z'})],
 ['missing date copy',a=>({...a,createdAt:''})],
 ['invalid date copy',a=>({...a,createdAt:'not-a-time'})],
 ['reaction flip',a=>({...a,reactions:{details:[reaction('No')]}})],
 ['reaction becomes missing',a=>({...a,reactions:{details:[]}})],
 ['reaction becomes dual',a=>({...a,reactions:{details:[reaction('OK'),reaction('No')]}})],
 ['same ID now other candidate',a=>({...a,text:submissionText(OTHER)})],
];
for(const [label,change] of duplicateMutations)for(const reversed of [false,true])test(`same ID conflicting page ${label}; order ${reversed?'reverse':'forward'}`,()=>{
 const a=submit(),b=change(plain(a)),rows=reversed?[b,a]:[a,b],result=parse([...rows,review(),offer()]);
 identityPending(result);assert.equal(result.submissionMessageCounts[NAME],1);assert.equal(result.funnel.initialPassedCount,0);assert.equal(result.funnel.groupPassedCount,0);
 if(label==='same ID now other candidate')identityPending(result,OTHER);
});
for(const reversed of [false,true])test(`same name distinct source IDs is pending after pass/fail/offer; order ${reversed?'reverse':'forward'}`,()=>{
 const a=submit(),b=submit(NAME,{messageId:SECOND,createdAt:'2026-09-27T08:00:00.000Z'}),result=parse([...(reversed?[b,a]:[a,b]),review(true),review(false,{messageId:'om_syntheticReview2',createdAt:'2026-09-28T09:30:00Z'}),offer()]);
 identityPending(result);countsPending(result);assert.equal(result.submissionMessageCounts[NAME],2);
});
test('one submission ID with two recognized names freezes both scope members',()=>{
 const result=parse([submit(NAME,{text:`${submissionText(NAME)}\n${submissionText(OTHER)}`}),review(),offer()]);
 identityPending(result);identityPending(result,OTHER);countsPending(result,2);
 assert.equal(result.submissionMessageCounts[NAME],1);assert.equal(result.submissionMessageCounts[OTHER],1);
});
for(const [label,extra] of [
 ['no ID',{messageId:''}],['invalid ID',{messageId:'invalid_submission'}],
 ['no date',{createdAt:''}],['invalid date',{createdAt:'invalid_timestamp'}],
 ['truncated submission text',{textTruncated:true}],
])test(`incomplete recognized source ${label} remains pending despite later review/offer`,()=>{
 const result=parse([submit(NAME,extra),review(),offer()]);identityPending(result);countsPending(result);
});
for(const [label,extra] of [['no ID',{messageId:''}],['no date',{messageId:SECOND,createdAt:''}],['invalid date',{messageId:SECOND,createdAt:'invalid_timestamp'}],['truncated text',{messageId:SECOND,textTruncated:true}]])test(`valid same-name source does not erase incomplete record ${label}`,()=>{
 const result=parse([submit(),submit(NAME,extra),review(),offer()]);identityPending(result);countsPending(result);
});
for(const emoji of [null,'No'])for(const later of ['pass','fail','offer'])test(`unique initial ${emoji||'pending'} cannot be overridden by ${later}`,()=>{
 const source=submit(NAME,{reactions:{details:emoji?[reaction(emoji)]:[]}}),laterRow=later==='offer'?offer():review(later==='pass'),result=parse([source,laterRow]);
 safeInitial(result,emoji==='No'?'initial_fail':'unmapped');assert.equal(person(result).submissionEvidence.initialReview,emoji);
 assert.equal(result.funnel.initialPassedCount,0);assert.equal(result.funnel.initialFailedCount,emoji==='No'?1:0);assert.equal(result.funnel.initialPendingCount,emoji===null?1:0);
});
test('ambiguity freezes only affected identity; other unique candidate still advances',()=>{
 const result=parse([submit(),submit(NAME,{messageId:SECOND}),submit(OTHER,{messageId:'om_syntheticOther'}),review(),review(true,{messageId:'om_syntheticOtherReview',text:`${OTHER}\n颜值 8\n面试结果：通过`})]);
 identityPending(result);assert.equal(person(result,OTHER).stage,'interview_pass');assert.equal(result.funnel.initialPassedCount,1);assert.equal(result.funnel.initialPendingCount,1);assert.equal(result.funnel.groupPassedCount,1);
});
test('old OA double signature cannot revive blank source from parser identity conflict',()=>{
 const result=parse([submit(),submit(NAME,{messageId:SECOND}),review()]);
 const assessors={ou_syntheticA:'合成甲',ou_syntheticB:'合成乙'},entries=Object.keys(assessors).map((actorOpenId,index)=>({id:`synthetic_${index}`,cycleMonth:'2026-10',candidateName:NAME,submissionMessageId:SECOND,actorOpenId,outcome:'pass',createdAt:STAMP}));
 const summary=structuredAssessmentSummary(result.candidates,entries,'2026-10',assessors,{...result,coverage:{capped:false,chatMessages:3}});
 assert.equal(summary.passedCount,0);assert.equal(summary.failedCount,0);
});
test('independent onboarding facts survive recruitment identity hold after merge',()=>{
 const parsed=parse([submit(),submit(NAME,{messageId:SECOND}),review(),offer()]),employment=parseEmploymentMessages([{messageId:'om_syntheticEmployment',createdAt:'2026-09-28T11:00:00Z',sender:{id:REVIEWER},text:`新人主播-${NAME}已入职`}],{reviewerOpenId:REVIEWER});
 assert.equal(employment.candidates.length,1);const before=plain(employment.candidates[0]),merged=mergeRecruitmentCandidates(parsed.candidates,employment.candidates),hit=merged.find(item=>item.name===NAME);
 assert.equal(hit.stage,'hired');assert.equal(hit.actualStartDate,before.actualStartDate);assert.equal(hit.source,'WIS直播战队');
 for(const event of before.timeline)assert.ok(hit.timeline.some(item=>item[0]===event[0]&&item[1]===event[1]));
 assert.equal(hit.submissionEvidence.sourceId,'');assert.equal(hit.submissionEvidence.initialReview,null);assert.equal(parsed.funnel.groupPassedCount,0);
});
test('synthetic source records are not mutated by parser',()=>{const rows=[submit(),submit(NAME,{messageId:SECOND}),review(),offer()],before=plain(rows);parse(rows);assert.deepEqual(rows,before);});
