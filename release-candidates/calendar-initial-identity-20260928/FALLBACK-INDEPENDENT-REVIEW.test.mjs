// Independent synthetic fixtures only. No default server, OAuth, real journal or network call.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {structuredAssessmentSummary,structuredAssessmentForCandidate,assessmentSubmissionFor,parseRecruitmentMessages} from './lifecycle-engine.mjs';
import * as oldEngine from './lifecycle-engine.original.mjs';

const base=new URL('.',import.meta.url),read=file=>readFileSync(new URL(file,base),'utf8');
const server=read('server.js'),original=read('server.original.js');
const clone=structuredClone,plain=value=>JSON.parse(JSON.stringify(value));
const NAME='周小雨',OTHER='林小满',CYCLE='2026-10',ID='om_synthetic_submission';
const assessors={ou_synthetic_a:'合成甲方',ou_synthetic_b:'合成乙方'};
const row=(extra={})=>({name:NAME,inSubmissionCohort:true,submissionEvidence:{sourceId:ID},assessmentPassed:null,assessmentEvidence:[],assessmentEvidenceStatus:'Synthetic pending',stage:'interview_pass',status:'面试通过 · 待入职',date:'2026-09-28',startDate:'2026-09-30',actualStartDate:null,media:[{url:'synthetic-no-fetch',type:'image'}],timeline:[['2026-09-27','Synthetic immutable business event']],note:'Synthetic business note retained',source:'synthetic_business_source',...extra});
const identity=(extra={})=>({submissionMessageCounts:{[NAME]:1},dailyNames:{'2026-09-28':[NAME]},coverage:{capped:false,chatMessages:1},...extra});
const sign=(actor,outcome,extra={})=>({id:`00000000-0000-0000-0000-${actor==='ou_synthetic_a'?'000000000001':'000000000002'}`,cycleMonth:CYCLE,candidateName:NAME,submissionMessageId:ID,actorOpenId:actor,actorName:assessors[actor],outcome,source:'structured_self_confirmation',createdAt:'2026-09-28T08:00:00.000Z',...extra});
const pair=(outcome='pass')=>[sign('ou_synthetic_a',outcome),sign('ou_synthetic_b',outcome)];

function extracted(source){
 const from=source.indexOf('async function readRecruitmentAssessmentJournal() {'),to=source.indexOf('async function refreshRecruitmentLifecycle(',from);
 assert.ok(from>=0&&to>from);return source.slice(from,to);
}
function harness({entries=[],error,raw,source=server}={}){
 const counts={journal:0,privateLoad:0,privateApply:0,oauth:0};
 class FixtureError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}}
 const context={recruitmentAssessmentPath:'FICTIONAL-JOURNAL-ONLY',verifiedAssessmentAssessorOpenIds:assessors,
  structuredAssessmentSummary,structuredAssessmentForCandidate,FeishuError:FixtureError,
  readFile:async(path,encoding)=>{counts.journal++;assert.equal(path,'FICTIONAL-JOURNAL-ONLY');assert.equal(encoding,'utf8');if(error)throw error;return raw??JSON.stringify({schemaVersion:1,entries:clone(entries)});},
  privateAssessmentSource:{load:async()=>{counts.privateLoad++;counts.oauth++;throw Error('Synthetic private/OAuth access prohibited');}},
  applyPrivateAssessments:()=>{counts.privateApply++;throw Error('Synthetic private override prohibited');},
 };
 vm.runInNewContext(`${extracted(source)}\nglobalThis.reviewFunction=addStructuredAssessments;`,context,{timeout:1000});
 return {counts,run:(rows=[row()],complete=true,sourceIdentity=identity())=>context.reviewFunction(rows,CYCLE,complete,sourceIdentity)};
}
function privateZero(h){assert.equal(h.counts.privateLoad,0);assert.equal(h.counts.privateApply,0);assert.equal(h.counts.oauth,0);assert.equal(h.counts.journal,1);}
const facts=['name','inSubmissionCohort','submissionEvidence','stage','date','startDate','actualStartDate','media','timeline','note','source','assessmentReported'];
function preserved(before,after){for(const key of facts)if(Object.hasOwn(before,key))assert.deepEqual(plain(after[key]),plain(before[key]),`business fact ${key} preserved`);}
function reset(before,after){
 preserved(before,after);assert.equal(after.assessmentPassed,null);assert.deepEqual(plain(after.assessmentEvidence),[]);
 assert.match(after.assessmentEvidenceStatus,/待|无法|冲突|须核验|不允许|不完整|不能/u);assert.ok(!after.assessmentDisplayStatus||/待|无法|冲突|须核验|不允许|不完整|不能/u.test(after.assessmentDisplayStatus));
 assert.doesNotMatch(after.status,/(?:考核|考评|双人确认)[^·；;]*(?:通过|已拒绝)/u);
}

