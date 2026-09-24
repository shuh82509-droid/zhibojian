import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLifecycleRefreshDue,
  mergeRecruitmentCandidates,
  normalizeAnchorReport,
  parseLatestCoachSummary,
  parseEmploymentMessages,
  parseRecruitmentMessages,
  buildInterviewReminderPreview, interviewReminderSourceFingerprint, reviewWeekFor, readVersionedCoachRankingRows, readVerifiedCoachInstances, coachCalendarFingerprint, assertCoachRankingRevision, parseWeeklyCoachRotation, countCoachReviews, coachReviewReminder, structuredAssessmentSummary, structuredAssessmentForCandidate, assessmentSubmissionKey, centralFeishuOpenId, isVerifiedLiveCenterContact, assessmentSubmissionFor, recruitmentCycleMonthForDate, recruitmentCycleRange, lifecycleReminderWindow
} from '../lifecycle-engine.mjs';

test('timed reminders send only inside their one-hour China-time windows',()=>{
  for(const [kind,start] of [['interview',17*60],['coach',17*60+30]]){
    assert.equal(lifecycleReminderWindow(kind,start-1),'before');
    assert.equal(lifecycleReminderWindow(kind,start),'open');
    assert.equal(lifecycleReminderWindow(kind,start+59),'open');
    assert.equal(lifecycleReminderWindow(kind,start+60),'missed');
    assert.equal(lifecycleReminderWindow(kind,23*60),'missed');
  }
  assert.equal(lifecycleReminderWindow('unknown',17*60),'invalid');
});

test('recruitment cycle switches at 25th and excludes the next cycle first day',()=>{
  assert.equal(recruitmentCycleMonthForDate('2026-09-24'),'2026-09');
  assert.equal(recruitmentCycleMonthForDate('2026-09-25'),'2026-10');
  assert.equal(recruitmentCycleMonthForDate('2026-09-26'),'2026-10');
  assert.equal(recruitmentCycleMonthForDate('2026-12-25'),'2027-01');
  assert.equal(recruitmentCycleMonthForDate('2026-02-30'),'');
  const september=recruitmentCycleRange('2026-09');
  const october=recruitmentCycleRange('2026-10');
  assert.equal(september.startDate,'2026-08-25');
  assert.equal(september.endDate,'2026-09-25');
  assert.equal(new Date(september.endTime*1000).toISOString(),'2026-09-24T15:59:59.000Z');
  assert.equal(october.startTime,september.endTime+1);
  assert.equal(new Date(october.startTime*1000).toISOString(),'2026-09-24T16:00:00.000Z');
  assert.throws(()=>recruitmentCycleRange('2026-13'),{status:400});
});

test('structured assessment writer requires non-degraded exact Feishu identity and one source-bound cohort person',()=>{
  const bindings={'FD-027097':'ou_assessor'};
  const signed={ok:true,mode:'central',user:{number:'FD-027097'}};
  assert.equal(centralFeishuOpenId(signed,bindings),'ou_assessor');
  assert.equal(centralFeishuOpenId({...signed,user:{number:'FD-027097',open_id:'ou_assessor'}},bindings),'ou_assessor');
  assert.equal(centralFeishuOpenId({...signed,user:{number:'FD-027097',open_id:'ou_wrong'}},bindings),'');
  assert.equal(centralFeishuOpenId({...signed,user:{number:'FD-027097',open_id:'ou_assessor',openId:'ou_wrong'}},bindings),'');
  assert.equal(centralFeishuOpenId({...signed,user:{realName:'倪梦萍',open_id:'ou_assessor'}},bindings),'');
  assert.equal(centralFeishuOpenId({...signed,user:{number:' FD-027097 ',open_id:'ou_assessor'}},bindings),'');
  assert.equal(centralFeishuOpenId({...signed,user:{number:'FD-1'}},bindings),'');
  assert.equal(centralFeishuOpenId({...signed,degraded:true},bindings),'');
  assert.equal(centralFeishuOpenId({...signed,mode:'internal'},bindings),'');
  assert.equal(centralFeishuOpenId(signed,{}),'');
  const snapshot={coverage:{capped:false,chatMessages:2},candidates:[{name:'周小雨',inSubmissionCohort:true,submissionEvidence:{sourceId:'om_original'}}],dailyNames:{'2026-09-23':['周小雨']},submissionMessageCounts:{'周小雨':1}};
  assert.equal(assessmentSubmissionFor(snapshot,{candidateName:'周小雨',submissionMessageId:'om_original',outcome:'pass'}).status,'ready');
  assert.equal(assessmentSubmissionFor(snapshot,{candidateName:'周小雨',submissionMessageId:'om_wrong',outcome:'pass'}).status,'pending');
  assert.equal(assessmentSubmissionFor({...snapshot,coverage:{capped:true,chatMessages:500}},{candidateName:'周小雨',submissionMessageId:'om_original',outcome:'pass'}).status,'pending');
  assert.equal(assessmentSubmissionFor({...snapshot,dailyNames:{'2026-09-23':['周小雨'],'2026-09-24':['周小雨']}},{candidateName:'周小雨',submissionMessageId:'om_original',outcome:'pass'}).status,'pending');
  assert.equal(assessmentSubmissionFor({...snapshot,submissionMessageCounts:{'周小雨':2}},{candidateName:'周小雨',submissionMessageId:'om_original',outcome:'pass'}).status,'pending');
});

test('assessor contact must match current app open ID, exact employee number, department and active status',()=>{
  const contact={open_id:'ou_assessor',name:'倪梦萍',employee_no:'FD-027097',department_ids:['od_live'],status:{is_activated:true,is_exited:false,is_frozen:false,is_resigned:false,is_unjoin:false}};
  const expected={openId:'ou_assessor',name:'倪梦萍',departmentId:'od_live',employeeNo:'FD-027097'};
  assert.equal(isVerifiedLiveCenterContact(contact,expected),true);
  for(const mismatch of [{open_id:'ou_other'},{name:'同名其他人'},{employee_no:'FD-000000'},{department_ids:['od_other']},{status:{...contact.status,is_exited:true}},{status:{...contact.status,is_unjoin:true}}])
    assert.equal(isVerifiedLiveCenterContact({...contact,...mismatch},expected),false);
  assert.equal(isVerifiedLiveCenterContact({...contact,employee_no:undefined},expected),false);
});

