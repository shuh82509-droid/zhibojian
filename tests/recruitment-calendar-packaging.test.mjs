import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {buildInterviewReminderPreview,linkVerifiedRecruitmentCalendar,
  recruitmentCycleMonthForDate,recruitmentCycleRange} from '../lifecycle-engine.mjs';
import {sanitizeRecruitmentOutcome} from '../interview-binding.mjs';

const read=async path=>readFile(new URL(path,import.meta.url),'utf8');

test('formal calendar keeps every character used for a signed interview binding',async()=>{
  const source=await read('../server.js');
  const start=source.indexOf('async function readRecruitmentCalendar(');
  const end=source.indexOf('\nasync function recruitmentCycleSnapshot(',start);
  assert.ok(start>=0&&end>start);
  let summary=`周小雨正式面试 ${'补充说明'.repeat(20)} 末尾可核对`;
  const event={event_id:'evt_long',summary,status:'confirmed',
    start_time:{timestamp:String(Date.parse('2026-09-24T07:30:00.000Z')/1000)},
    end_time:{timestamp:String(Date.parse('2026-09-24T08:30:00.000Z')/1000)}};
  const context={recruitmentCalendarId:'calendar_official',
    recruitmentCalendarReader:{status:async()=>({authorized:true}),get:async()=>({items:[{...event,summary}],has_more:false})},
    recruitmentCycleMonthForDate,URLSearchParams,Intl,Date,createHash};
  const reader=vm.runInNewContext(`${source.slice(start,end)}\nreadRecruitmentCalendar`,context);
  const cycle=recruitmentCycleRange('2026-09');
  const full=await reader(cycle);
  assert.match(full.status,/^已连接：/u);
  assert.ok(full.events['2026-09-24'][0].name.includes('末尾可核对'));
  assert.equal(full.events['2026-09-24'][0].source,'正式面试日历');
  assert.equal(full.events['2026-09-24'][0].summaryFingerprint,
    createHash('sha256').update(summary).digest('hex'));
  summary=`周小雨正式面试${'额'.repeat(501)}`;
  const blocked=await reader(cycle);
  assert.match(blocked.status,/^待核验：/u);
  assert.deepEqual(Object.keys(blocked.events),[]);
});

test('calendar date-scoped reminder isolates a later long title but never an undated interview',async()=>{
  const source=await read('../server.js');
  const start=source.indexOf('async function readRecruitmentCalendar(');
  const end=source.indexOf('\nasync function recruitmentCycleSnapshot(',start);
  assert.ok(start>=0&&end>start);
  const cycle=recruitmentCycleRange('2026-10');
  const valid={event_id:'evt_sep26',summary:'周小雨面试',status:'confirmed',
    start_time:{date:'2026-09-26'},end_time:{date:'2026-09-27'}};
  let items=[valid,{event_id:'evt_sep30',summary:`李小鱼面试${'额'.repeat(501)}`,
    status:'confirmed',start_time:{date:'2026-09-30'},end_time:{date:'2026-10-01'}}];
  const context={recruitmentCalendarId:'calendar_official',recruitmentCycleMonthForDate,
    recruitmentCalendarReader:{status:async()=>({authorized:true}),get:async()=>({items,has_more:false})},
    URLSearchParams,Intl,Date,createHash};
  const reader=vm.runInNewContext(`${source.slice(start,end)}\nreadRecruitmentCalendar`,context);
  const global=await reader(cycle);
  assert.match(global.status,/^待核验：/u);
  const day26=await reader(cycle,{targetDate:'2026-09-26'});
  assert.match(day26.status,/^已连接：/u);
  assert.equal(day26.calendarIssueCount,1,'the cycle remains partial despite the date-scoped read');
  assert.equal(day26.events['2026-09-26'].length,1);
  assert.equal(day26.events['2026-09-30'],undefined);
  const candidate={name:'周小雨',stage:'initial_pass',inSubmissionCohort:true,
    submissionEvidence:{name:'周小雨',sourceId:'om_submission',date:'2026-09-25',initialReview:'OK'}};
  const linked=linkVerifiedRecruitmentCalendar([candidate],day26.events,{周小雨:1},{sourceReady:true});
  const reminderSnapshot={cycle,calendarStatus:day26.status,
    coverage:{capped:false,chatMessages:1,reactionStatus:'已核验',chatSourceFingerprint:'a'.repeat(64)},
    candidates:linked.candidates,submissionMessageCounts:{周小雨:1},interviewEvents:day26.events};
  const preview=buildInterviewReminderPreview(reminderSnapshot,'2026-09-26');
  assert.equal(preview.status,'preview',preview.reason);
  const day30=await reader(cycle,{targetDate:'2026-09-30'});
  assert.match(day30.status,/^待核验：/u);
  assert.equal(buildInterviewReminderPreview({...reminderSnapshot,calendarStatus:day30.status,
    interviewEvents:day30.events},'2026-09-30').status,'pending');
  for(const malformed of [
    {event_id:'evt_undated',summary:'林小满面试',status:'confirmed'},
    {event_id:'evt_bad_date',summary:'林小满面试',status:'confirmed',start_time:{date:'2026-09-31'}},
    {event_id:'evt_bad_timestamp',summary:'林小满面试',status:'confirmed',start_time:{timestamp:'invalid'}},
  ]){
    items=[valid,malformed];
    assert.match((await reader(cycle,{targetDate:'2026-09-26'})).status,/^待核验：/u,
      'an unassignable interview can belong to today and blocks every date');
  }
});

