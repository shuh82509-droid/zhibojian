// Independent synthetic review: extract only the journal reader + assessment function into VM.
// Never import/start server.js, call an OAuth grant, read a real journal or make an external request.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {structuredAssessmentSummary,structuredAssessmentForCandidate} from './lifecycle-engine.mjs';

const base=new URL('.',import.meta.url),read=name=>readFileSync(new URL(name,base),'utf8');
const original=read('server.original.js'),candidate=read('server.js');
const hash=source=>createHash('sha256').update(source).digest('hex');
const normalize=value=>JSON.parse(JSON.stringify(value));
const clone=structuredClone;
const name='合成人选',cycle='2026-09',sourceId='om_synthetic_submission';
const assessors={ou_synthetic_a:'合成甲方',ou_synthetic_b:'合成乙方'};
const candidateRow=(extra={})=>({name,inSubmissionCohort:true,submissionEvidence:{sourceId},assessmentPassed:null,stage:'submitted',status:'Synthetic awaiting verification',...extra});
const entry=(actor,outcome,extra={})=>({id:`00000000-0000-0000-0000-${actor==='ou_synthetic_a'?'000000000001':'000000000002'}`,cycleMonth:cycle,candidateName:name,submissionMessageId:sourceId,actorOpenId:actor,actorName:assessors[actor],outcome,source:'structured_self_confirmation',createdAt:'2026-09-28T08:00:00.000Z',...extra});

function extract(source){
 const from=source.indexOf('async function readRecruitmentAssessmentJournal() {');
 const to=source.indexOf('async function refreshRecruitmentLifecycle(',from);
 assert.ok(from>=0&&to>from);return source.slice(from,to);
}
function harness(source,{entries=[],journalError,privateMode='ready'}={}){
 const counts={journalReads:0,privateLoad:0,privateApply:0,oauthAttempts:0};
 class SyntheticFeishuError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}}
 const context={
  recruitmentAssessmentPath:'SYNTHETIC-JOURNAL-NOT-A-REAL-PATH',verifiedAssessmentAssessorOpenIds:assessors,
  structuredAssessmentSummary,structuredAssessmentForCandidate,FeishuError:SyntheticFeishuError,
  readFile:async()=>{counts.journalReads++;if(journalError)throw journalError;return JSON.stringify({schemaVersion:1,entries:clone(entries)});},
  privateAssessmentSource:{load:async()=>{counts.privateLoad++;counts.oauthAttempts++;if(privateMode==='throw')throw Error('Private OAuth must not be consumed');return {state:privateMode,reason:'Synthetic private source unavailable'};}},
  applyPrivateAssessments:rows=>{counts.privateApply++;return privateMode==='ready'?{candidates:rows.map(row=>({...row,assessmentPassed:true,assessmentEvidenceStatus:'Synthetic one-party private score 100'})),summary:{passedCount:rows.length},status:'Synthetic private-ready bypass'}:null;}
 };
 vm.runInNewContext(`${extract(source)}\n globalThis.reviewFunction=addStructuredAssessments;`,context,{timeout:1000});
 return {counts,run:(rows=[candidateRow()],chatComplete=true)=>context.reviewFunction(rows,cycle,chatComplete)};
}
function noPrivate(h){assert.equal(h.counts.privateLoad,0);assert.equal(h.counts.privateApply,0);assert.equal(h.counts.oauthAttempts,0);assert.equal(h.counts.journalReads,1);}

