import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {structuredAssessmentSummary,structuredAssessmentForCandidate} from './lifecycle-engine.mjs';
import {structuredAssessmentSummary as originalSummary,structuredAssessmentForCandidate as originalForCandidate} from './lifecycle-engine.original.mjs';

// Pure source/VM fixtures only. Never import server.js or its default startup.
const originalBytes=await readFile(new URL('./server.original.js',import.meta.url));
const candidateBytes=await readFile(new URL('./server.js',import.meta.url));
const inheritedBytes=await readFile(new URL('./server.base.js',import.meta.url));
const frozenPins=JSON.parse(await readFile(new URL('./SOURCE-PINS.json',import.meta.url),'utf8'));
const originalEngineBytes=await readFile(new URL('./lifecycle-engine.original.mjs',import.meta.url));
const original=originalBytes.toString('utf8'),candidate=candidateBytes.toString('utf8');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value));
function slice(source,start,end) {
  const first=source.indexOf(start),last=source.indexOf(end,first);
  assert.ok(first>=0&&last>first,'exact source boundaries');
  assert.equal(source.indexOf(start,first+start.length),-1,'unique function boundary');
  return source.slice(first,last);
}
const assessmentSlice=source=>slice(source,'async function readRecruitmentAssessmentJournal() {','async function refreshRecruitmentLifecycle(');
const addSlice=source=>slice(source,'async function addStructuredAssessments(','async function refreshRecruitmentLifecycle(');
const CYCLE='2026-09',NAME='测试甲',SOURCE='om_fixture_submission';
const assessors={ou_fixture_a:'甲负责人',ou_fixture_b:'乙负责人'};
const uniqueIdentity=()=>({submissionMessageCounts:{[NAME]:1},dailyNames:{'2026-09-28':[NAME]},coverage:{chatMessages:true,capped:false}});
const row=(preset=null,overrides={})=>({
  name:NAME,stage:'hired',date:'2026-09-28',startDate:'2026-09-27',inSubmissionCohort:true,
  submissionEvidence:{sourceId:SOURCE,name:NAME,date:'2026-09-28',initialReview:'OK',source:'fictional recruitment source'},
  employmentEvidence:{sourceId:'om_fixture_employment',fact:'fictional entry report'},
  timeline:[['2026-09-27','合成历史：考核通过报告'],['2026-09-28','合成入职事实']],
  media:{url:'https://invalid.example/fictional-profile',label:'fixture only'},
  assessmentReported:true,assessmentPassed:preset,
  assessmentEvidence:[{source:'synthetic old private conclusion',recordId:'old-evidence'}],
  assessmentEvidenceStatus:preset===false?'考核未通过':'考核通过',
  assessmentDisplayStatus:'已入职 · 考核通过',
  status:preset===false?'已入职 · 考核未通过':'已入职 · 考核通过',
  ...overrides,
});
const sign=(actor,outcome,overrides={})=>({
  id:actor==='ou_fixture_a'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',
  cycleMonth:CYCLE,candidateName:NAME,submissionMessageId:SOURCE,actorOpenId:actor,actorName:assessors[actor],
  outcome,source:'structured_self_confirmation',createdAt:'2026-09-28T08:00:00.000Z',...overrides,
});
const pair=outcome=>[sign('ou_fixture_a',outcome),sign('ou_fixture_b',outcome)];
function harness(options={}) {
  const {source=candidate,entries=[],error,raw,privateMode='ready',helpers='candidate'}=options;
  const identity=Object.hasOwn(options,'identity')?options.identity:uniqueIdentity();
  const calls={journal:0,privateLoad:0,privateApply:0};
  const context={
    recruitmentAssessmentPath:'/offline-only/fictional-journal.json',verifiedAssessmentAssessorOpenIds:assessors,
    structuredAssessmentSummary:helpers==='original'?originalSummary:structuredAssessmentSummary,
    structuredAssessmentForCandidate:helpers==='original'?originalForCandidate:structuredAssessmentForCandidate,
    readFile:async(path,encoding)=>{calls.journal++;assert.equal(path,'/offline-only/fictional-journal.json');assert.equal(encoding,'utf8');if(error)throw error;return raw===undefined?JSON.stringify({schemaVersion:1,entries}):raw;},
    FeishuError:class extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}},
    privateAssessmentSource:{load:async()=>{calls.privateLoad++;return {state:privateMode,reason:'fictional private score 100'};}},
    applyPrivateAssessments:rows=>{calls.privateApply++;return privateMode==='ready'?{candidates:rows.map(candidate=>({...candidate,assessmentPassed:true})),summary:{passedCount:rows.length},status:'synthetic private override'}:null;},
  };
  const api=vm.runInNewContext(`${assessmentSlice(source)}\n({addStructuredAssessments})`,context,{timeout:1000});
  return {calls,run:(rows,complete=true)=>api.addStructuredAssessments(rows,CYCLE,complete,identity)};
}
const factKeys=['name','stage','date','startDate','inSubmissionCohort','submissionEvidence','employmentEvidence','timeline','media','assessmentReported'];
function assertFacts(before,after) {
  for(const key of factKeys)assert.deepEqual(after[key],before[key],`business fact preserved: ${key}`);
}
function assertPending(before,after,{evidenceCount=0}={}) {
  assertFacts(before,after);assert.equal(after.assessmentPassed,null);
  assert.equal(after.assessmentDisplayStatus,'');assert.equal(after.assessmentEvidence.length,evidenceCount);
  assert.ok(!JSON.stringify(after.assessmentEvidence).includes('old-evidence'),'old cached/private evidence cleared');
  assert.match(after.assessmentEvidenceStatus,/待|冲突|不完整|唯一|核验|不能/u);
  assert.doesNotMatch(after.status,/(?:考核|考评|双人确认)[^·；;，,]*(?:通过|不通过|拒绝)/u);
}
async function fixed(options,rows=[row(true)],complete=true) {
  const h=harness(options),before=structuredClone(rows),result=plain(await h.run(rows,complete));
  assert.equal(h.calls.privateLoad,0);assert.equal(h.calls.privateApply,0);assert.equal(h.calls.journal,1);
  assert.deepEqual(rows,before,'inputs remain unmodified');
  return {result,before,calls:h.calls};
}
test('actual original source pin; only target function and approved source-context callsites differ',()=>{
  assert.equal(sha(originalBytes),'4d1942968455c1f2ad4ed5f0a359802b3036677495cc90b441405c6efb0bf1ef');
  assert.equal(sha(candidateBytes),frozenPins['server.js']);
  assert.equal(sha(inheritedBytes),'e345f9f11ff3bd14bd6417b011e9bc584dbcb676efd2acc82d162c0257adc39c');
  assert.equal(sha(originalEngineBytes),'5880b010e1a780dea100ab8b3447fb8603d534901df998ce8abbfa9ade4e9cf0');
  const oldCallA='  const assessment=await addStructuredAssessments(merged,cycleMonth,!chatResult.value.truncated);';
  const newCallA='  const assessment=await addStructuredAssessments(merged,cycleMonth,!chatResult.value.truncated,{\n    submissionMessageCounts:parsed.submissionMessageCounts,dailyNames:parsed.dailyNames,\n    coverage:{chatMessages:true,capped:Boolean(chatResult.value.truncated)},\n  });';
  const oldCallB='  const assessment=await addStructuredAssessments(merged,cycle.month,!chat.truncated);';
  const newCallB='  const assessment=await addStructuredAssessments(merged,cycle.month,!chat.truncated,{\n    submissionMessageCounts:parsed.submissionMessageCounts,dailyNames:parsed.dailyNames,\n    coverage:{chatMessages:true,capped:Boolean(chat.truncated)},\n  });';
  const oldReadback='      structuredAssessmentSummary(snapshot.candidates,journal.entries,cycleMonth,verifiedAssessmentAssessorOpenIds),';
  const newReadback='      structuredAssessmentSummary(snapshot.candidates,journal.entries,cycleMonth,verifiedAssessmentAssessorOpenIds,snapshot),';
  for(const text of [addSlice(original),oldCallA,oldCallB,oldReadback])assert.equal(original.split(text).length,2);
  const expected=original.replace(addSlice(original),addSlice(candidate)).replace(oldCallA,newCallA).replace(oldCallB,newCallB).replace(oldReadback,newReadback);
  assert.equal(Buffer.compare(inheritedBytes,Buffer.from(expected)),0,'inherited OA fix remains exactly reconstructed from production');
  assert.equal(addSlice(candidate),addSlice(inheritedBytes.toString('utf8')),'group-A source edits never change OA assessment logic');
  assert.doesNotMatch(addSlice(candidate),/privateAssessmentSource|applyPrivateAssessments|privateSource/u);
});
test('synthetic original reproduces arbitrary pass fallback when no private-ready branch',async()=>{
  const h=harness({source:original,privateMode:'unavailable',helpers:'original'}),dirty=row(true);
  const result=await h.run([dirty]);assert.equal(result.candidates[0].assessmentPassed,true);assert.equal(result.summary,null);
});
const fallbackCases=[
  ['empty journal',{},true],
  ['missing journal',{error:Object.assign(new Error('fictional missing'),{code:'ENOENT'})},true],
  ['unreadable journal',{error:Object.assign(new Error('fictional IO fault'),{code:'EIO'})},true],
  ['invalid JSON',{raw:'invalid journal'},true],
  ['invalid schema',{raw:JSON.stringify({schemaVersion:2,entries:pair('pass')})},true],
  ['bad entry',{entries:[sign('ou_fixture_a','pass',{source:'private_chat'})]},true],
  ['wrong cycle',{entries:pair('pass').map(item=>({...item,cycleMonth:'2026-08'}))},true],
  ['wrong candidate',{entries:pair('pass').map(item=>({...item,candidateName:'测试乙'}))},true],
  ['wrong submission',{entries:pair('pass').map(item=>({...item,submissionMessageId:'om_fixture_other'}))},true],
  ['source incomplete',{entries:pair('pass'),identity:{...uniqueIdentity(),coverage:{chatMessages:true,capped:true}}},false],
];
for(const preset of [null,true,false])for(const [label,options,complete] of fallbackCases)test(`${label} clears preset ${preset} and cached assessment without business mutation`,async()=>{
  const dirty=row(preset);const {result}=await fixed(options,[dirty],complete);
  assertPending(dirty,result.candidates[0]);assert.equal(result.summary,null);
});
for(const [label,identity] of [
  ['missing source context',undefined],
  ['no source counts',{dailyNames:uniqueIdentity().dailyNames,coverage:uniqueIdentity().coverage}],
  ['multiple same-name submissions',{...uniqueIdentity(),submissionMessageCounts:{[NAME]:2}}],
  ['same name on multiple days',{...uniqueIdentity(),dailyNames:{'2026-09-27':[NAME],'2026-09-28':[NAME]}}],
  ['context coverage absent',{...uniqueIdentity(),coverage:{}}],
  ['context says no messages',{...uniqueIdentity(),coverage:{chatMessages:false,capped:false}}],
  ['context says capped',{...uniqueIdentity(),coverage:{chatMessages:true,capped:true}}],
])test(`${label} cannot revive dirty assessment from signed OA fixture`,async()=>{
  const dirty=row(true);const direct=harness({entries:pair('pass'),identity});
  const result=plain(await direct.run([dirty]));
  assert.equal(direct.calls.privateLoad,0);assert.equal(direct.calls.privateApply,0);
  assertPending(dirty,result.candidates[0]);assert.equal(result.summary?.passedCount,0);
});
for(const preset of [true,false])for(const outcome of ['pass','fail'])for(const stage of ['assessment','hired'])test(`unique matching two OA ${outcome} replaces preset ${preset} at ${stage} with original approved display`,async()=>{
  const dirty=row(preset,{stage});const {result}=await fixed({entries:pair(outcome)},[dirty]);
  const value=result.candidates[0];assertFacts(dirty,value);
  assert.equal(value.assessmentPassed,outcome==='pass');assert.equal(value.assessmentEvidence.length,2);
  assert.equal(value.assessmentDisplayStatus,'');
  assert.equal(value.status,stage==='hired'?`已入职 · 结构化双人确认考核${outcome==='pass'?'通过':'未通过'}`:`结构化双人确认考核${outcome==='pass'?'通过':'未通过'} · 入职待核验`);
  const h=harness({source:original,entries:pair(outcome),privateMode:'unavailable',helpers:'original'});
  const originalResult=plain(await h.run([dirty]));
  for(const key of ['assessmentPassed','assessmentEvidence','assessmentEvidenceStatus','status'])assert.deepEqual(value[key],originalResult.candidates[0][key]);
});
for(const [label,entries,expectedEvidence] of [
  ['one signer',[sign('ou_fixture_a','pass')],1],
  ['opposite conclusions',[sign('ou_fixture_a','pass'),sign('ou_fixture_b','fail')],2],
  ['duplicate signer',[...pair('pass'),sign('ou_fixture_a','pass',{id:'33333333-3333-4333-8333-333333333333'})],2],
])test(`${label} replaces stale dirty result with awaiting/conflict OA view`,async()=>{
  const dirty=row(false);const {result}=await fixed({entries},[dirty]);
  assertPending(dirty,result.candidates[0],{evidenceCount:expectedEvidence});
  assert.equal(result.summary.passedCount,0);assert.equal(result.summary.failedCount,0);
});
for(const status of ['已入职','面试通过 · 入职待核验','面评通过','初审通过 · 等待面试','已入职 · 面试通过 · 考核通过','已入职，考核通过','通过','未通过'])test(`status assessment cleanup preserves non-assessment facts: ${status}`,async()=>{
  const dirty=row(true,{status});const {result}=await fixed({},[dirty]);const value=result.candidates[0];
  assertPending(dirty,value);
  if(status==='已入职'||status==='面评通过'||status.startsWith('面试通过')||status.startsWith('初审通过'))assert.equal(value.status,status);
  if(status.includes('已入职'))assert.ok(value.status.includes('已入职'));
  if(status.includes('面试通过'))assert.ok(value.status.includes('面试通过'));
  if(status==='通过'||status==='未通过')assert.equal(value.status,'结构化双人确认考核待核验');
});
for(const reported of [true,false,'fictional-report'])test(`assessmentReported source fact preserved (${reported})`,async()=>{
  const dirty=row(false,{assessmentReported:reported});const {result}=await fixed({},[dirty]);assertPending(dirty,result.candidates[0]);
});
test('non-cohort dirty assessment is cleared but unrelated source facts remain',async()=>{
  const dirty=row(true,{inSubmissionCohort:false});const {result}=await fixed({entries:pair('pass')},[dirty]);
  assertPending(dirty,result.candidates[0]);assert.equal(result.summary,null);
});
function wireHarness(truncated) {
  const parsed={candidates:[row(null)],submissionMessageCounts:{[NAME]:2},dailyNames:{'2026-09-27':[NAME],'2026-09-28':[NAME]},funnel:{},interviewEvents:{},sourceDate:'2026-09-28'};
  const calls={assessment:[],writes:0};
  const context={
    structuredClone,recruitmentReviewerOpenId:'ou_fixture_a',
    recruitmentCycleMonthForDate:()=>CYCLE,recruitmentCycleRange:()=>({month:CYCLE,startDate:'2026-09-01',endDate:'2026-09-30'}),
    getChatMessages:async kind=>({messages:kind==='recruitment'?[{fictional:true}]:[],truncated:kind==='recruitment'?truncated:false}),
    getDocument:async()=>({content:'fictional'}),readRecruitmentCalendar:async()=>({events:{},status:'待核验：fictional only'}),
    parseRecruitmentMessages:()=>parsed,parseEmploymentMessages:()=>({candidates:[],sourceDate:''}),
    supplementalEmploymentCandidates:()=>[],mergeRecruitmentCandidates:rows=>rows,
    addStructuredAssessments:async(...args)=>{calls.assessment.push(args);return {candidates:args[0],summary:null,status:'fictional pending'};},
    linkVerifiedRecruitmentCalendar:rows=>({candidates:rows,matchedCount:null,pendingCount:0}),parseLatestCoachSummary:()=>null,
    lifecycleSourceStatus:()=>'partial',lifecycleSnapshotPath:()=>'/offline-only/fictional-snapshot',
    writeJsonAtomic:async path=>{assert.equal(path,'/offline-only/fictional-snapshot');calls.writes++;},
    truncateForModel:value=>String(value),
  };
  const refresh=slice(candidate,'async function refreshRecruitmentLifecycle(','async function readRecruitmentCalendar(');
  const snapshot=slice(candidate,'async function recruitmentCycleSnapshot(','const rankingCellText =');
  const api=vm.runInNewContext(`${refresh}\n${snapshot}\n({refreshRecruitmentLifecycle,recruitmentCycleSnapshot})`,context,{timeout:1000});
  return {api,calls,parsed};
}
for(const truncated of [false,true])for(const fn of ['refreshRecruitmentLifecycle','recruitmentCycleSnapshot'])test(`${fn} passes actual parse identity and truncation coverage (${truncated}) through extracted mock wire`,async()=>{
  const h=wireHarness(truncated);await h.api[fn](fn==='refreshRecruitmentLifecycle'?'2026-09-28':CYCLE);
  assert.equal(h.calls.assessment.length,1);const args=h.calls.assessment[0];
  assert.equal(args[2],!truncated);assert.strictEqual(args[3].submissionMessageCounts,h.parsed.submissionMessageCounts);
  assert.strictEqual(args[3].dailyNames,h.parsed.dailyNames);assert.deepEqual(plain(args[3].coverage),{chatMessages:true,capped:truncated});
  assert.equal(h.calls.writes,fn==='refreshRecruitmentLifecycle'?1:0,'fixture writer counter only, no filesystem write');
});