test('calendar pagination requires an array, boolean has_more and unique continuation tokens',async()=>{
  const source=await read('../server.js');
  const start=source.indexOf('async function readRecruitmentCalendar(');
  const end=source.indexOf('\nasync function recruitmentCycleSnapshot(',start);
  const cycle=recruitmentCycleRange('2026-10');
  let pages=[];
  const context={recruitmentCalendarId:'calendar_official',recruitmentCycleMonthForDate,
    recruitmentCalendarReader:{status:async()=>({authorized:true}),get:async()=>pages.shift()},
    URLSearchParams,Intl,Date,createHash};
  const reader=vm.runInNewContext(`${source.slice(start,end)}\nreadRecruitmentCalendar`,context);
  const valid={event_id:'evt_valid',summary:'周小雨面试',status:'confirmed',
    start_time:{date:'2026-09-26'},end_time:{date:'2026-09-27'}};
  for(const bad of [
    {has_more:false},{items:{},has_more:false},{items:[],has_more:'false'},
    {items:[valid,null],has_more:false},{items:[valid,42],has_more:false},
    {items:[valid,'unexpected'],has_more:false},{items:[valid,[]],has_more:false},
    {items:[],has_more:true},{items:[],has_more:true,page_token:3},
  ]){
    pages=[bad];
    await assert.rejects(reader(cycle),/分页结构无法核验|未能完整翻页/u);
  }
  pages=[{items:[],has_more:true,page_token:'same'},
    {items:[],has_more:true,page_token:'same'}];
  await assert.rejects(reader(cycle),/未能完整翻页/u);
  pages=[{items:[],has_more:true,page_token:'first'},
    {items:[],has_more:false}];
  assert.match((await reader(cycle)).status,/^已连接：/u);
});