test('structured assessments require both named identities and the same candidate submission', () => {
  const assessors={'ou_ni':'倪梦萍','ou_liu':'刘慧迅'};
  const candidates=[{name:'周小雨',inSubmissionCohort:true,submissionEvidence:{sourceId:'om_submission'}},{name:'陈小河',inSubmissionCohort:true,submissionEvidence:{sourceId:'om_other'}}];
  const one=[{id:'r1',cycleMonth:'2026-09',candidateName:'周小雨',submissionMessageId:'om_submission',actorOpenId:'ou_ni',outcome:'pass',createdAt:'2026-09-24T01:00:00Z'}];
  const pending=structuredAssessmentSummary(candidates,one,'2026-09',assessors);
  assert.equal(pending.bySubmission[assessmentSubmissionKey('2026-09','om_submission')].passed,null);
  assert.equal(pending.awaitingCount,2);
  const records=[...one,{id:'r2',cycleMonth:'2026-09',candidateName:'周小雨',submissionMessageId:'om_submission',actorOpenId:'ou_liu',outcome:'pass',createdAt:'2026-09-24T02:00:00Z'},
    {id:'wrong-source',cycleMonth:'2026-09',candidateName:'陈小河',submissionMessageId:'om_wrong',actorOpenId:'ou_ni',outcome:'pass'}];
  const confirmed=structuredAssessmentSummary(candidates,records,'2026-09',assessors);
  assert.equal(confirmed.bySubmission[assessmentSubmissionKey('2026-09','om_submission')].passed,true);
  assert.equal(confirmed.bySubmission[assessmentSubmissionKey('2026-09','om_other')].passed,null);
  assert.equal(confirmed.passedCount,1);
  assert.equal(structuredAssessmentSummary(candidates,records,'2026-09',{}).passedCount,0);
  const conflict=structuredAssessmentSummary(candidates,[...one,{...records[1],outcome:'fail'}],'2026-09',assessors);
  assert.equal(conflict.bySubmission[assessmentSubmissionKey('2026-09','om_submission')].passed,null);
  assert.equal(conflict.conflictCount,1);
});

test('先确认后新增同名送审仍按周期和消息 ID 归属，不串用结论',()=>{
  const assessors={'ou_ni':'倪梦萍','ou_liu':'刘慧迅'};
  const original={name:'周小雨',inSubmissionCohort:true,submissionEvidence:{sourceId:'om_first'}};
  const second={name:'周小雨',inSubmissionCohort:true,submissionEvidence:{sourceId:'om_second'}};
  const entries=['ou_ni','ou_liu'].map(actorOpenId=>({cycleMonth:'2026-09',candidateName:'周小雨',submissionMessageId:'om_first',actorOpenId,outcome:'pass'}));
  const summary=structuredAssessmentSummary([original,second],entries,'2026-09',assessors);
  assert.equal(structuredAssessmentForCandidate(summary,original,'2026-09')?.passed,true);
  assert.equal(structuredAssessmentForCandidate(summary,second,'2026-09')?.passed,null);
  assert.equal(summary.passedCount,1);
  assert.equal(summary.awaitingCount,1);
  assert.equal(structuredAssessmentForCandidate(summary,original,'2026-10'),null);
  assert.equal(assessmentSubmissionFor({coverage:{capped:false,chatMessages:2},candidates:[original,second],submissionMessageCounts:{'周小雨':2},dailyNames:{'2026-09-23':['周小雨']}},
    {candidateName:'周小雨',submissionMessageId:'om_second',outcome:'pass'}).status,'pending');
});

test('一条送审消息若意外映射两位候选人，结论不得写入任何一人',()=>{
  const first={name:'周小雨',inSubmissionCohort:true,submissionEvidence:{sourceId:'om_shared'}};
  const second={name:'陈小河',inSubmissionCohort:true,submissionEvidence:{sourceId:'om_shared'}};
  const summary=structuredAssessmentSummary([first,second],[
    {cycleMonth:'2026-09',candidateName:'周小雨',submissionMessageId:'om_shared',actorOpenId:'ou_ni',outcome:'pass'},
    {cycleMonth:'2026-09',candidateName:'周小雨',submissionMessageId:'om_shared',actorOpenId:'ou_liu',outcome:'pass'},
  ],'2026-09',{'ou_ni':'倪梦萍','ou_liu':'刘慧迅'});
  assert.equal(structuredAssessmentForCandidate(summary,first,'2026-09'),null);
  assert.equal(structuredAssessmentForCandidate(summary,second,'2026-09'),null);
  assert.equal(summary.passedCount,0);
  assert.equal(assessmentSubmissionFor({coverage:{capped:false,chatMessages:2},candidates:[first,second],submissionMessageCounts:{'周小雨':1},dailyNames:{'2026-09-23':['周小雨']}},
    {candidateName:'周小雨',submissionMessageId:'om_shared',outcome:'pass'}).status,'pending');
});

test('interview reminder requires a verified calendar and exact candidate match', () => {
  const date = '2026-09-23';
  const snapshot = {
    calendarStatus:'已连接：正式面试日历已读取 1 条详情事件。',
    coverage:{capped:false,chatMessages:12,reactionStatus:'已核验'},
    candidates:[{name:'周小雨',inSubmissionCohort:true,
      submissionEvidence:{sourceId:'om_zhou',date:'2026-09-22',initialReview:'OK'},
      calendarEvidence:{eventId:'e1',date}}],
    submissionMessageCounts:{周小雨:1},
    interviewEvents:{[date]:[{name:'周小雨面试 · 14:00',status:'calendar',eventId:'e1'}]},
  };
  const preview = buildInterviewReminderPreview(snapshot, date);
  assert.equal(preview.status, 'preview');
  assert.equal(preview.sourceReady, true);
  assert.equal(preview.readyForSend, false);
  assert.deepEqual(preview.matches, [{name:'周小雨',eventId:'e1'}]);
  assert.match(preview.text, /周小雨/);
  assert.equal(buildInterviewReminderPreview({...snapshot,calendarStatus:'待授权'}, date).status, 'pending');
  assert.equal(buildInterviewReminderPreview({...snapshot,interviewEvents:{[date]:[{name:'未知姓名面试',status:'calendar'}]}}, date).status, 'pending');
});

test('interview title does not mistake a Chinese name prefix for another candidate', () => {
  const date='2026-09-24',snapshot={calendarStatus:'已连接：正式面试日历已读取 1 条详情事件。',coverage:{capped:false,chatMessages:1,reactionStatus:'已核验'},
    candidates:[{name:'王丽',inSubmissionCohort:true,submissionEvidence:{sourceId:'om_wangli',date:'2026-09-23',initialReview:'OK'},
      calendarEvidence:{eventId:'e1',date}}],submissionMessageCounts:{王丽:1},
    interviewEvents:{[date]:[{name:'王丽娜面试 · 14:00',status:'calendar',eventId:'e1'}]}};
  assert.equal(buildInterviewReminderPreview(snapshot,date).status,'pending');
  assert.equal(buildInterviewReminderPreview({...snapshot,interviewEvents:{[date]:[{name:'面试王丽 · 14:00',status:'calendar',eventId:'e1'}]}},date).sourceReady,true);
  assert.equal(buildInterviewReminderPreview({...snapshot,candidates:[...snapshot.candidates,{name:'王丽娜',inSubmissionCohort:true,
    submissionEvidence:{sourceId:'om_wanglina',date:'2026-09-23',initialReview:'OK'},calendarEvidence:{eventId:'e1',date}}],
    submissionMessageCounts:{王丽:1,王丽娜:1}},date).status,'preview');
  assert.equal(buildInterviewReminderPreview({...snapshot,submissionMessageCounts:{王丽:2},interviewEvents:{[date]:[{name:'王丽面试 · 14:00',status:'calendar',eventId:'e1'}]}},date).status,'pending');
});