test('both source files remain valid offline targets; no private reader in exact assessment slice',()=>{
 assert.doesNotMatch(extracted(server),/privateAssessmentSource\.|applyPrivateAssessments\(/u);
 assert.equal(createHash('sha256').update(original).digest('hex'),'4d1942968455c1f2ad4ed5f0a359802b3036677495cc90b441405c6efb0bf1ef');
 assert.equal(createHash('sha256').update(server).digest('hex'),'e345f9f11ff3bd14bd6417b011e9bc584dbcb676efd2acc82d162c0257adc39c');
 assert.equal(createHash('sha256').update(read('lifecycle-engine.original.mjs')).digest('hex'),'5880b010e1a780dea100ab8b3447fb8603d534901df998ce8abbfa9ade4e9cf0');
 assert.equal(createHash('sha256').update(read('lifecycle-engine.mjs')).digest('hex'),'54271b172fdf96b903fab2187bc717244422ac02184da45ccb926cf068d95954');
});

const invalidContexts=[
 ['missing identity',undefined],['null identity',null],
 ['missing count map',identity({submissionMessageCounts:undefined})],
 ['missing name count',identity({submissionMessageCounts:{}})],
 ['withdrawn zero count',identity({submissionMessageCounts:{[NAME]:0}})],
 ['two source count',identity({submissionMessageCounts:{[NAME]:2}})],
 ['string count',identity({submissionMessageCounts:{[NAME]:'1'}})],
 ['NaN count',identity({submissionMessageCounts:{[NAME]:NaN}})],
 ['inherited count',identity({submissionMessageCounts:Object.create({[NAME]:1})})],
 ['missing daily names',identity({dailyNames:undefined})],
 ['empty daily names',identity({dailyNames:{}})],
 ['two submission dates',identity({dailyNames:{'2026-09-27':[NAME],'2026-09-28':[NAME]}})],
 ['same daily name repeated',identity({dailyNames:{'2026-09-28':[NAME,NAME]}})],
 ['illegal daily date',identity({dailyNames:{'not-a-date':[NAME]}})],
 ['format-valid impossible calendar date',identity({dailyNames:{'2026-09-31':[NAME]}})],
 ['daily names malformed value',identity({dailyNames:{'2026-09-28':NAME}})],
 ['daily names invalid member',identity({dailyNames:{'2026-09-28':[NAME,3]}})],
 ['daily names invalid unrelated row',identity({dailyNames:{'2026-09-28':[NAME],'2026-09-27':null}})],
 ['daily names empty unrelated array',identity({dailyNames:{'2026-09-28':[NAME],'2026-09-27':[]}})],
 ['daily names sparse array hole',identity({dailyNames:{'2026-09-28':Object.assign(new Array(2),{0:NAME})}})],
 ['missing coverage',identity({coverage:undefined})],
 ['capped source',identity({coverage:{capped:true,chatMessages:1}})],
 ['no source messages',identity({coverage:{capped:false,chatMessages:0}})],
];
for(const [label,sourceIdentity] of invalidContexts)test(`old double pass cannot survive ${label}`,()=>{
 const candidates=[row()],before=clone(candidates);
 const summary=structuredAssessmentSummary(candidates,pair(),CYCLE,assessors,sourceIdentity);
 assert.equal(summary.passedCount,0);assert.equal(summary.failedCount,0);
 assert.ok(Object.values(summary.bySubmission).every(item=>item.passed===null));assert.deepEqual(candidates,before);
 const snapshot={candidates,...(sourceIdentity||{})};
 const result=assessmentSubmissionFor(snapshot,{candidateName:NAME,submissionMessageId:ID,outcome:'pass'});
 assert.notEqual(result.status,'ready');
});
for(const count of [2,0])for(const outcome of ['pass','fail'])test(`retained journal double ${outcome} count${count} is pending at summary and candidate readback`,()=>{
 const summary=structuredAssessmentSummary([row()],pair(outcome),CYCLE,assessors,identity({submissionMessageCounts:{[NAME]:count}}));
 assert.equal(summary.passedCount,0);assert.equal(summary.failedCount,0);
 const verified=structuredAssessmentForCandidate(summary,row(),CYCLE);
 assert.ok(verified===null||verified.passed===null);
});
test('collapsed-name exact old audit reproduction moves old double-pass readback to pending',()=>{
 const reviewer='ou_synthetic_reviewer';
 const submit=(id,date)=>({messageId:id,createdAt:date,type:'text',sender:{id:'ou_synthetic_submitter'},text:`面试官好，麻烦看一下求职者【${NAME}】是否符合【主播】的邀约标准`,reactions:{details:[{emojiType:'OK',operatorId:reviewer}]}});
 const parsed=parseRecruitmentMessages([submit('om_synthetic_old','2026-09-26T01:00:00.000Z'),submit(ID,'2026-09-28T01:00:00.000Z')],{reviewerOpenId:reviewer});
 assert.equal(parsed.candidates.length,1);assert.equal(parsed.submissionMessageCounts[NAME],2);
 const oldParsed=oldEngine.parseRecruitmentMessages([submit('om_synthetic_old','2026-09-26T01:00:00.000Z'),submit(ID,'2026-09-28T01:00:00.000Z')],{reviewerOpenId:reviewer});
 const old=oldEngine.structuredAssessmentSummary(oldParsed.candidates,pair(),CYCLE,assessors);assert.equal(old.passedCount,1);
 assert.equal(parsed.candidates[0].submissionEvidence.sourceId,'');assert.equal(parsed.candidates[0].stage,'unmapped');
 const sourceIdentity={submissionMessageCounts:parsed.submissionMessageCounts,dailyNames:parsed.dailyNames,coverage:{capped:false,chatMessages:2}};
 const summary=structuredAssessmentSummary(parsed.candidates,pair(),CYCLE,assessors,sourceIdentity);
 assert.equal(summary.passedCount,0);assert.equal(summary.failedCount,0);
 assert.ok(Object.values(summary.bySubmission).every(item=>item.passed===null));
 assert.notEqual(assessmentSubmissionFor({candidates:parsed.candidates,...sourceIdentity},{candidateName:NAME,submissionMessageId:ID,outcome:'pass'}).status,'ready');
});
for(const [label,candidates,sourceIdentity] of [
 ['same name two sources',[row(),row({submissionEvidence:{sourceId:'om_synthetic_second'}})],identity({submissionMessageCounts:{[NAME]:2}})],
 ['same source two people',[row(),row({name:OTHER})],identity({submissionMessageCounts:{[NAME]:1,[OTHER]:1},dailyNames:{'2026-09-28':[NAME,OTHER]}})],
 ['duplicate candidate row',[row(),row()],identity()],
])test(`unique signature cannot pass identity collision: ${label}`,()=>{
 const summary=structuredAssessmentSummary(candidates,pair(),CYCLE,assessors,sourceIdentity);
 assert.equal(summary.passedCount,0);assert.equal(summary.failedCount,0);assert.ok(Object.values(summary.bySubmission).every(item=>item.passed===null));
});
for(const outcome of ['pass','fail'])test(`unique real helper source context keeps double ${outcome} path and new-sign identity ready`,()=>{
 const candidates=[row()],sourceIdentity=identity(),summary=structuredAssessmentSummary(candidates,pair(outcome),CYCLE,assessors,sourceIdentity);
 assert.equal(summary[outcome==='pass'?'passedCount':'failedCount'],1);assert.equal(structuredAssessmentForCandidate(summary,candidates[0],CYCLE).passed,outcome==='pass');
 assert.equal(assessmentSubmissionFor({candidates,...sourceIdentity},{candidateName:NAME,submissionMessageId:ID,outcome}).status,'ready');
});

const noOACases=[
 ['missing journal',{error:Object.assign(Error('Synthetic missing'),{code:'ENOENT'})},true,identity()],
 ['unreadable journal',{error:Error('Synthetic I/O failure')},true,identity()],
 ['bad journal',{raw:'{broken synthetic JSON'},true,identity()],
 ['empty journal',{},true,identity()],
 ['unmatched journal',{entries:pair().map(item=>({...item,submissionMessageId:'om_synthetic_other'}))},true,identity()],
 ['incomplete recruitment source',{entries:pair()},false,identity({coverage:{chatMessages:1,capped:true}})],
 ['identity ambiguous old signature',{entries:pair()},true,identity({submissionMessageCounts:{[NAME]:2}})],
 ['identity absent old signature',{entries:pair()},true,null],
];
for(const dirtyFlag of [true,false])for(const [label,options,complete,sourceIdentity] of noOACases)test(`dirty ${dirtyFlag} resets assessment but preserves business facts: ${label}`,async()=>{
 const input=row({assessmentPassed:dirtyFlag,assessmentEvidence:[{recordId:'synthetic_stale_record',actorName:'Stale'}],assessmentEvidenceStatus:'旧考核通过',assessmentDisplayStatus:'旧考核通过',assessmentReported:true,stage:'hired',actualStartDate:'2026-09-27',status:`已入职 · 结构化双人确认考核${dirtyFlag?'通过':'未通过'}`}),before=clone(input);
 const h=harness(options),result=await h.run([input],complete,sourceIdentity);
 reset(before,result.candidates[0]);assert.deepEqual(input,before);privateZero(h);
});
for(const status of ['初审通过','面试通过 · 待入职','面评通过','已入职'])test(`non-assessment business status ${status} survives pending reset`,async()=>{
 const input=row({status}),h=harness(),result=await h.run([input]);assert.equal(result.candidates[0].status,status);preserved(input,result.candidates[0]);privateZero(h);
});
for(const outcome of ['pass','fail'])for(const stage of ['interview_pass','hired'])test(`valid current double ${outcome} replaces dirty stale evidence without changing ${stage} facts`,async()=>{
 const input=row({stage,assessmentPassed:outcome==='fail',assessmentEvidence:[{recordId:'stale-only'}],assessmentEvidenceStatus:'Stale conclusion',assessmentDisplayStatus:'Stale display',status:stage==='hired'?'已入职 · 旧考核通过':'结构化双人确认考核通过'}),before=clone(input);
 const h=harness({entries:pair(outcome)}),result=await h.run([input]);preserved(before,result.candidates[0]);
 assert.equal(result.candidates[0].assessmentPassed,outcome==='pass');assert.equal(result.candidates[0].assessmentEvidence.length,2);
 assert.ok(result.candidates[0].assessmentEvidence.every(item=>item.recordId!=='stale-only'));assert.equal(result.candidates[0].assessmentDisplayStatus,'');
 assert.deepEqual(input,before);privateZero(h);
});

// Source-extracted POST orchestration with fictional inputs and in-memory writes only.
// This checks common identity/readback wiring, not real login, lock, CAS or durability.
function submitHarness(sourceIdentity=identity(),outcome='pass'){
 const from=server.indexOf('async function submitStructuredAssessment(req,auth) {'),to=server.indexOf('async function lifecycleApi(',from);
 assert.ok(from>=0&&to>from);
 const snapshot={candidates:[row()],...sourceIdentity},journal={schemaVersion:1,entries:[sign('ou_synthetic_a',outcome)]};
 const calls={contact:0,lock:0,journal:0,write:0,finalSnapshot:0};
 const context={URL,recruitmentAssessmentEnabled:true,verifiedAssessmentAssessorOpenIds:assessors,verifiedAssessmentEmployeeNos:{'FD-999998':'ou_synthetic_b'},
  recruitmentAssessmentPath:'FICTIONAL-POST-JOURNAL-ONLY',FeishuError:class extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}},
  centralFeishuOpenId:()=> 'ou_synthetic_b',
  readRequestJson:async()=>({cycleMonth:CYCLE,candidateName:NAME,submissionMessageId:ID,outcome}),
  recruitmentCycleRange:cycle=>{assert.equal(cycle,CYCLE);},recruitmentCycleSnapshot:async()=>snapshot,
  assessmentSubmissionFor,verifiedLiveCenterPerson:async()=>{calls.contact++;},
  recruitmentAssessmentLock:{run:async callback=>{calls.lock++;return callback();}},
  readRecruitmentAssessmentJournal:async()=>{calls.journal++;return journal;},
  writeJsonAtomic:async(path,value)=>{calls.write++;assert.equal(path,'FICTIONAL-POST-JOURNAL-ONLY');assert.equal(value,journal);},
  randomUUID:()=> '00000000-0000-0000-0000-000000000002',
  structuredAssessmentSummary:(rows,entries,cycle,actors,current)=>{assert.equal(current,snapshot);calls.finalSnapshot++;return structuredAssessmentSummary(rows,entries,cycle,actors,current);},
  structuredAssessmentForCandidate,
 };
 vm.runInNewContext(`${server.slice(from,to)}\nglobalThis.reviewSubmit=submitStructuredAssessment;`,context,{timeout:1000});
 const req={headers:{origin:'https://synthetic.invalid',host:'synthetic.invalid','sec-fetch-site':'same-origin','x-requested-with':'XMLHttpRequest','content-type':'application/json'}};
 return {calls,run:()=>context.reviewSubmit(req,{user:{number:'FD-999998'}})};
}
for(const outcome of ['pass','fail'])test(`actual submit source uses same unique predicate and fifth-argument snapshot on double ${outcome} readback`,async()=>{
 const h=submitHarness(identity(),outcome),result=await h.run();
 assert.equal(result.confirmation.passed,outcome==='pass');assert.equal(result.confirmation.signed.length,2);
 assert.deepEqual(h.calls,{contact:1,lock:1,journal:1,write:1,finalSnapshot:1});
});
for(const [label,sourceIdentity] of [
 ['same-name source count2',identity({submissionMessageCounts:{[NAME]:2}})],
 ['incomplete coverage',identity({coverage:{capped:true,chatMessages:1}})],
 ['missing authoritative count map',identity({submissionMessageCounts:undefined})],
])test(`actual submit source blocks ${label} before contact/lock/in-memory write`,async()=>{
 const h=submitHarness(sourceIdentity);await assert.rejects(h.run(),error=>error.code==='assessment_source_unverified'&&error.status===409);
 assert.deepEqual(h.calls,{contact:0,lock:0,journal:0,write:0,finalSnapshot:0});
});