test('legacy recruitment overlay is blocked; current image manifests include all Calendar modules',async()=>{
  for(const file of ['../Dockerfile','../Dockerfile.live-hub-v3-main']){
    const dockerfile=await read(file);
    for(const module of ['server.js','lifecycle-engine.mjs','interview-binding.mjs',
      'durable-journal.mjs','reminder-gates.mjs']){
      assert.match(dockerfile,new RegExp(`COPY\\s+${module.replaceAll('.','\\.')}\\s`,'u'),`${file} lacks ${module}`);
    }
    assert.match(dockerfile,/COPY exports\/recruitment-pool\//u);
  }
  const legacy=await read('../Dockerfile.recruitment-resume-trend');
  const windows=await read('../deploy-recruitment-resume-trend.ps1');
  const linux=await read('../deploy-recruitment-resume-trend.sh');
  assert.match(legacy,/RUN[^\n]*DEPRECATED_RECRUITMENT_OVERLAY[^\n]*exit 64/u);
  assert.ok(windows.indexOf("throw 'DEPRECATED_RECRUITMENT_OVERLAY")<windows.indexOf('Push-Location'));
  assert.ok(linux.indexOf("exit 64")<linux.indexOf('archive='));
});

test('daily report facts remain independent of the recruitment cohort and hired count is unknown',async()=>{
  const source=await read('../server.js');
  assert.match(source,/const employmentFacts=supplementalEmploymentCandidates\(employment\.candidates\)/u);
  assert.match(source,/addStructuredAssessments\(parsed\.candidates,cycleMonth/u);
  assert.match(source,/addStructuredAssessments\(parsed\.candidates,cycle\.month/u);
  assert.equal((source.match(/hiredCount:null,/gu)||[]).length,2);
  assert.equal((source.match(/recruitmentAttributionSchemaVersion:1,/gu)||[]).length,2);
  assert.match(source,/stored\?\.recruitmentAttributionSchemaVersion!==1/u);
  assert.equal((source.match(/employmentAttributionStatus:'日报没有精确送审消息 ID/gu)||[]).length,2);
  const html=await read('../exports/recruitment-pool/recruitment-dashboard.html');
  assert.match(html,/snapshot\.employmentFacts/u);
  assert.match(html,/没有精确送审消息 ID，独立展示/u);
  assert.match(html,/hiredReady\?hiredCount:'待核验'/u);
});

test('same-name daily report arrival cannot promote a current-cycle submitted candidate',async()=>{
  const source=await read('../server.js');
  const start=source.indexOf('async function recruitmentCycleSnapshot(');
  const end=source.indexOf('\nconst rankingCellText =',start);
  assert.ok(start>=0&&end>start);
  const submitted={name:'周小雨',stage:'initial_pass',status:'初审通过',inSubmissionCohort:true,
    submissionEvidence:{sourceId:'om_current',initialReview:'OK'}};
  const daily={name:'周小雨',stage:'hired',status:'日报称已入职',sourceId:'om_daily',actualStartDate:'2026-09-24'};
  const chat={key:'recruitment',messages:[],sourceMessageCount:0,deletedMessageCount:0,
    truncated:false,reactionStatus:'已核验'};
  const context={recruitmentCycleRange,interviewBindingEnabled:false,
    getChatMessages:async key=>key==='recruitment'?chat:{messages:[],truncated:false,sourceMessageCount:0},
    readRecruitmentCalendar:async()=>({events:{},status:'已连接：正式面试日历已读取 0 条详情事件。'}),
    parseRecruitmentMessages:()=>({candidates:[submitted],cohortNames:['周小雨'],submissionMessageCounts:{周小雨:1},
      funnel:{candidateCount:1,groupEvaluatedCount:0,groupPassedCount:0},dailyCounts:{},dailyNames:{},
      interviewEvents:{},submittedCount:1,sourceDate:'2026-09-24'}),
    parseEmploymentMessages:()=>({candidates:[daily],sourceDate:'2026-09-24'}),
    supplementalEmploymentCandidates:items=>items.map(item=>({...item,submissionMessageId:'',inSubmissionCohort:false})),
    addStructuredAssessments:async candidates=>({candidates,summary:null,status:'待两人确认'}),
    linkRecruitmentCalendarWithBoundary:async candidates=>({candidates,matchedCount:0,pendingCount:0,
      boundary:{status:'verified'}}),
    recruitmentReviewerOpenId:'ou_reviewer',recruitmentCalendarId:'calendar_official',
    chinaDateFor:()=> '2026-09-24',structuredClone,Date,sanitizeRecruitmentOutcome,
     completeRecruitmentChatSource:()=>true,recruitmentChatSourceFingerprint:()=> 'a'.repeat(64),
  };
  const snapshot=vm.runInNewContext(`${source.slice(start,end)}\nrecruitmentCycleSnapshot`,context);
  const result=await snapshot('2026-09');
  assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].stage,'initial_pass');
  assert.equal(result.candidates[0].actualStartDate,undefined);
  assert.equal(result.employmentFacts.length,1);
  assert.equal(result.employmentFacts[0].actualStartDate,'2026-09-24');
  assert.equal(result.funnel.hiredCount,null);
  assert.equal(result.status,'partial');
});