test('17:00 interview source fingerprint is order independent but detects calendar and chat changes',()=>{
  const date='2026-09-24',base={coverage:{capped:false},submissionMessageCounts:{王丽:1},
    candidates:[{name:'王丽',inSubmissionCohort:true,submissionEvidence:{sourceId:'om_first'}}],
    interviewEvents:{[date]:[{name:'王丽面试 · 14:00',status:'calendar',eventId:'e1'}]}};
  const first=interviewReminderSourceFingerprint(base,date);
  assert.equal(first,interviewReminderSourceFingerprint({...base,interviewEvents:{[date]:[...base.interviewEvents[date]].reverse()}},date));
  assert.notEqual(first,interviewReminderSourceFingerprint({...base,interviewEvents:{[date]:[{name:'王丽面试 · 15:00',status:'calendar',eventId:'e1'}]}},date));
  assert.notEqual(first,interviewReminderSourceFingerprint({...base,interviewEvents:{[date]:[{...base.interviewEvents[date][0],endAt:'2026-09-24T08:30:00.000Z'}]}},date));
  assert.notEqual(first,interviewReminderSourceFingerprint({...base,interviewEvents:{[date]:[{...base.interviewEvents[date][0],summaryFingerprint:'a'.repeat(64)}]}},date));
  assert.notEqual(first,interviewReminderSourceFingerprint({...base,candidates:[...base.candidates,{name:'陈月',inSubmissionCohort:true,submissionEvidence:{sourceId:'om_second'}}]},date));
  assert.notEqual(first,interviewReminderSourceFingerprint({...base,submissionMessageCounts:{王丽:2}},date));
});

test('17:00 first-day preview needs verified prior-cycle carryover and binds its source fingerprint',()=>{
  const date='2026-09-25';
  const candidate={name:'周小雨',inSubmissionCohort:false,boundaryCarryover:true,
    submissionEvidence:{name:'周小雨',date:'2026-09-23',sourceId:'om_sep23',initialReview:'OK'},
    calendarEvidence:{date,eventId:'cal_one'}};
  const snapshot={calendarStatus:'已连接：正式面试日历已读取 1 条详情事件。',
    coverage:{capped:false,chatMessages:0,reactionStatus:'已核验'},
    candidates:[candidate],submissionMessageCounts:{},
    boundaryCarryover:{status:'verified',date,sourceCycle:'2026-09',chatMessages:386,
      submissionMessageCounts:{周小雨:1}},
    interviewEvents:{[date]:[{name:'周小雨面试 · 14:00',status:'calendar',eventId:'cal_one'}]}};
  assert.equal(buildInterviewReminderPreview(snapshot,date).status,'preview');
  assert.equal(buildInterviewReminderPreview({...snapshot,boundaryCarryover:{...snapshot.boundaryCarryover,status:'pending'}},date).status,'pending');
  assert.equal(buildInterviewReminderPreview({...snapshot,boundaryCarryover:{...snapshot.boundaryCarryover,submissionMessageCounts:{周小雨:2}}},date).status,'pending');
  assert.equal(buildInterviewReminderPreview({...snapshot,coverage:{...snapshot.coverage,reactionStatus:'待核验'}},date).status,'pending');
  const first=interviewReminderSourceFingerprint(snapshot,date);
  assert.notEqual(first,interviewReminderSourceFingerprint({...snapshot,candidates:[{...candidate,submissionEvidence:{...candidate.submissionEvidence,sourceId:'om_changed'}}]},date));
});

test('Wednesday to Tuesday review week uses last week Q:U rotation, not the old current room', () => {
  assert.deepEqual(reviewWeekFor('2026-09-23'), {start:'2026-09-23',end:'2026-09-29',previousStart:'2026-09-16',previousEnd:'2026-09-22'});
  assert.deepEqual(reviewWeekFor('2026-09-29'), reviewWeekFor('2026-09-23'));
  assert.deepEqual(reviewWeekFor('2027-01-01'), {start:'2026-12-30',end:'2027-01-05',previousStart:'2026-12-23',previousEnd:'2026-12-29'});
  const rows=[
    [], ['9.16-9.22日主播排名'], ['本周所在直播间','主播','周均分','排名','下周直播间'],
    ['官旗','潘小慧','96','1','官旗'], ['官旗','杨晓彤','68','5','优选'],
    ['优选','王思佳','54','6','品牌精选'], ['品牌精选','刘睿','65','5','王鸥'],
    ['王鸥美肤','蒋珂','90','1','离职'], [],
    ['9.9-9.14日主播排名'], ['本周所在直播间','主播','周均分','排名','下周直播间'],
    ['官旗','潘小慧','90','1','优选']
  ];
  const rotation=parseWeeklyCoachRotation(rows,'2026-09-24');
  assert.equal(rotation.status,'ready');
  assert.deepEqual(rotation.rooms, {'官旗':['潘小慧'],'品牌精选':['王思佳'],'优选':['杨晓彤'],'王鸥美肤':['刘睿']});
  assert.equal(parseWeeklyCoachRotation(rows,'2026-09-30').status,'pending');
});

test('weekly Q:U ranking pages and final sentinel must share one positive revision', async () => {
  const calls=[];
  const read=async(start,end)=>{calls.push([start,end]);return {revision:12535,values:[[start,end]]};};
  const result=await readVersionedCoachRankingRows(501,read);
  assert.equal(result.revision,12535);
  assert.deepEqual(calls,[[1,250],[251,500],[501,501],[2,3]]);
  assert.equal(result.values.length,501);
  assert.deepEqual(result.values[0],[1,250]);
  assert.deepEqual(result.values[250],[251,500]);
  assert.deepEqual(result.values[500],[501,501]);
});

test('weekly Q:U ranking fails closed on a revision change during pagination', async () => {
  let page=0;
  await assert.rejects(readVersionedCoachRankingRows(501,async()=>({revision:++page===1?12535:12536,values:[]})),/版本发生变化/);
});

test('weekly Q:U ranking fails closed if revision changes after all pages', async () => {
  let page=0;
  await assert.rejects(readVersionedCoachRankingRows(251,async()=>({revision:++page===3?12536:12535,values:[]})),/读取结束时版本发生变化/);
});

