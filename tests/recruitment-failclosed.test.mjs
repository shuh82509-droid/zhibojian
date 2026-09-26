import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {sanitizeRecruitmentOutcome,formalRecruitmentCalendarEvents} from '../interview-binding.mjs';
import {buildInterviewReminderPreview,recruitmentCycleRange} from '../lifecycle-engine.mjs';

const date='2026-09-24';
const formal={name:'周小雨正式面试 · 16:00',status:'calendar',source:'正式面试日历',eventId:'evt_one'};
const group={name:'周小雨面试通过',status:'interview_pass',source:'面评群消息'};
const candidate=()=>({name:'周小雨',inSubmissionCohort:true,stage:'interview_pass',status:'面试通过',
  note:'招聘群已发布面试通过结论。',date,source:'招聘群',startDate:'2026-10-01',
  submissionEvidence:{name:'周小雨',sourceId:'om_submission',date:'2026-09-23',initialReview:'OK'},
  calendarEvidence:{source:'正式面试日历',eventId:'evt_one',date,title:formal.name},
  evaluationEvidence:{passed:true,date,sourceId:'om_post'},
  timeline:[[date,'面试通过'] ]});
const snapshot=()=>({calendarStatus:'已连接：正式面试日历已读取 1 条详情事件。',
  coverage:{capped:false,reactionStatus:'已核验',chatMessages:2},status:'current',
  candidates:[candidate()],submissionMessageCounts:{周小雨:1},
  interviewEvents:{[date]:[group,formal]},
  funnel:{groupEvaluatedCount:1,groupPassedCount:1,hiredCount:1,
    interviewScheduledCount:1,interviewScheduledPendingCount:0}});

test('default binding OFF demotes group pass and Offer while retaining an attributed clue',()=>{
  const source=snapshot();
  const safe=sanitizeRecruitmentOutcome(source,{trustedFreshCalendar:true,trustedFreshChat:true});
  assert.equal(source.candidates[0].stage,'interview_pass','source object remains untouched');
  assert.equal(safe.candidates[0].stage,'pending_feedback');
  assert.equal(safe.candidates[0].calendarEvidence.eventId,'evt_one');
  assert.equal(safe.candidates[0].startDate,null);
  assert.equal(safe.candidates[0].evaluationEvidence,null);
  assert.equal(safe.candidates[0].unverifiedOutcome.reportedStage,'interview_pass');
  assert.equal(safe.candidates[0].unverifiedOutcome.reportedStartDate,'2026-10-01');
  assert.match(safe.candidates[0].timeline[0][1],/线索待核验/u);
  assert.equal(safe.funnel.groupEvaluatedCount,null);
  assert.equal(safe.funnel.groupPassedCount,null);
  assert.equal(safe.funnel.hiredCount,null);
  assert.equal(safe.status,'partial');
  assert.deepEqual(sanitizeRecruitmentOutcome(safe,{trustedFreshCalendar:true,trustedFreshChat:true}),safe);
});

test('old green disk snapshot, forged group calendar event and unsupported assessment become pending',()=>{
  const old=snapshot();
  old.candidates[0].stage='hired';
  old.candidates[0].status='已入职';
  old.candidates[0].actualStartDate='2026-09-24';
  old.candidates[0].assessmentPassed=true;
  old.candidates[0].interviewBinding={status:'verified',outcome:'pass',recordId:'old_record'};
  old.interviewBindings=[{status:'verified',submissionMessageId:'om_submission',recordId:'old_record'}];
  old.interviewEvents[date]=[{...formal,source:'面评群消息'},group];
  const safe=sanitizeRecruitmentOutcome(old);
  assert.equal(safe.candidates[0].stage,'initial_pass');
  assert.equal(safe.candidates[0].calendarEvidence,null);
  assert.equal(safe.candidates[0].actualStartDate,null);
  assert.equal(safe.candidates[0].assessmentPassed,null);
  assert.equal(safe.candidates[0].interviewBinding.status,'pending');
  assert.equal(safe.interviewBindings[0].status,'pending');
  assert.equal(safe.candidates[0].unverifiedOutcome.reportedActualStartDate,'2026-09-24');
  assert.equal(safe.funnel.assessmentPassedCount,null);
  assert.ok(safe.interviewEvents[date].every(item=>item.status==='pending_feedback'));
  assert.match(safe.calendarStatus,/^待核验：本次未重读正式面试日历/u);
  assert.equal(safe.funnel.interviewScheduledCount,null);
});

