import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {structuredAssessmentSummary,assessmentSubmissionFor,parseRecruitmentMessages} from './lifecycle-engine.mjs';
import {structuredAssessmentSummary as oldSummary} from './lifecycle-engine.original.mjs';

const month='2026-10', name='测试甲', source='om_syntheticSubmission';
const assessors={ou_syntheticA:'审查甲',ou_syntheticB:'审查乙'};
const candidate=()=>({name,inSubmissionCohort:true,submissionEvidence:{sourceId:source},stage:'interview',hired:false});
const context=()=>({coverage:{chatMessages:true,capped:false},submissionMessageCounts:{[name]:1},dailyNames:{'2026-09-28':[name]}});
const signs=(outcomes=['pass','pass'])=>outcomes.map((outcome,index)=>({id:`synthetic_${index}`,actorOpenId:Object.keys(assessors)[index],cycleMonth:month,candidateName:name,submissionMessageId:source,outcome,createdAt:'2026-09-28T10:00:00Z'}));
const key=`${month}:${source}`;
function summary(ctx=context(),rows=[candidate()],entries=signs()) {return structuredAssessmentSummary(rows,entries,month,assessors,ctx);}
function blocked(ctx,rows=[candidate()],entries=signs()) {
  const result=summary(ctx,rows,entries);
  assert.equal(result.passedCount,0);assert.equal(result.failedCount,0);
  assert.equal(result.bySubmission[key]?.passed,null);
  assert.notEqual(assessmentSubmissionFor({...ctx,candidates:rows},{candidateName:name,submissionMessageId:source,outcome:'pass'}).status,'ready');
}
test('unchanged bytes outside the two targeted engine functions',()=>{
  const old=readFileSync(new URL('./lifecycle-engine.original.mjs',import.meta.url),'utf8');
  const current=readFileSync(new URL('./lifecycle-engine.mjs',import.meta.url),'utf8');
  function outside(text) {
    for(const [start,end] of [
      ['export function structuredAssessmentSummary(', '/** Resolve only an exact, verified OA number binding;'],
      ['export function assessmentSubmissionFor(', 'export function normalizeAnchorReport(']
    ]) {
      const from=text.indexOf(start),to=text.indexOf(end,from);
      assert.ok(from>=0&&to>from);text=text.slice(0,from)+text.slice(to);
    }
    return text;
  }
  assert.equal(outside(current),outside(old));
});
test('valid exact unique source keeps pass/pass',()=>{const result=summary();assert.equal(result.passedCount,1);assert.equal(result.bySubmission[key].passed,true);});
test('valid exact unique source keeps fail/fail',()=>{const result=summary(context(),[candidate()],signs(['fail','fail']));assert.equal(result.failedCount,1);assert.equal(result.bySubmission[key].passed,false);});
test('numeric actual message coverage is supported',()=>{const ctx=context();ctx.coverage.chatMessages=12;assert.equal(summary(ctx).passedCount,1);});
test('legacy four-argument helper no longer invents verified identity',()=>{const result=structuredAssessmentSummary([candidate()],signs(),month,assessors);assert.equal(result.passedCount,0);assert.equal(result.bySubmission[key].passed,null);});
for(const value of [0,2,-1,0.5,'1',null,undefined,NaN,Infinity])test(`count ${String(value)} never reuses old signatures`,()=>{const ctx=context();ctx.submissionMessageCounts[name]=value;blocked(ctx);});
test('missing count container is pending',()=>{const ctx=context();delete ctx.submissionMessageCounts;blocked(ctx);});
test('missing own count property is pending',()=>{const ctx=context();ctx.submissionMessageCounts={};blocked(ctx);});
test('inherited count1 is not authoritative source evidence',()=>{const ctx=context();ctx.submissionMessageCounts=Object.create({[name]:1});blocked(ctx);});
test('deduped candidate with two authoritative source messages cannot inherit old pass',()=>{
  const ctx=context();ctx.submissionMessageCounts[name]=2;
  assert.equal(oldSummary([candidate()],signs(),month,assessors).passedCount,1);
  blocked(ctx);
});
test('real parser duplicate-name external count is consumed by summary',()=>{
  const parsed=parseRecruitmentMessages([
    {messageId:'om_syntheticFirst',createdAt:'2026-09-28T01:00:00Z',text:'求职者【测试甲】是否符合【主播】的邀约标准'},
    {messageId:source,createdAt:'2026-09-28T02:00:00Z',text:'求职者【测试甲】是否符合【主播】的邀约标准'}
  ]);
  assert.equal(parsed.candidates.length,1);assert.equal(parsed.submissionMessageCounts[name],2);
  const ctx={...context(),submissionMessageCounts:parsed.submissionMessageCounts,dailyNames:parsed.dailyNames};
  blocked(ctx,parsed.candidates);
});
test('same name with distinct source rows is pending',()=>{const second=candidate();second.submissionEvidence.sourceId='om_syntheticSecond';blocked(context(),[candidate(),second]);});
test('one source cannot confirm multiple candidate names',()=>{const second=candidate();second.name='测试乙';const ctx=context();ctx.submissionMessageCounts[second.name]=1;ctx.dailyNames['2026-09-28'].push(second.name);blocked(ctx,[candidate(),second]);});
test('duplicate source candidate rows are ambiguous',()=>blocked(context(),[candidate(),candidate()]));
test('same source repeated on different dates is pending even with count1',()=>{const ctx=context();ctx.dailyNames['2026-09-29']=[name];blocked(ctx);});
test('an unrelated empty date row is not complete parser source',()=>{const ctx=context();ctx.dailyNames['2026-09-27']=[];blocked(ctx);});
test('sparse date array is not a complete legal name list',()=>{const ctx=context();ctx.dailyNames['2026-09-28']=Object.assign(new Array(2),{0:name});blocked(ctx);});
for(const daily of [undefined,{}, {'2026-09-28':[]}, {'2026-09-28':'测试甲'}, {'2026-09-28':[name,name]}, {'2026-02-30':[name]}, {'not-a-date':[name]}, {'2026-09-28':[name,123]}, {'2026-09-28':[name,'']}, {'2026-09-28':[name,'测试乙 ']}])test(`daily source fails closed: ${JSON.stringify(daily)}`,()=>{const ctx=context();ctx.dailyNames=daily;blocked(ctx);});
for(const coverage of [undefined,{}, {chatMessages:true}, {chatMessages:0,capped:false}, {chatMessages:'1',capped:false}, {chatMessages:true,capped:true}, {chatMessages:true,capped:'false'}])test(`coverage fails closed: ${JSON.stringify(coverage)}`,()=>{const ctx=context();ctx.coverage=coverage;blocked(ctx);});
test('one signature remains pending',()=>{const result=summary(context(),[candidate()],signs(['pass']));assert.equal(result.passedCount,0);assert.equal(result.bySubmission[key].passed,null);});
test('conflicting signatures remain pending',()=>{const result=summary(context(),[candidate()],signs(['pass','fail']));assert.equal(result.conflictCount,1);assert.equal(result.bySubmission[key].passed,null);});
test('duplicate signer journal rows remain ambiguous',()=>{const rows=signs();rows.push({...rows[0],id:'duplicate'});const result=summary(context(),[candidate()],rows);assert.equal(result.conflictCount,1);assert.equal(result.bySubmission[key].passed,null);});
for(const [field,value] of [['cycleMonth','2026-09'],['candidateName','测试乙'],['submissionMessageId','om_wrongSource'],['actorOpenId','ou_wrongActor']])test(`wrong ${field} cannot count old signatures`,()=>{const rows=signs().map(row=>({...row,[field]:value}));const result=summary(context(),[candidate()],rows);assert.equal(result.passedCount,0);assert.equal(result.failedCount,0);assert.equal(result.bySubmission[key].passed,null);});
test('readback does not mutate source rows/context/journal',()=>{const rows=[candidate()],ctx=context(),entries=signs();const before=JSON.stringify({rows,ctx,entries});summary(ctx,rows,entries);assert.equal(JSON.stringify({rows,ctx,entries}),before);});