test('weekly Q:U ranking fails closed if any page or sentinel lacks revision', async () => {
  await assert.rejects(readVersionedCoachRankingRows(5,async()=>({values:[]})),/版本缺失/);
  let call=0;
  await assert.rejects(readVersionedCoachRankingRows(5,async()=>({revision:++call===1?12535:null,values:[]})),/读取结束时版本发生变化或无法核验/);
});

test('17:30 ranking pre-send check rejects changed or unreadable source revision',async()=>{
  assert.equal(await assertCoachRankingRevision(12535,async()=>({revision:12535,values:[['本周所在直播间']]})),true);
  await assert.rejects(assertCoachRankingRevision(12535,async()=>({revision:12536,values:[]})),/通知前已变化/);
  await assert.rejects(assertCoachRankingRevision(12535,async()=>({revision:12535})),/通知前已变化/);
});

test('coach instance view checks full week against two smaller windows and preserves instance IDs',async()=>{
  const week=reviewWeekFor('2026-09-24');
  const wed={event_id:'series_1790092800',summary:'潘小慧复盘',status:'confirmed',start_time:{timestamp:String(Date.parse('2026-09-23T10:00:00+08:00')/1000)}};
  const sat={event_id:'series_1790352000',summary:'潘小慧复盘',status:'confirmed',start_time:{timestamp:String(Date.parse('2026-09-26T10:00:00+08:00')/1000)}};
  const allDay={event_id:'all-day_0',summary:'杨晓彤复盘',status:'confirmed',start_time:{date:'2026-09-24'}};
  const cancelled={event_id:'cancelled_0',summary:'潘小慧复盘',status:'cancelled',start_time:{date:'2026-09-26'}};
  const calls=[];
  const events=await readVerifiedCoachInstances(week,async(start,end)=>{
    calls.push([start,end]);
    return {items:calls.length===1?[wed,allDay,sat,cancelled]:calls.length===2?[wed,allDay]:[sat,cancelled]};
  });
  assert.equal(calls.length,3);
  assert.deepEqual(events.map(item=>item.eventId),['series_1790092800','all-day_0','series_1790352000','cancelled_0']);
  assert.equal(events[1].date,'2026-09-24');
  assert.equal(events[1].startAt,'');
  assert.equal(events[3].status,'cancelled');
});

test('coach instance view fails closed on truncated, changed or malformed responses',async()=>{
  const week=reviewWeekFor('2026-09-24');
  const one={event_id:'instance_1',summary:'潘小慧复盘',status:'confirmed',start_time:{date:'2026-09-24'}};
  await assert.rejects(readVerifiedCoachInstances(week,async()=>({items:[one],has_more:true})),/完整/);
  await assert.rejects(readVerifiedCoachInstances(week,async()=>({items:[one],has_more:'false'})),/完整/);
  assert.equal((await readVerifiedCoachInstances(week,async()=>({items:[one],has_more:false}))).length,1);
  await assert.rejects(readVerifiedCoachInstances(week,async()=>({items:[{...one,status:'unknown'}]})),/状态/);
  let call=0;
  await assert.rejects(readVerifiedCoachInstances(week,async()=>({items:++call===1?[one]:[]})),/不一致/);
  call=0;
  await assert.rejects(readVerifiedCoachInstances(week,async()=>({items:++call===2?[{...one,summary:'已改标题'}]:[one]})),/内容发生变化/);
});

test('coach room fingerprint is order independent but blocks any calendar change before POST',()=>{
  const review={eventId:'instance_1',summary:'潘小慧复盘',status:'confirmed',date:'2026-09-24',startAt:'2026-09-24T09:00:00.000Z'};
  const other={eventId:'instance_2',summary:'例行会议',status:'confirmed',date:'2026-09-24',startAt:''};
  const original=coachCalendarFingerprint([review,other]);
  assert.equal(coachCalendarFingerprint([other,review]),original);
  for(const changed of [{...review,summary:'潘小慧会谈'},{...review,status:'cancelled'},{...review,eventId:'instance_3'}]){
    assert.notEqual(coachCalendarFingerprint([other,changed]),original);
  }
  assert.notEqual(coachCalendarFingerprint([review]),original);
  assert.throws(()=>coachCalendarFingerprint([review,review]),/指纹无法核验/);
});

test('ranking rows with a room assignment but missing anchor name are partial, never ready to notify',()=>{
  const rows=[['9.16-9.22日主播排名'],['本周所在直播间','主播','周均分','排名','下周直播间'],
    ['官旗','潘小慧','96','1','官旗'],['官旗','','70','2','优选']];
  const rotation=parseWeeklyCoachRotation(rows,'2026-09-24');
  assert.equal(rotation.status,'partial');
  assert.match(rotation.warnings.join(' '),/主播姓名待核验/);
  assert.equal(coachReviewReminder('官旗','曾泳淇',countCoachReviews(rotation,{'官旗':[]})).status,'pending');
});

test('today all-day review counts after China midnight; a future all-day review does not',()=>{
  const rotation=parseWeeklyCoachRotation([
    ['9.16-9.22日主播排名'],['本周所在直播间','主播','周均分','排名','下周直播间'],
    ['官旗','潘小慧','96','1','官旗']
  ],'2026-09-24');
  const summary=countCoachReviews(rotation,{'官旗':[
    {eventId:'today_0',date:'2026-09-24',summary:'潘小慧复盘',status:'confirmed'},
    {eventId:'tomorrow_0',date:'2026-09-25',summary:'潘小慧复盘',status:'confirmed'},
    {eventId:'cancelled_0',date:'2026-09-24',summary:'潘小慧复盘',status:'cancelled'}
  ],'品牌精选':[],'优选':[],'王鸥美肤':[]},new Date('2026-09-24T09:30:00.000Z'));
  assert.equal(summary.rooms['官旗'].anchors[0].count,1);
});

test('coach review counts only one named anchor plus 复盘 in the coach own calendar', () => {
  const rotation=parseWeeklyCoachRotation([
    ['9.16-9.22日主播排名'],['本周所在直播间','主播','周均分','排名','下周直播间'],
    ['官旗','潘小慧','96','1','官旗'],['官旗','杨晓彤','68','5','优选'],
    ['优选','王思佳','54','6','品牌精选'],['品牌精选','刘睿','65','5','王鸥']
  ],'2026-09-24');
  const summary=countCoachReviews(rotation,{
    '官旗':[
      {eventId:'e1',date:'2026-09-23',summary:'潘小慧复盘'},
      {eventId:'e1',date:'2026-09-23',summary:'潘小慧复盘'},
      {eventId:'e2',date:'2026-09-24',summary:'潘小慧开播'},
      {eventId:'e3',date:'2026-09-30',summary:'潘小慧复盘'},
      {eventId:'e4',date:'2026-09-26',startAt:'2026-09-26T03:00:00.000Z',summary:'潘小慧复盘'}
    ],'品牌精选':[],'优选':[],'王鸥美肤':[]
  },new Date('2026-09-24T09:30:00.000Z'));
  assert.equal(summary.status,'ready');
  assert.equal(summary.rooms['官旗'].anchors[0].count,1);
  assert.deepEqual(summary.rooms['官旗'].anchors[0],{name:'潘小慧',count:1});
  assert.doesNotMatch(JSON.stringify(summary),/eventIds|"e1"/);
  assert.deepEqual(summary.rooms['优选'].zeroReview,['杨晓彤']);
  assert.match(coachReviewReminder('优选','李爽',summary).text,/杨晓彤：0 次/);
  const partial=countCoachReviews(rotation,{'官旗':[]},new Date('2026-09-24T09:30:00.000Z'));
  assert.equal(partial.status,'partial');
  assert.equal(coachReviewReminder('品牌精选','梁瑜涵',partial).status,'pending');
});