test('stored formal appointment remains a historical calendar clue, never a fresh connected calendar',()=>{
  const stored=snapshot();
  const safe=sanitizeRecruitmentOutcome(stored);
  assert.equal(safe.interviewEvents[date][1].source,'历史日历待复核');
  assert.equal(safe.interviewEvents[date][0].source,'招聘群面评线索');
  assert.match(safe.calendarStatus,/^待核验：/u);
  assert.equal(safe.candidates[0].calendarEvidence,null);
  assert.equal(safe.funnel.interviewScheduledCount,null);
});

test('old dual-assessment green state is downgraded, preserving only audit clues',()=>{
  const stored=snapshot();
  stored.candidates[0].stage='initial_pass';
  stored.candidates[0].status='结构化双人确认考核通过 · 入职待核验';
  stored.candidates[0].assessmentPassed=true;
  stored.candidates[0].assessmentEvidenceStatus='双人确认考核通过';
  stored.candidates[0].assessmentEvidence=[
    {actorName:'倪梦萍',outcome:'pass',at:'2026-09-24T09:00:00Z'},
    {actorName:'刘慧迅',outcome:'pass',at:'2026-09-24T10:00:00Z'}];
  stored.funnel.assessmentPassedCount=1;
  const safe=sanitizeRecruitmentOutcome(stored);
  assert.equal(safe.candidates[0].assessmentPassed,null);
  assert.equal(safe.candidates[0].assessmentEvidence,null);
  assert.match(safe.candidates[0].assessmentEvidenceStatus,/^待核验/u);
  assert.equal(safe.candidates[0].unverifiedOutcome.reportedAssessmentEvidenceStatus,'双人确认考核通过');
  assert.equal(safe.candidates[0].unverifiedOutcome.reportedAssessmentPassed,true);
  assert.equal(safe.candidates[0].unverifiedOutcome.reportedAssessmentEvidence.length,2);
  assert.equal(safe.funnel.assessmentPassedCount,null);
  assert.equal(safe.assessmentOutcomeVerification,'pending_revalidation');
  const current=sanitizeRecruitmentOutcome(stored,{trustedFreshCalendar:true,trustedFreshChat:true,
    trustedFreshAssessment:true});
  assert.equal(current.candidates[0].assessmentPassed,true);
  assert.equal(current.candidates[0].assessmentEvidenceStatus,'双人确认考核通过');
  assert.equal(current.assessmentOutcomeVerification,'current_structured_dual_review_v1');
});

test('fresh formal appointment alone is pending feedback, never an interview pass',()=>{
  const source=snapshot();
  source.interviewEvents[date]=[group,formal];
  const safe=sanitizeRecruitmentOutcome(source,{trustedFreshCalendar:true,trustedFreshChat:true});
  assert.equal(safe.candidates[0].stage,'pending_feedback');
  assert.equal(safe.interviewEvents[date][0].status,'pending_feedback');
  assert.equal(safe.interviewEvents[date][1].source,'正式面试日历');
  assert.equal(safe.funnel.groupPassedCount,null);
});

test('fresh, reverified self-binding may retain pass, but stale or source-changed binding may not',()=>{
  const signed=snapshot();
  signed.candidates[0].interviewBinding={status:'verified',outcome:'pass',recordId:'record_one'};
  signed.candidates[0].evaluationEvidence={passed:true,source:'本人结构化绑定',sourceId:'om_post'};
  const trusted=sanitizeRecruitmentOutcome(signed,{trustedFreshCalendar:true,trustedFreshChat:true,trustedFreshBinding:true});
  assert.equal(trusted.candidates[0].stage,'interview_pass');
  assert.equal(trusted.funnel.groupEvaluatedCount,1);
  assert.equal(trusted.funnel.groupPassedCount,1);
  assert.equal(trusted.candidates[0].startDate,null,'signed interview does not prove onboarding');
  const disk=sanitizeRecruitmentOutcome(signed);
  assert.equal(disk.candidates[0].stage,'initial_pass');
  const changed=structuredClone(signed);
  changed.interviewEvents[date][1].eventId='evt_changed';
  assert.equal(sanitizeRecruitmentOutcome(changed,{trustedFreshCalendar:true,trustedFreshChat:true,trustedFreshBinding:true})
    .candidates[0].stage,'initial_pass');
  const incomplete=structuredClone(signed);
  assert.equal(sanitizeRecruitmentOutcome(incomplete,{trustedFreshCalendar:true,trustedFreshChat:false,trustedFreshBinding:true})
    .candidates[0].stage,'initial_pass');
});