test('exact current server / unchanged engine hashes and only intended replacement bytes',()=>{
 assert.equal(hash(original),'4d1942968455c1f2ad4ed5f0a359802b3036677495cc90b441405c6efb0bf1ef');
 assert.equal(hash(candidate),'f7545c1eacbee95ae021d897e0fde4b160c182365562f39a1871cedd9f759abe');
 assert.equal(hash(read('lifecycle-engine.mjs')),'5880b010e1a780dea100ab8b3447fb8603d534901df998ce8abbfa9ade4e9cf0');
 const expected=original.replace('  const privateSource=await privateAssessmentSource.load();\n  const privateResult=applyPrivateAssessments(candidates,privateSource,{chatComplete});\n  if(privateResult)return privateResult;\n\n','  // No automatic private-chat evaluation; structured confirmation is independently checked below.\n')
  .replace('`${privateSource.reason}；当前招聘周期尚无结构化双人确认记录。`',"'指定私聊未读取；当前招聘周期尚无结构化双人确认记录。'");
 assert.equal(candidate,expected);
 const fn=extract(candidate);assert.doesNotMatch(fn,/privateAssessmentSource\.|applyPrivateAssessments\(|privateResult|privateSource\.reason/u);
});

test('old exact function reproduces private-ready bypass of OA, candidate removes that route',async()=>{
 const old=harness(original),fixed=harness(candidate);
 const oldResult=await old.run(),fixedResult=await fixed.run();
 assert.equal(oldResult.candidates[0].assessmentPassed,true);assert.equal(old.counts.journalReads,0);assert.equal(old.counts.privateLoad,1);
 assert.equal(fixedResult.candidates[0].assessmentPassed,null);assert.equal(fixedResult.summary,null);noPrivate(fixed);
});

const blockedCases=[
 ['empty OA journal',[]],
 ['only assessor A pass',[entry('ou_synthetic_a','pass')]],
 ['only assessor A fail',[entry('ou_synthetic_a','fail')]],
 ['opposite OA conclusions',[entry('ou_synthetic_a','pass'),entry('ou_synthetic_b','fail')]],
 ['duplicate same actor',[entry('ou_synthetic_a','pass'),entry('ou_synthetic_a','pass',{id:'00000000-0000-0000-0000-000000000003'})]],
 ['valid signatures wrong cycle',[entry('ou_synthetic_a','pass',{cycleMonth:'2026-08'}),entry('ou_synthetic_b','pass',{cycleMonth:'2026-08'})]],
 ['valid signatures wrong source',[entry('ou_synthetic_a','pass',{submissionMessageId:'om_other_synthetic'}),entry('ou_synthetic_b','pass',{submissionMessageId:'om_other_synthetic'})]],
 ['valid signatures wrong name',[entry('ou_synthetic_a','pass',{candidateName:'其他人选'}),entry('ou_synthetic_b','pass',{candidateName:'其他人选'})]],
 ['journal unknown actor',[entry('ou_synthetic_a','pass'),entry('ou_synthetic_unknown','pass',{actorName:'合成未知'})]],
 ['journal actor name mismatch',[entry('ou_synthetic_a','pass'),entry('ou_synthetic_b','pass',{actorName:'错误署名'})]],
 ['journal non-OA source',[entry('ou_synthetic_a','pass',{source:'synthetic_private_score'}),entry('ou_synthetic_b','pass')]],
];
for(const [label,entries] of blockedCases)test(`one-party private score cannot override ${label}`,async()=>{
 const h=harness(candidate,{entries}),rows=[candidateRow()],before=clone(rows),result=await h.run(rows);
 assert.equal(result.candidates[0].assessmentPassed,null);assert.deepEqual(rows,before);noPrivate(h);
 if(label==='opposite OA conclusions'||label==='duplicate same actor'){
  assert.equal(result.summary.conflictCount,1);assert.equal(result.summary.passedCount,0);assert.match(result.candidates[0].assessmentEvidenceStatus,/冲突/u);
 }
 if(label==='only assessor A pass'||label==='only assessor A fail'){
  assert.equal(result.summary.awaitingCount,1);assert.equal(result.summary.passedCount,0);assert.match(result.candidates[0].assessmentEvidenceStatus,/两位/u);
 }
});
for(const outcome of ['pass','fail'])for(const stage of ['submitted','hired'])test(`unique matching OA ${outcome}/${outcome} at ${stage} preserves original OA result`,async()=>{
 const entries=[entry('ou_synthetic_a',outcome),entry('ou_synthetic_b',outcome)],rows=[candidateRow({stage})];
 const fixed=harness(candidate,{entries,privateMode:'throw'}),oldOA=harness(original,{entries,privateMode:'unavailable'});
 const result=await fixed.run(rows),expected=await oldOA.run(rows);
 assert.deepEqual(normalize(result),normalize(expected));assert.equal(result.candidates[0].assessmentPassed,outcome==='pass');
 assert.equal(result.candidates[0].assessmentEvidence.length,2);assert.equal(result.summary[outcome==='pass'?'passedCount':'failedCount'],1);noPrivate(fixed);
});
test('complete OA pass cannot bypass incomplete recruitment-source flag through private-ready',async()=>{
 const h=harness(candidate,{entries:[entry('ou_synthetic_a','pass'),entry('ou_synthetic_b','pass')]}),result=await h.run([candidateRow()],false);
 assert.equal(result.summary,null);assert.equal(result.candidates[0].assessmentPassed,null);assert.match(result.status,/不完整/u);noPrivate(h);
});
test('journal read failure remains pending without private load or OAuth consumption',async()=>{
 const h=harness(candidate,{journalError:Error('Synthetic unreadable OA journal')}),result=await h.run();
 assert.equal(result.summary,null);assert.equal(result.candidates[0].assessmentPassed,null);assert.match(result.status,/待核验/u);noPrivate(h);
});
test('same submission reused by two candidates cannot count unique double pass',async()=>{
 const h=harness(candidate,{entries:[entry('ou_synthetic_a','pass'),entry('ou_synthetic_b','pass')]}),result=await h.run([candidateRow(),candidateRow({name:'其他人选'})]);
 assert.equal(result.summary.passedCount,0);assert.equal(result.summary.conflictCount,2);
 assert.ok(result.candidates.every(row=>row.assessmentPassed===null));noPrivate(h);
});
for(const mode of ['journal unreadable','empty journal','source incomplete'])test(`document unchanged legacy boundary, not full normalization: ${mode}`,async()=>{
 const options=mode==='journal unreadable'?{journalError:Error('Synthetic old readback fault')}:{entries:mode==='source incomplete'?[entry('ou_synthetic_a','pass'),entry('ou_synthetic_b','pass')]:[]};
 const rows=[candidateRow({assessmentPassed:true,assessmentEvidenceStatus:'Synthetic pre-existing input value'})];
 const h=harness(candidate,options),result=await h.run(rows,mode!=='source incomplete');
 assert.equal(result.summary,null);assert.equal(result.candidates[0].assessmentPassed,true);noPrivate(h);
 // This existing input pass-through is intentionally recorded as an unchanged NO-GO boundary.
 // It is not evidence of OA confirmation and is not newly fixed by deleting private source calls.
});