test('coach review never credits a same-prefix different anchor',()=>{
  const rotation={status:'ready',week:{start:'2026-09-23',end:'2026-09-29'},rooms:{官旗:['王丽'],品牌精选:[],优选:[],王鸥美肤:[]}};
  const events={'官旗':[{eventId:'review-other',date:'2026-09-24',summary:'王丽娜复盘'}],品牌精选:[],优选:[],王鸥美肤:[]};
  const asOf=new Date('2026-09-24T09:30:00.000Z');
  assert.deepEqual(countCoachReviews(rotation,events,asOf).rooms['官旗'].anchors,[{name:'王丽',count:0}]);
  events['官旗'].push({eventId:'review-exact',date:'2026-09-24',summary:'王丽复盘'});
  assert.deepEqual(countCoachReviews(rotation,events,asOf).rooms['官旗'].anchors,[{name:'王丽',count:1}]);
});

test('recruitment parser deduplicates daily headcount but not different same-name submissions', () => {
  const parsed = parseRecruitmentMessages([
    {messageId:'m1',createdAt:'2026-08-21T01:00:00.000Z',text:'求职者 李彩红 是否符合【主播】的邀约标准',reactions:{details:[{emojiType:'OK',operatorId:'ou_0e5926902d4d6051d0ea14f042bb56f4'}]}},
    {messageId:'m2',createdAt:'2026-08-21T02:00:00.000Z',text:'求职者 李彩红 是否符合【主播】的邀约标准',reactions:{details:[{emojiType:'OK',operatorId:'ou_0e5926902d4d6051d0ea14f042bb56f4'}]}},
    {messageId:'m3',createdAt:'2026-08-21T03:00:00.000Z',text:'求职者 杨静娜 是否符合【主播】的邀约标准',reactions:{details:[{emoji_type:'No',operator:{operator_id:'ou_0e5926902d4d6051d0ea14f042bb56f4'}}]}}
  ]);
  assert.equal(parsed.dailyCounts['2026-08-21'], 2);
  assert.deepEqual(parsed.dailyNames['2026-08-21'], ['李彩红','杨静娜']);
  const ambiguous=parsed.candidates.find(item => item.name === '李彩红');
  assert.equal(ambiguous.stage, 'unmapped');
  assert.equal(ambiguous.submissionIdentityStatus,'ambiguous');
  assert.deepEqual(ambiguous.submissionEvidenceAlternatives.map(item=>item.sourceId),['m1','m2']);
  assert.equal(parsed.submissionMessageCounts['李彩红'],2);
  assert.equal(parsed.funnel.initialPassedCount,0);
  assert.equal(parsed.funnel.initialPendingCount,1);
  assert.equal(parsed.candidates.find(item => item.name === '杨静娜').stage, 'initial_fail');
  assert.equal(parsed.candidates.some(item => item.stage === 'review'), false);
});

test('same-name submissions with distinct IDs never inherit one interview result or become reminder-ready', () => {
  const reviewer='ou_0e5926902d4d6051d0ea14f042bb56f4';
  const date='2026-09-24';
  const submission=(id,hour,emoji='OK')=>({messageId:id,createdAt:`${date}T0${hour}:00:00.000Z`,
    text:'求职者【周小雨】是否符合【主播】的邀约标准',
    reactions:{details:[{emojiType:emoji,operatorId:reviewer}]}});
  const review={messageId:'om_review',createdAt:`${date}T04:00:00.000Z`,sender:{id:reviewer},
    text:'周小雨\n颜值8 表现力8\n- **通过**'};
  const one=parseRecruitmentMessages([submission('om_first',1),review],{reviewerOpenId:reviewer});
  assert.equal(one.candidates[0].stage,'interview_pass');
  assert.equal(one.funnel.initialPassedCount,1);
  assert.equal(one.funnel.groupPassedCount,1);
  const duplicate=parseRecruitmentMessages([submission('om_first',1),review,submission('om_second',3)],{reviewerOpenId:reviewer});
  const candidate=duplicate.candidates[0];
  assert.equal(candidate.stage,'unmapped');
  assert.equal(candidate.submissionEvidence.sourceId,'');
  assert.deepEqual(candidate.submissionEvidenceAlternatives.map(item=>item.sourceId),['om_first','om_second']);
  assert.deepEqual(candidate.unresolvedEvaluationEvidence.map(item=>item.sourceId),['om_review']);
  assert.equal(duplicate.funnel.initialPassedCount,0);
  assert.equal(duplicate.funnel.initialFailedCount,0);
  assert.equal(duplicate.funnel.initialPendingCount,1);
  assert.equal(duplicate.funnel.groupEvaluatedCount,0);
  assert.equal(duplicate.funnel.groupPassedCount,0);
  assert.deepEqual(duplicate.interviewEvents,{});
  const snapshot={...duplicate,calendarStatus:'已连接：正式面试日历已读取 1 条详情事件。',
    coverage:{capped:false,chatMessages:3,reactionStatus:'已核验'},
    interviewEvents:{[date]:[{name:'周小雨面试 · 14:00',status:'calendar',eventId:'cal_one'}]}};
  assert.equal(buildInterviewReminderPreview(snapshot,date).status,'pending');
  assert.equal(mergeRecruitmentCandidates(duplicate.candidates,[{name:'周小雨',stage:'interview_pass',status:'面试通过'}])[0].stage,'unmapped');
});