test('signed prior-cycle first-day pass is retained but excluded from current-cycle funnel',()=>{
  const carried=snapshot();
  carried.candidates[0].inSubmissionCohort=false;
  carried.candidates[0].boundaryCarryover=true;
  carried.candidates[0].interviewBinding={status:'verified',outcome:'pass',recordId:'carry_record'};
  carried.candidates[0].evaluationEvidence={passed:true,source:'本人结构化绑定',sourceId:'om_post'};
  carried.submissionMessageCounts={周小雨:0};
  carried.boundaryCarryover={status:'verified',submissionMessageCounts:{周小雨:1}};
  const safe=sanitizeRecruitmentOutcome(carried,{trustedFreshCalendar:true,trustedFreshChat:true,
    trustedFreshBinding:true});
  assert.equal(safe.candidates[0].stage,'interview_pass');
  assert.equal(safe.candidates[0].interviewBinding.status,'verified');
  assert.equal(safe.funnel.groupEvaluatedCount,0);
  assert.equal(safe.funnel.groupPassedCount,0);
});

test('17:00 preview rejects a group event disguised with calendar status',()=>{
  const source=snapshot();
  source.interviewEvents[date]=[{...formal,source:'面评群消息'}];
  assert.equal(buildInterviewReminderPreview(source,date).status,'pending');
});

test('fresh refresh persists only sanitized recruitment data, and cycle read does not expose group pass',async()=>{
  const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
  const chat={messages:[{},{}],sourceMessageCount:2,deletedMessageCount:0,truncated:false,
    reactionStatus:'已核验'};
  const parsed={candidates:[candidate()],cohortNames:['周小雨'],submissionMessageCounts:{周小雨:1},
    funnel:{groupEvaluatedCount:1,groupPassedCount:1},interviewEvents:{[date]:[group]},
    dailyCounts:{},dailyNames:{},submittedCount:1,sourceDate:date};
  const calendar={events:{[date]:[formal]},status:'已连接：正式面试日历已读取 1 条详情事件。'};
  let written=null;
  const context={recruitmentCycleMonthForDate:()=> '2026-09',recruitmentCycleRange,
    getChatMessages:async key=>key==='recruitment'?chat:{messages:[],truncated:false,sourceMessageCount:0},
    getDocument:async()=>({content:''}),readRecruitmentCalendar:async()=>calendar,
    parseRecruitmentMessages:()=>parsed,parseEmploymentMessages:()=>({candidates:[],sourceDate:''}),
    supplementalEmploymentCandidates:()=>[],addStructuredAssessments:async rows=>({candidates:rows,summary:null,status:'待核验'}),
    linkRecruitmentCalendarWithBoundary:async rows=>({candidates:rows,matchedCount:1,pendingCount:0,
      boundary:{status:'not_applicable'}}),parseLatestCoachSummary:()=>null,
    recruitmentReviewerOpenId:'ou_reviewer',interviewBindingEnabled:false,
    lifecycleSourceStatus:()=> 'current',recruitmentCalendarId:'calendar_official',
    readRecruitmentInterviewJournal:async()=>({entries:[]}),projectInterviewBindings:row=>row,
    sanitizeRecruitmentOutcome,formalRecruitmentCalendarEvents,completeRecruitmentChatSource:()=>true,
    lifecycleSnapshotPath:()=> '/unused',writeJsonAtomic:async(_,value)=>{written=value;},
    chinaDateFor:()=>date,structuredClone,Date};
  const refreshStart=source.indexOf('async function refreshRecruitmentLifecycle(');
  const refreshEnd=source.indexOf('\nlet recruitmentSnapshotReadInFlight',refreshStart);
  assert.ok(refreshStart>=0&&refreshEnd>refreshStart);
  const refresh=vm.runInNewContext(`${source.slice(refreshStart,refreshEnd)}\nrefreshRecruitmentLifecycle`,context);
  const result=await refresh(date);
  assert.equal(result.candidates[0].stage,'pending_feedback');
  assert.equal(result.funnel.groupPassedCount,null);
  assert.equal(written.candidates[0].stage,'pending_feedback');
  const cycleStart=source.indexOf('async function recruitmentCycleSnapshot(');
  const cycleEnd=source.indexOf('\nconst rankingCellText',cycleStart);
  assert.ok(cycleStart>=0&&cycleEnd>cycleStart);
  const cycle=vm.runInNewContext(`${source.slice(cycleStart,cycleEnd)}\nrecruitmentCycleSnapshot`,context);
  const read=await cycle('2026-09');
  assert.equal(read.candidates[0].stage,'pending_feedback');
  assert.equal(read.funnel.groupPassedCount,null);
});

