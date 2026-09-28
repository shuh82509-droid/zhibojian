import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Offline only: evaluate the exact two server functions and three actual engine
// helpers, never the server entrypoint, imports, listeners, readers or timers.
const originalBytes=await readFile(new URL('./server.original.js',import.meta.url));
const candidateBytes=await readFile(new URL('./server.js',import.meta.url));
const engineBytes=await readFile(new URL('./lifecycle-engine.mjs',import.meta.url));
const original=originalBytes.toString('utf8');
const candidate=candidateBytes.toString('utf8');
const engine=engineBytes.toString('utf8');
const oldShortcut="  const privateSource=await privateAssessmentSource.load();\n  const privateResult=applyPrivateAssessments(candidates,privateSource,{chatComplete});\n  if(privateResult)return privateResult;\n\n";
const newComment="  // No automatic private-chat evaluation; structured confirmation is independently checked below.\n";
const oldStatus="    : !cycleEntries.length ? `${privateSource.reason}；当前招聘周期尚无结构化双人确认记录。`";
const newStatus="    : !cycleEntries.length ? '指定私聊未读取；当前招聘周期尚无结构化双人确认记录。'";
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function uniqueSlice(source,start,end) {
  const begin=source.indexOf(start),finish=source.indexOf(end,begin);
  assert.ok(begin>=0&&finish>begin,'exact source boundaries exist');
  assert.equal(source.indexOf(start,begin+start.length),-1,'source start is unique');
  return source.slice(begin,finish);
}
const helperCode=uniqueSlice(engine,'export function assessmentSubmissionKey(','/** Resolve only an exact, verified OA number binding;').replaceAll('export function ','function ');
const serverSlice=source=>uniqueSlice(source,'async function readRecruitmentAssessmentJournal() {','async function refreshRecruitmentLifecycle(');
const CYCLE='2026-09';
const assessors={ou_fixture_a:'甲负责人',ou_fixture_b:'乙负责人'};
const pending=overrides=>({name:'测试甲',stage:'assessment',inSubmissionCohort:true,submissionEvidence:{sourceId:'om_fixture_submission'},assessmentPassed:null,assessmentEvidenceStatus:'待核验',assessmentEvidence:[],status:'考核待核验',...overrides});
const sign=(actorOpenId,outcome,overrides={})=>({id:actorOpenId==='ou_fixture_a'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',cycleMonth:CYCLE,candidateName:'测试甲',submissionMessageId:'om_fixture_submission',actorOpenId,actorName:assessors[actorOpenId],outcome,source:'structured_self_confirmation',createdAt:'2026-09-28T08:00:00.000Z',...overrides});
const pair=outcome=>[sign('ou_fixture_a',outcome),sign('ou_fixture_b',outcome)];
function harness({source=candidate,journal={schemaVersion:1,entries:[]},error,raw,privateReady=true}={}) {
  const calls={read:0,privateLoad:0,privateApply:0};
  const context={
    recruitmentAssessmentPath:'/offline-only/fictional-journal.json',
    verifiedAssessmentAssessorOpenIds:assessors,
    readFile:async (path,encoding)=>{calls.read++;assert.equal(path,'/offline-only/fictional-journal.json');assert.equal(encoding,'utf8');if(error)throw error;return raw===undefined?JSON.stringify(journal):raw;},
    FeishuError:class extends Error {constructor(message,status,code){super(message);this.status=status;this.code=code;}},
    privateAssessmentSource:{load:async()=>{calls.privateLoad++;return {status:privateReady?'ready':'pending',reason:'synthetic private high score',score:100};}},
    applyPrivateAssessments:(candidates,privateSource)=>{calls.privateApply++;return privateSource.status==='ready'?{candidates:candidates.map(row=>({...row,assessmentPassed:true,assessmentEvidenceStatus:'synthetic private pass'})),summary:{passedCount:candidates.length},status:'synthetic private pass'}:null;},
  };
  const api=vm.runInNewContext(`${helperCode}\n${serverSlice(source)}\n({addStructuredAssessments,readRecruitmentAssessmentJournal})`,context,{timeout:1000});
  return {calls,api,run:async (rows=[pending()],complete=true,cycle=CYCLE)=>api.addStructuredAssessments(rows,cycle,complete)};
}
const plain=value=>JSON.parse(JSON.stringify(value));
async function runCandidate(options,rows,complete=true,cycle=CYCLE) {
  const h=harness(options);
  const result=await h.run(rows,complete,cycle);
  assert.equal(h.calls.privateLoad,0,'private source must never be loaded');
  assert.equal(h.calls.privateApply,0,'private conclusions must never be applied');
  assert.equal(result.privateOverview,undefined,'no private evidence is returned');
  return {result:plain(result),calls:h.calls};
}
test('actual source hashes and strict two-replacement byte boundary',()=>{
  assert.equal(sha(originalBytes),'4d1942968455c1f2ad4ed5f0a359802b3036677495cc90b441405c6efb0bf1ef');
  assert.equal(sha(engineBytes),'5880b010e1a780dea100ab8b3447fb8603d534901df998ce8abbfa9ade4e9cf0');
  assert.equal(original.split(oldShortcut).length,2);
  assert.equal(original.split(oldStatus).length,2);
  const expected=Buffer.from(original.replace(oldShortcut,newComment).replace(oldStatus,newStatus),'utf8');
  assert.equal(Buffer.compare(candidateBytes,expected),0,'all other server bytes remain exact');
  assert.equal(sha(candidateBytes),'f7545c1eacbee95ae021d897e0fde4b160c182365562f39a1871cedd9f759abe');
  assert.doesNotMatch(serverSlice(candidate),/privateAssessmentSource|applyPrivateAssessments|privateSource/u);
});
test('synthetic reference reproduces former ready-private bypass despite OA conflict',async()=>{
  const h=harness({source:original,journal:{schemaVersion:1,entries:[sign('ou_fixture_a','pass'),sign('ou_fixture_b','fail')]}});
  const result=await h.run();
  assert.equal(result.candidates[0].assessmentPassed,true);
  assert.equal(h.calls.privateLoad,1);assert.equal(h.calls.privateApply,1);assert.equal(h.calls.read,0);
});
for(const [label,outcomes,expected] of [
  ['two OA passes',['pass','pass'],true],
  ['two OA failures',['fail','fail'],false],
  ['OA conflict',['pass','fail'],null],
  ['inverse OA conflict',['fail','pass'],null],
  ['only first signer',['pass'],null],
  ['only first negative signer',['fail'],null],
])test(`${label}: ready high-score private cannot override structured outcome`,async()=>{
  const entries=outcomes.map((outcome,i)=>sign(i?'ou_fixture_b':'ou_fixture_a',outcome));
  const {result,calls}=await runCandidate({journal:{schemaVersion:1,entries}});
  assert.equal(calls.read,1);assert.equal(result.candidates[0].assessmentPassed,expected);
  assert.equal(result.candidates[0].assessmentEvidence.length,entries.length);
  assert.equal(result.summary.passedCount,expected===true?1:0);
  assert.equal(result.summary.failedCount,expected===false?1:0);
  if(expected===null)assert.match(result.candidates[0].assessmentEvidenceStatus,/冲突|待两位/u);
});
for(const outcome of ['pass','fail'])test(`two OA ${outcome}: hired status remains correctly labelled`,async()=>{
  const {result}=await runCandidate({journal:{schemaVersion:1,entries:pair(outcome)}},[pending({stage:'hired'})]);
  assert.equal(result.candidates[0].assessmentPassed,outcome==='pass');
  assert.match(result.candidates[0].status,new RegExp(`^已入职 · 结构化双人确认考核${outcome==='pass'?'通过':'未通过'}$`,'u'));
});
test('missing journal ENOENT remains pending and summary null',async()=>{
  const rows=[pending()];const {result}=await runCandidate({error:Object.assign(new Error('fixture missing'),{code:'ENOENT'})},rows);
  assert.deepEqual(result.candidates,rows);assert.equal(result.summary,null);assert.match(result.status,/尚无结构化双人确认/u);
});
test('empty journal remains pending without private fallback',async()=>{
  const rows=[pending()];const {result}=await runCandidate({},rows);
  assert.deepEqual(result.candidates,rows);assert.equal(result.summary,null);assert.match(result.status,/指定私聊未读取/u);
});
test('incomplete recruitment messages suppress even complete structured conclusions',async()=>{
  const rows=[pending()];const {result}=await runCandidate({journal:{schemaVersion:1,entries:pair('pass')}},rows,false);
  assert.deepEqual(result.candidates,rows);assert.equal(result.summary,null);assert.match(result.status,/消息不完整/u);
});
test('unreadable journal remains pending without fabricated zero totals',async()=>{
  const rows=[pending()];const {result}=await runCandidate({error:Object.assign(new Error('fixture IO failure'),{code:'EIO'})},rows);
  assert.deepEqual(result.candidates,rows);assert.equal(result.summary,null);assert.match(result.status,/记录待核验/u);
});
for(const [label,journal,raw] of [
  ['invalid JSON',undefined,'{"schemaVersion":'],
  ['null journal',null],
  ['wrong schema',{schemaVersion:2,entries:pair('pass')}],
  ['missing entries',{schemaVersion:1}],
  ['entries not array',{schemaVersion:1,entries:{}}],
  ['invalid record ID',{schemaVersion:1,entries:[sign('ou_fixture_a','pass',{id:'not-a-journal-id'})]}],
  ['invalid cycle',{schemaVersion:1,entries:[sign('ou_fixture_a','pass',{cycleMonth:'2026-13'})]}],
  ['invalid candidate',{schemaVersion:1,entries:[sign('ou_fixture_a','pass',{candidateName:'Fake English'})]}],
  ['invalid submission ID',{schemaVersion:1,entries:[sign('ou_fixture_a','pass',{submissionMessageId:'wrong-id'})]}],
  ['unknown signer',{schemaVersion:1,entries:[sign('ou_fixture_a','pass',{actorOpenId:'ou_fixture_unknown'})]}],
  ['mismatched signer name',{schemaVersion:1,entries:[sign('ou_fixture_a','pass',{actorName:'错误负责人'})]}],
  ['invalid outcome',{schemaVersion:1,entries:[sign('ou_fixture_a','pass',{outcome:'maybe'})]}],
  ['wrong evidence source',{schemaVersion:1,entries:[sign('ou_fixture_a','pass',{source:'private_chat'})]}],
  ['invalid timestamp',{schemaVersion:1,entries:[sign('ou_fixture_a','pass',{createdAt:'not-a-date'})]}],
  ['null entry',{schemaVersion:1,entries:[null]}],
])test(`bad journal (${label}) fails closed`,async()=>{
  const rows=[pending()];const {result}=await runCandidate({journal,raw},rows);
  assert.deepEqual(result.candidates,rows);assert.equal(result.summary,null);assert.match(result.status,/记录待核验/u);
});
for(const [label,overrides] of [
  ['other cycle',{cycleMonth:'2026-08'}],
  ['other candidate',{candidateName:'测试乙'}],
  ['other submission',{submissionMessageId:'om_fixture_other'}],
])test(`valid unrelated signatures (${label}) cannot confirm current candidate`,async()=>{
  const entries=pair('pass').map(entry=>({...entry,...overrides}));
  const rows=[pending()];const {result}=await runCandidate({journal:{schemaVersion:1,entries}},rows);
  assert.deepEqual(result.candidates,rows);assert.equal(result.summary,null);
});
test('duplicate signer is conflict and never private pass',async()=>{
  const entries=[...pair('pass'),sign('ou_fixture_a','pass',{id:'33333333-3333-4333-8333-333333333333'})];
  const {result}=await runCandidate({journal:{schemaVersion:1,entries}});
  assert.equal(result.candidates[0].assessmentPassed,null);assert.equal(result.summary.conflictCount,1);
});
test('one source shared by two candidates cannot be double-confirmed',async()=>{
  const rows=[pending(),pending({name:'测试乙'})];const {result}=await runCandidate({journal:{schemaVersion:1,entries:pair('pass')}},rows);
  assert.equal(result.summary.conflictCount,2);assert.equal(result.summary.passedCount,0);
  assert.equal(result.candidates[0].assessmentPassed,null);assert.equal(result.candidates[1].assessmentPassed,null);
});
test('non-cohort candidate is preserved without importing any private evidence',async()=>{
  const rows=[pending({inSubmissionCohort:false})];const {result}=await runCandidate({journal:{schemaVersion:1,entries:pair('pass')}},rows);
  assert.deepEqual(result.candidates,rows);assert.equal(result.summary,null);
});
test('journal entry and candidate inputs are not mutated',async()=>{
  const journal={schemaVersion:1,entries:pair('pass')};const rows=[pending()];
  const before=JSON.stringify({journal,rows});await runCandidate({journal},rows);
  assert.equal(JSON.stringify({journal,rows}),before);
});
// Explicit known limitation, not a safety pass: the narrow removal does not
// sanitize arbitrary already-populated assessmentPassed fields on fallback.
for(const [label,options,complete] of [
  ['empty journal',{},true],
  ['missing journal',{error:Object.assign(new Error('fixture missing'),{code:'ENOENT'})},true],
  ['bad journal',{raw:'invalid json'},true],
  ['incomplete messages',{journal:{schemaVersion:1,entries:pair('fail')}},false],
])test(`KNOWN UNRESOLVED fallback preserves prepopulated pass (${label})`,async()=>{
  const rows=[pending({assessmentPassed:true,assessmentEvidenceStatus:'synthetic prior evidence'})];
  const {result}=await runCandidate(options,rows,complete);
  assert.deepEqual(result.candidates,rows);assert.equal(result.summary,null);
  assert.equal(result.candidates[0].assessmentPassed,true,'documented existing fallback, not evidence of OA approval');
});