test('same-name conflicting reactions, shared or missing IDs and exact negative outcomes fail closed',()=>{
  const reviewer='ou_0e5926902d4d6051d0ea14f042bb56f4';
  const create=(name,id,emoji='OK')=>({messageId:id,createdAt:'2026-09-24T01:00:00.000Z',
    text:`求职者【${name}】是否符合【主播】的邀约标准`,
    reactions:{details:[{emojiType:emoji,operatorId:reviewer}]}});
  const report=outcome=>({messageId:'om_report',createdAt:'2026-09-24T04:00:00.000Z',
    sender:{id:reviewer},text:`周小雨\n颜值8 表现力8\n- **${outcome}**`});
  const mixed=parseRecruitmentMessages([create('周小雨','om_ok'),create('周小雨','om_no','No'),report('不通过')],{reviewerOpenId:reviewer});
  assert.equal(mixed.candidates[0].stage,'unmapped');
  assert.equal(mixed.funnel.initialPassedCount,0);
  assert.equal(mixed.funnel.initialFailedCount,0);
  assert.equal(mixed.funnel.groupEvaluatedCount,0);
  const shared=parseRecruitmentMessages([{...create('周小雨','om_shared'),
    text:'求职者【周小雨】是否符合【主播】的邀约标准\n求职者【林小满】是否符合【主播】的邀约标准'},report('通过')],{reviewerOpenId:reviewer});
  assert.ok(shared.candidates.every(item=>item.stage==='unmapped'));
  assert.equal(shared.funnel.groupPassedCount,0);
  const missing=parseRecruitmentMessages([create('周小雨',''),report('通过')],{reviewerOpenId:reviewer});
  assert.equal(missing.candidates[0].stage,'unmapped');
  assert.equal(missing.candidates[0].submissionEvidenceAlternatives.length,1);
  const repeated=parseRecruitmentMessages([create('周小雨','om_one'),create('周小雨','om_one'),report('不通过')],{reviewerOpenId:reviewer});
  assert.equal(repeated.submissionMessageCounts['周小雨'],1);
  assert.equal(repeated.candidates[0].stage,'interview_fail');
  assert.equal(repeated.funnel.groupPassedCount,0);
  const unsafe=parseRecruitmentMessages([create('周小雨','om_one'),report('没有通过')],{reviewerOpenId:reviewer});
  assert.equal(unsafe.candidates[0].stage,'initial_pass');
  assert.equal(unsafe.funnel.groupEvaluatedCount,0);
});

test('recruitment parser reads evaluation results and accepted offers without guessing', () => {
  const parsed = parseRecruitmentMessages([
    {messageId:'u1',createdAt:'2026-08-21T01:00:00.000Z',text:'求职者 周小雨 是否符合【主播】的邀约标准'},
    {messageId:'u2',createdAt:'2026-08-21T02:00:00.000Z',sender:{id:'ou_0e5926902d4d6051d0ea14f042bb56f4'},text:'**周小雨**\n颜值4 表现力4\n- **不通过**'},
    {messageId:'u3',createdAt:'2026-08-21T03:00:00.000Z',sender:{name:'倪梦萍',id:'ou_0e5926902d4d6051d0ea14f042bb56f4'},text:'**林小满**\n颜值4.5 表现力4\n- **通过**'},
    {messageId:'u4',createdAt:'2026-08-21T04:00:00.000Z',text:'品牌营销部-直播中心-新人主播-何小安接受offer 9.7待入职'}
  ]);
  assert.equal(parsed.candidates.find(item => item.name === '周小雨').stage, 'interview_fail');
  assert.equal(parsed.candidates.find(item => item.name === '林小满').stage, 'interview_pass');
  assert.equal(parsed.candidates.find(item => item.name === '何小安').startDate, '2026-09-07');
  assert.deepEqual(parsed.interviewEvents['2026-08-21'].map(item=>item.name), ['周小雨','林小满']);
});

test('recruitment parser ignores interview decisions from people other than the named reviewer', () => {
  const parsed = parseRecruitmentMessages([
    {messageId:'v1',createdAt:'2026-08-21T02:00:00.000Z',sender:{name:'其他成员'},text:'**周小雨**\n颜值4 表现力4\n- **通过**'}
  ]);
  assert.equal(parsed.candidates.length, 0);
  assert.deepEqual(parsed.interviewEvents, {});
});

test('one reviewer marking both OK and No on the same submission remains pending regardless of reaction order', () => {
  const reviewer='ou_0e5926902d4d6051d0ea14f042bb56f4';
  for (const emojis of [['OK','No'],['No','OK']]) {
    const parsed=parseRecruitmentMessages([{messageId:'om_conflict',createdAt:'2026-09-24T03:00:00.000Z',
      text:'求职者【周小雨】是否符合【主播】的邀约标准',
      reactions:{details:[...emojis.map(emojiType=>({emojiType,operatorId:reviewer})),{emojiType:'OK',operatorId:'ou_other'}]}},
    ],{reviewerOpenId:reviewer});
    assert.equal(parsed.funnel.initialPassedCount,0);
    assert.equal(parsed.funnel.initialFailedCount,0);
    assert.equal(parsed.funnel.initialPendingCount,1);
    assert.equal(parsed.candidates[0].stage,'unmapped');
    assert.match(parsed.candidates[0].note,/同时标记 OK 与 No/);
  }
  const repeated=parseRecruitmentMessages([{messageId:'om_same',createdAt:'2026-09-24T03:00:00.000Z',
    text:'求职者【周小雨】是否符合【主播】的邀约标准',
    reactions:{details:[{emojiType:'OK',operatorId:reviewer},{emojiType:'OK',operatorId:reviewer}]},
  }],{reviewerOpenId:reviewer});
  assert.equal(repeated.funnel.initialPassedCount,1);
});

test('one group message containing multiple candidates or outcomes cannot assign its conclusion to the first name', () => {
  const reviewer='ou_0e5926902d4d6051d0ea14f042bb56f4';
  const submissions=['周小雨','林小满'].map((name,index)=>({messageId:`om_submit${index}`,createdAt:`2026-09-24T0${index+1}:00:00.000Z`,
    text:`求职者【${name}】是否符合【主播】的邀约标准`,reactions:{details:[{emojiType:'OK',operatorId:reviewer}]}}));
  const messages=[
    '**周小雨**\n颜值8 表现力8\n- **通过**\n**林小满**\n颜值7 表现力7\n- **不通过**',
    '**周小雨**\n颜值8\n待确认\n**林小满**\n颜值7\n- **通过**',
    '**周小雨**\n颜值8\n- **通过**\n**林小满**\n颜值7\n- **通过**',
  ];
  for (const text of messages) {
    const parsed=parseRecruitmentMessages([...submissions,{messageId:'om_group',createdAt:'2026-09-24T04:00:00.000Z',sender:{id:reviewer},text}],{reviewerOpenId:reviewer});
    assert.equal(parsed.funnel.groupEvaluatedCount,0);
    assert.equal(parsed.candidates.find(item=>item.name==='周小雨').stage,'initial_pass');
    assert.equal(parsed.candidates.find(item=>item.name==='林小满').stage,'initial_pass');
  }
});