test('status and refresh failure cannot replay a stored green recruitment result',async()=>{
  const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
  const old=snapshot();
  old.candidates[0].stage='hired';
  old.candidates[0].actualStartDate=date;
  const statusStart=source.indexOf('async function lifecycleStatus()');
  const statusEnd=source.indexOf('\nfunction canRefreshLifecycle(',statusStart);
  assert.ok(statusStart>=0&&statusEnd>statusStart);
  const status=vm.runInNewContext(`${source.slice(statusStart,statusEnd)}\nlifecycleStatus`,{
    readLifecycleSnapshot:async module=>module==='recruitment'?old:null,
    readJsonFile:async()=>[],lifecycleLogPath:'/unused',lifecycleState:{running:null,lastAttemptAt:null,lastError:null},
    lifecycleRefreshTimes:['09:30','18:00'],lifecycleSchedulerEnabled:false,sanitizeRecruitmentOutcome});
  const readback=await status();
  assert.equal(readback.modules.recruitment.status,'partial');
  assert.match(readback.modules.recruitment.coverage.interviewOutcomeStatus,/线索/u);
  const refreshStart=source.indexOf('async function refreshLifecycleModules(');
  const refreshEnd=source.indexOf('\nasync function lifecycleStatus()',refreshStart);
  assert.ok(refreshStart>=0&&refreshEnd>refreshStart);
  const state={running:null,lastAttemptAt:null,lastError:null};
  const refresh=vm.runInNewContext(`${source.slice(refreshStart,refreshEnd)}\nrefreshLifecycleModules`,{
    lifecycleState:state,lifecycleModules:['recruitment'],chinaDateFor:()=>date,
    feishuCache:{clear(){}},refreshRecruitmentLifecycle:async()=>{throw new Error('source unavailable');},
    readLifecycleSnapshot:async()=>old,sanitizeRecruitmentOutcome,
    appendLifecycleLog:async()=>{},lifecycleSnapshotPath:()=> '/unused',Date,
  });
  const failed=await refresh(['recruitment'],'manual');
  assert.equal(failed.results.recruitment.ok,false);
  assert.equal(failed.results.recruitment.data.candidates[0].stage,'initial_pass');
  assert.equal(failed.results.recruitment.data.funnel.groupPassedCount,null);
});