test('one outcome named for a second candidate never advances the first candidate', () => {
  const reviewer='ou_0e5926902d4d6051d0ea14f042bb56f4';
  const submission={messageId:'om_submit_first',createdAt:'2026-09-24T01:00:00.000Z',
    text:'求职者【周小雨】是否符合【主播】的邀约标准',
    reactions:{details:[{emojiType:'OK',operatorId:reviewer}]}};
  for (const text of [
    '周小雨\n颜值8\n林小满 - 通过',
    '**周小雨**\n颜值8\n**林小满**\n- 通过',
    '周小雨\n颜值8\n结论：林小满通过',
    '周小雨\n颜值8\n结论（林小满）：通过',
    '周小雨\n颜值8\n评价如下。林小满通过',
    '周小雨\n颜值8\n- 没有通过',
  ]) {
    const parsed=parseRecruitmentMessages([submission,{messageId:'om_ambiguous',createdAt:'2026-09-24T04:00:00.000Z',
      sender:{id:reviewer},text}],{reviewerOpenId:reviewer});
    assert.equal(parsed.funnel.groupEvaluatedCount,0);
    assert.equal(parsed.candidates.find(item=>item.name==='周小雨').stage,'initial_pass');
    assert.deepEqual(parsed.interviewEvents,{});
  }
  const secondSubmission={messageId:'om_submit_second',createdAt:'2026-09-24T02:00:00.000Z',
    text:'求职者【林小满】是否符合【主播】的邀约标准'};
  const mixed=parseRecruitmentMessages([submission,secondSubmission,{messageId:'om_known_second',
    createdAt:'2026-09-24T04:00:00.000Z',sender:{id:reviewer},
    text:'周小雨\n颜值8\n备注：林小满仍需复核\n- 通过'}],{reviewerOpenId:reviewer});
  assert.equal(mixed.funnel.groupEvaluatedCount,0);
  assert.equal(mixed.candidates.find(item=>item.name==='周小雨').stage,'initial_pass');
  assert.deepEqual(mixed.interviewEvents,{});
});

test('later submissions and unknown people in commentary never let a mixed review advance its heading',()=>{
  const reviewer='ou_0e5926902d4d6051d0ea14f042bb56f4';
  const submission=(name,hour,id)=>({messageId:id,createdAt:`2026-09-24T${hour}:00:00.000Z`,
    text:`求职者【${name}】是否符合【主播】的邀约标准`,
    reactions:{details:[{emojiType:'OK',operatorId:reviewer}]}});
  const first=submission('周小雨','01','om_zhou');
  const later=submission('林小满','03','om_lin');
  for(const commentary of [
    '- 林小满镜头表现更好。',
    '- 镜头状态：林小满更好。',
    '- 对比另一位候选人表现更好。',
  ]){
    const report={messageId:'om_mixed',createdAt:'2026-09-24T02:00:00.000Z',
      sender:{id:reviewer},text:`周小雨\n颜值8 表现力8\n${commentary}\n- **通过**`};
    for(const messages of [[first,report],[first,report,later]]){
      const parsed=parseRecruitmentMessages(messages,{reviewerOpenId:reviewer});
      assert.equal(parsed.candidates.find(item=>item.name==='周小雨').stage,'initial_pass');
      assert.equal(parsed.funnel.groupEvaluatedCount,0);
      assert.deepEqual(parsed.interviewEvents,{});
    }
  }
  for(const tag of ['林小满','其他候选人']){
    const parsed=parseRecruitmentMessages([first,{messageId:'om_tag',createdAt:'2026-09-24T02:00:00.000Z',
      sender:{id:reviewer},text:`周小雨\n颜值8 表现力8\n- **通过**@${tag}`},later],{reviewerOpenId:reviewer});
    assert.equal(parsed.candidates.find(item=>item.name==='周小雨').stage,'initial_pass');
    assert.equal(parsed.funnel.groupEvaluatedCount,0);
  }
  const single=parseRecruitmentMessages([first,{messageId:'om_single',createdAt:'2026-09-24T02:00:00.000Z',
    sender:{id:reviewer},text:'周小雨\n颜值8 表现力8\n- **通过**'},later],{reviewerOpenId:reviewer});
  assert.equal(single.candidates.find(item=>item.name==='周小雨').stage,'interview_pass');
  assert.equal(single.candidates.find(item=>item.name==='林小满').stage,'initial_pass');
});

test('a longer submitted name is not mistaken for a shorter submitted name inside it', () => {
  const reviewer='ou_0e5926902d4d6051d0ea14f042bb56f4';
  const submissions=['李明','李明欣'].map((name,index)=>({messageId:`om_name_${index}`,
    createdAt:`2026-09-24T0${index+1}:00:00.000Z`,
    text:`求职者【${name}】是否符合【主播】的邀约标准`,
    reactions:{details:[{emojiType:'OK',operatorId:reviewer}]}}));
  const parsed=parseRecruitmentMessages([...submissions,{messageId:'om_long_name',
    createdAt:'2026-09-24T04:00:00.000Z',sender:{id:reviewer},
    text:'**李明欣**\n颜值8 表现力8\n- 通过'}],{reviewerOpenId:reviewer});
  assert.equal(parsed.candidates.find(item=>item.name==='李明欣').stage,'interview_pass');
  assert.equal(parsed.candidates.find(item=>item.name==='李明').stage,'initial_pass');
  assert.deepEqual(parsed.interviewEvents['2026-09-24'].map(item=>item.name),['李明欣']);
});

test('a single candidate may be named again beside the only explicit interview outcome', () => {
  const reviewer='ou_0e5926902d4d6051d0ea14f042bb56f4';
  const parsed=parseRecruitmentMessages([{messageId:'om_single',createdAt:'2026-09-24T04:00:00.000Z',
    sender:{id:reviewer},text:'面试结果\n**周小雨**\n颜值8 表现力8\n周小雨：通过'}],{reviewerOpenId:reviewer});
  assert.equal(parsed.candidates.find(item=>item.name==='周小雨')?.stage,'interview_pass');
  assert.deepEqual(parsed.interviewEvents['2026-09-24'].map(item=>item.name),['周小雨']);
});