test('fresh, cycle, stored, status, refresh-failure and reminder-preview routes all use fail-closed data',async()=>{
  const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
  assert.match(source,/const safe=sanitizeRecruitmentOutcome\(verified,\{trustedFreshCalendar:/u);
  assert.match(source,/if\(persist\)await writeJsonAtomic\(lifecycleSnapshotPath\('recruitment'\), safe\)/u);
  assert.match(source,/return sanitizeRecruitmentOutcome\(verified,\{trustedFreshCalendar:/u);
  assert.match(source,/module==='recruitment' \? sanitizeRecruitmentOutcome\(storedPrevious\)/u);
  assert.match(source,/snapshotStatus\(sanitizeRecruitmentOutcome\(recruitment\)\)/u);
  assert.match(source,/data:sanitizeRecruitmentOutcome\(stored\)/u);
  assert.match(source,/buildInterviewReminderPreview\(await recruitmentCycleSnapshot\(cycleMonth\), date\)/u);
  assert.match(source,/source:'正式面试日历',eventId:/u);
});

test('calendar UI renders only labeled formal events, never group red or green',async()=>{
  const html=await readFile(new URL('../exports/recruitment-pool/recruitment-dashboard.html',import.meta.url),'utf8');
  const match=html.match(/function formalCalendarEventsFor\(date\)\{[\s\S]*?\n    \}/u);
  assert.ok(match);
  const events={[date]:[group,{...formal,source:'面评群消息'},formal]};
  const onlyFormal=vm.runInNewContext(`${match[0]}\nformalCalendarEventsFor`,{interviewEvents:events});
  assert.equal(onlyFormal(date).length,1);
  assert.equal(onlyFormal(date)[0].eventId,'evt_one');
  assert.match(html,/events=formalCalendarEventsFor\(key\)/u);
});

test('interview result lanes show unknown until self-binding counts are verified, then true zero',async()=>{
  const html=await readFile(new URL('../exports/recruitment-pool/recruitment-dashboard.html',import.meta.url),'utf8');
  const coverageCode=html.slice(html.indexOf('function verifiedRecruitmentCoverage('),html.indexOf('function renderKeyData('));
  const boardCode=html.slice(html.indexOf('function renderBoard()'),html.indexOf('function openDetail('));
  assert.ok(coverageCode.startsWith('function verifiedRecruitmentCoverage('));
  assert.ok(boardCode.startsWith('function renderBoard()'));
  const verifiedCoverage=vm.runInNewContext(`${coverageCode}\nverifiedRecruitmentCoverage`);
  const base={calendarStatus:'已连接：正式面试日历已读取 1 条详情事件。',
    interviewOutcomeVerification:'self_binding_required_v1',
    coverage:{capped:false,chatMessages:1,reactionStatus:'已核验'},
    funnel:{groupEvaluatedCount:null,groupPassedCount:null}};
  const off=verifiedCoverage(base);
  assert.equal(off.reviewReady,true);
  assert.equal(off.bindingOutcomeReady,false);
  const verified=verifiedCoverage({...base,funnel:{groupEvaluatedCount:0,groupPassedCount:0}});
  assert.equal(verified.bindingOutcomeReady,true);
  const selectors={'#search':{value:''},'#sourceFilter':{value:''},'#processFilter':{value:''},
    '#unmappedNote':{hidden:true,textContent:''},'#board':{innerHTML:''}};
  const document={querySelector:key=>selectors[key],querySelectorAll:()=>[]};
  const stages=[{id:'interview_fail',label:'面试不通过'},{id:'interview_pass',label:'面试通过'}];
  const render=vm.runInNewContext(`${boardCode}\nrenderBoard`,{document,cohortReady:true,
    candidates:[{name:'周小雨',stage:'interview_pass',status:'面试通过'}],stages,
    legacyStage:stage=>stage,verifiedRecruitmentCoverage:verifiedCoverage,
    lifecycleSnapshot:base,card:row=>`CARD:${row.name}`});
  render();
  assert.match(selectors['#board'].innerHTML,/面试通过<\/span><span class="count">待核验/u);
  assert.doesNotMatch(selectors['#board'].innerHTML,/CARD:周小雨/u);
  assert.doesNotMatch(selectors['#board'].innerHTML,/暂无候选人/u);
  const zeroContext={document,cohortReady:true,candidates:[],stages,legacyStage:stage=>stage,
    verifiedRecruitmentCoverage:verifiedCoverage,
    lifecycleSnapshot:{...base,funnel:{groupEvaluatedCount:0,groupPassedCount:0}},card:row=>`CARD:${row.name}`};
  vm.runInNewContext(`${boardCode}\nrenderBoard()`,zeroContext);
  assert.match(selectors['#board'].innerHTML,/面试通过<\/span><span class="count">0/u);
  assert.match(selectors['#board'].innerHTML,/暂无候选人/u);
});

test('assessment audit never paints a stored old confirmation green without fresh dual-source proof',async()=>{
  const html=await readFile(new URL('../exports/recruitment-pool/recruitment-dashboard.html',import.meta.url),'utf8');
  const assessmentCode=html.slice(html.indexOf('function renderAssessment()'),html.indexOf('async function loadAssessmentAccess('));
  assert.ok(assessmentCode.startsWith('function renderAssessment()'));
  const stored=snapshot();
  stored.candidates[0].assessmentPassed=true;
  stored.candidates[0].assessmentEvidenceStatus='双人确认考核通过';
  stored.candidates[0].assessmentEvidence=[{actorName:'倪梦萍',outcome:'pass'},
    {actorName:'刘慧迅',outcome:'pass'}];
  const safe=sanitizeRecruitmentOutcome(stored);
  const current=sanitizeRecruitmentOutcome(stored,{trustedFreshCalendar:true,trustedFreshChat:true,
    trustedFreshAssessment:true});
  const selectors=Object.fromEntries(['#assessmentGate','#assessmentOutcomes','#assessmentAttest',
    '#assessmentSubmit','#assessmentEvidence','#assessmentAudit'].map(key=>[key,{textContent:'',innerHTML:''}]));
  const assessmentCandidate={value:'',innerHTML:'',disabled:false};
  const document={querySelector:key=>selectors[key]};
  const context={document,assessmentCandidate,assessmentAccess:{enabled:true,identityVerified:false,
    lock:{state:'free'}},assessmentSubmitting:false,assessmentFeedback:{textContent:''},
    assessmentForm:{querySelector:()=>null},eligibleAssessmentCandidates:()=>[],esc:String,
    formatChinaTime:()=>'',lifecycleSnapshot:safe};
  const render=vm.runInNewContext(`${assessmentCode}\nrenderAssessment`,context);
  render();
  assert.doesNotMatch(selectors['#assessmentAudit'].innerHTML,/assessment-status done/u);
  assert.doesNotMatch(selectors['#assessmentAudit'].innerHTML,/双人确认考核通过/u);
  context.lifecycleSnapshot=current;
  render();
  assert.match(selectors['#assessmentAudit'].innerHTML,/assessment-status done/u);
  assert.match(selectors['#assessmentAudit'].innerHTML,/双人确认考核通过/u);
});