test('one-person official post with media and descriptive bullets keeps only its final exact outcome',()=>{
  const reviewer='ou_0e5926902d4d6051d0ea14f042bb56f4';
  const submission={messageId:'om_submission',createdAt:'2026-09-24T01:00:00.000Z',
    text:'求职者【周小雨】是否符合【主播】的邀约标准',
    reactions:{details:[{emojiType:'OK',operatorId:reviewer}]}};
  const common='[Media: file_v1_example]\n**周小雨**\n颜值4 表现力4\n- 镜头状态稳定，互动自然；\n- 表现力：答复清晰。\n';
  for(const [outcome,stage] of [['- **通过**','interview_pass'],
    ['不通过','interview_fail'],['未通过','interview_fail'],
    ['- **不通过**','interview_fail'],['- **未通过**','interview_fail'],
    ['周小雨：不通过','interview_fail'],['周小雨：未通过','interview_fail'],
    ['- **不通过**@倪梦萍','interview_fail'],['- **未通过**@倪梦萍','interview_fail'],
    ['- **通过**@倪梦萍','interview_pass']]){
    const parsed=parseRecruitmentMessages([submission,{messageId:'om_report',createdAt:'2026-09-24T04:00:00.000Z',
      sender:{id:reviewer},text:common+outcome}],{reviewerOpenId:reviewer});
    assert.equal(parsed.candidates.find(item=>item.name==='周小雨').stage,stage);
  }
  for(const unsafe of ['- 林小满仍需复核。\n- **通过**','- 候选人林小满待定。\n- **通过**',
    '- 描述含没有通过的结论。\n- **通过**',
    '- 没有通过','- 未通过审核','周小雨可能未通过','- 通过但需复核']){
    const parsed=parseRecruitmentMessages([submission,{messageId:'om_report',createdAt:'2026-09-24T04:00:00.000Z',
      sender:{id:reviewer},text:common+unsafe}],{reviewerOpenId:reviewer});
    assert.equal(parsed.candidates.find(item=>item.name==='周小雨').stage,'initial_pass');
  }
});

test('an interview report header is not misidentified as the candidate name', () => {
  const reviewer='ou_0e5926902d4d6051d0ea14f042bb56f4';
  const parsed=parseRecruitmentMessages([{messageId:'om_report',createdAt:'2026-09-24T04:00:00.000Z',sender:{id:reviewer},
    text:'面试结果\n**周小雨**\n颜值8 表现力8\n- **通过**'}],{reviewerOpenId:reviewer});
  assert.equal(parsed.candidates.find(item=>item.name==='周小雨')?.stage,'interview_pass');
  assert.equal(parsed.candidates.some(item=>item.name==='面试结果'),false);
});

test('employment parser accepts only verified coaching reports and keeps expected versus actual dates separate', () => {
  const parsed = parseEmploymentMessages([
    {messageId:'e1',createdAt:'2026-09-04T01:10:00.000Z',sender:{id:'ou_reviewer',name:'倪梦萍'},text:'新人主播-谢红香已入职；谢红香考核通过。'},
    {messageId:'e2',createdAt:'2026-09-04T02:10:00.000Z',sender:{id:'ou_other',name:'倪梦萍'},text:'新人主播-李梓恒已入职；李梓恒考核通过。'},
    {messageId:'e3',createdAt:'2026-09-04T03:10:00.000Z',sender:{id:'ou_reviewer',name:'倪梦萍'},text:'新人主播-王小花考核通过。'},
  ],{reviewerOpenId:'ou_reviewer'});
  assert.equal(parsed.candidates.length, 2);
  assert.equal(parsed.candidates[0].name, '谢红香');
  assert.equal(parsed.candidates[0].stage, 'hired');
  assert.equal(parsed.candidates[0].actualStartDate, '2026-09-04');
  assert.equal(parsed.candidates[0].assessmentPassed, true);
  assert.equal(parsed.candidates[0].source, 'WIS直播战队');
  assert.equal(parsed.candidates[1].name,'王小花');
  assert.equal(parsed.candidates[1].stage,'unmapped');
  assert.equal(parsed.candidates[1].actualStartDate,null);
  assert.match(parsed.candidates[1].status,/到岗待核验/u);
});

test('coach summary reads the newest dated section without treating missing fields as zero', () => {
  const parsed = parseLatestCoachSummary(`2026.8.20新人池情况：\n新人池：2人在培\n2026.8.24新人池情况：\n新人池：1人在培中\n培训进度：李楚晴 入职培训第4天；\n项目内编制：22人\n待入职考核：0人\n昨日送审简历数量：4个`);
  assert.deepEqual(parsed, {date:'2026-08-24',inTraining:1,projectHeadcount:22,pendingAssessment:0,yesterdaySubmitted:4,newcomerName:'李楚晴',newcomerDay:4});
});

test('candidate merge preserves historical media but never joins a same-name report without the exact submission ID', () => {
  const base=[{name:'甲',stage:'initial_pass',media:['old.mp4'],inSubmissionCohort:true,
    submissionEvidence:{sourceId:'om_current'}},{name:'乙',stage:'progress'}];
  const unbound=mergeRecruitmentCandidates(base,[{name:'甲',stage:'hired',actualStartDate:'2026-09-04'}]);
  assert.equal(unbound.find(item=>item.name==='甲').stage,'initial_pass');
  const crossCycle=mergeRecruitmentCandidates(base,[{name:'甲',stage:'hired',submissionMessageId:'om_prior',actualStartDate:'2026-09-04'}]);
  assert.equal(crossCycle.find(item=>item.name==='甲').stage,'initial_pass');
  const merged = mergeRecruitmentCandidates(base,[{name:'甲',stage:'hired',submissionMessageId:'om_current',
    actualStartDate:'2026-09-04',timeline:[['今天','精确送审核对']]}]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(item => item.name === '甲').media[0], 'old.mp4');
  assert.equal(merged.find(item => item.name === '甲').stage, 'hired');
  const unresolved=[{name:'甲',submissionEvidence:{sourceId:'om_a'}},
    {name:'甲',submissionEvidence:{sourceId:'om_b'}}];
  assert.equal(mergeRecruitmentCandidates(unresolved,[{name:'甲',stage:'hired'}]).length,2);
});

test('anchor normalization keeps only verified nonempty rooms', () => {
  const parsed = normalizeAnchorReport({date:'2026-08-24',rooms:[
    {name:'官旗',people:[['潘小慧',92,'第1资源位',0,'稳定']]},
    {name:'优选',people:[]},
    {name:'未知房间',people:[['某人',88,'第1资源位',0,'']]}]
  });
  assert.deepEqual(parsed.verifiedRooms, ['官旗']);
  assert.equal(parsed.rooms['官旗'][0].score, 92);
});

test('09:30 and 18:00 scheduler catches up once per China slot', () => {
  assert.equal(isLifecycleRefreshDue({now:new Date('2026-08-24T01:29:00.000Z')}).due, false);
  assert.deepEqual(isLifecycleRefreshDue({now:new Date('2026-08-24T01:30:00.000Z')}), {date:'2026-08-24',slot:'09:30',slotKey:'2026-08-24T09:30',due:true});
  assert.equal(isLifecycleRefreshDue({now:new Date('2026-08-24T02:00:00.000Z'),lastAutomaticSlot:'2026-08-24T09:30'}).due, false);
  assert.equal(isLifecycleRefreshDue({now:new Date('2026-08-24T10:00:00.000Z'),lastAutomaticSlot:'2026-08-24T09:30'}).slot, '18:00');
  assert.equal(isLifecycleRefreshDue({now:new Date('2026-08-24T10:00:00.000Z'),lastAutomaticSlot:'2026-08-24T09:30'}).due, true);
});
