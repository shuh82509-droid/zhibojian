import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {activeChatMessages,readCompleteMessageReactions,linkVerifiedRecruitmentCalendar,recruitmentCycleMonthForDate,recruitmentCycleRange} from '../lifecycle-engine.mjs';

const reaction=(operator_id,emoji_type,index)=>({operator:{operator_id},emoji_type,action_time:String(1700000000000+index)});
const page=(messageId,items,{more=false,token='',count=items.length}={})=>({
  fail_msg_reaction_details:[],
  success_msg_reaction_counts:[{message_id:messageId,reaction_count:count?[{reaction_type:'OK',count:String(count)}]:[]}],
  success_msg_reaction_details:[{message_id:messageId,message_reaction_items:items,has_more:more,...(token?{page_token:token}:{})}],
});

test('batch reaction reader follows every page before accepting a verified zero or reviewer mark',async()=>{
  const ids=['om_empty','om_many'],first=Array.from({length:10},(_,index)=>reaction(`ou_other${index}`,'OK',index));
  const calls=[];
  const results=await readCompleteMessageReactions(ids,async body=>{
    calls.push(body.queries);
    if(calls.length===1)return {
      fail_msg_reaction_details:[],
      success_msg_reaction_counts:[
        {message_id:ids[0],reaction_count:[]},
        {message_id:ids[1],reaction_count:[{reaction_type:'OK',count:'11'}]},
      ],
      success_msg_reaction_details:[
        {message_id:ids[0],message_reaction_items:[],has_more:false},
        {message_id:ids[1],message_reaction_items:first,has_more:true,page_token:'next'},
      ],
    };
    return page(ids[1],[reaction('ou_verified','OK',10)],{count:11});
  });
  assert.equal(calls.length,2);
  assert.deepEqual(calls[1],[{message_id:'om_many',page_token:'next'}]);
  assert.deepEqual(results.get('om_empty'),{counts:[],details:[]});
  assert.equal(results.get('om_many').details.length,11);
  assert.equal(results.get('om_many').details.at(-1).operatorId,'ou_verified');
});

test('partial, missing, changed, or unpaged reactions stay unverified',async()=>{
  const partial=page('om_one',[]);partial.fail_msg_reaction_details=[{message_id:'om_one',fail_reason:'no_permission'}];
  await assert.rejects(readCompleteMessageReactions(['om_one'],async()=>partial),/不完整/);
  await assert.rejects(readCompleteMessageReactions(['om_one'],async()=>({fail_msg_reaction_details:[],success_msg_reaction_counts:[],success_msg_reaction_details:[]})),/缺少完整消息/);
  await assert.rejects(readCompleteMessageReactions(['om_one'],async()=>page('om_one',[reaction('ou_one','OK',1)],{more:true,count:2})),/分页标记无效/);
  await assert.rejects(readCompleteMessageReactions(['om_one'],async()=>page('om_one',[reaction('ou_one','OK',1)],{count:2})),/总数与详情不符/);
});

const serverSource=await readFile(new URL('../server.js',import.meta.url),'utf8');
const isolatedServerFunction=(name,nextName,context)=>{
  const start=serverSource.indexOf(`async function ${name}(`);
  const end=serverSource.indexOf(`\nasync function ${nextName}(`,start);
  assert.ok(start>=0&&end>start,`${name} source boundary must remain findable`);
  return vm.runInNewContext(`${serverSource.slice(start,end)}\n${name}`,context);
};

test('recalled Feishu messages are skipped without hiding source coverage or live reaction failures',async()=>{
  const raw=[
    {message_id:'om_recalled',deleted:true,body:{content:'{"text":"已撤回"}'},create_time:'1790000000000'},
    {message_id:'om_live',deleted:false,body:{content:'{"text":"有效送审"}'},create_time:'1790000001000'},
  ];
  let queried=[];
  const context={
    feishuChats:{recruitment:{chatId:'oc_recruitment',name:'招聘群'}},FeishuError:Error,
    feishuGet:async()=>({items:raw,has_more:true,page_token:'next'}),
    getMessageReactions:async ids=>{queried=ids;return new Map([['om_live',{counts:[{reactionType:'OK',count:1}],details:[{emojiType:'OK',operatorId:'ou_reviewer',actionTime:'1790000002'}]}]]);},
    activeChatMessages,parseMessageContent:rawContent=>JSON.parse(rawContent),messageText:value=>value.text,
    messageResources:()=>[],cached:(_key,_ttl,load)=>load(),feishuCache:new Map(),URLSearchParams,Date,
  };
  const getChatMessages=isolatedServerFunction('getChatMessages','findChatByName',context);
  const result=await getChatMessages('recruitment',2,{fresh:true});
  assert.deepEqual(Array.from(queried),['om_live']);
  assert.equal(result.sourceMessageCount,2);
  assert.equal(result.deletedMessageCount,1);
  assert.equal(result.messages.length,1);
  assert.equal(result.messages[0].messageId,'om_live');
  assert.equal(result.reactionStatus,'已核验');
  assert.equal(result.truncated,true);
  context.getMessageReactions=async ids=>{queried=ids;throw new Error('live reaction unavailable');};
  const failed=await getChatMessages('recruitment',2,{fresh:true});
  assert.deepEqual(Array.from(queried),['om_live']);
  assert.equal(failed.reactionStatus,'待核验');
  assert.match(failed.reactionFailure,/live reaction unavailable/);
  assert.equal(failed.sourceMessageCount,2);
  assert.equal(failed.truncated,true);
});

test('cycle source reads beyond the former 500-message limit and still flags a real cap',async()=>{
  const raw=Array.from({length:562},(_,index)=>({
    message_id:`om_${index}`,deleted:index%100===0,body:{content:'{"text":"来源消息"}'},create_time:String(1790000000000+index),
  }));
  let offset=0;
  const context={
    feishuChats:{coaching:{chatId:'oc_coaching',name:'直播战队'}},FeishuError:Error,
    feishuGet:async()=>{const items=raw.slice(offset,offset+50);offset+=items.length;return {items,has_more:offset<raw.length,page_token:offset<raw.length?`p${offset}`:''};},
    getMessageReactions:async()=>{throw new Error('coaching should not query reactions');},
    activeChatMessages,parseMessageContent:rawContent=>JSON.parse(rawContent),messageText:value=>value.text,
    messageResources:()=>[],cached:(_key,_ttl,load)=>load(),feishuCache:new Map(),URLSearchParams,Date,
  };
  const getChatMessages=isolatedServerFunction('getChatMessages','findChatByName',context);
  const complete=await getChatMessages('coaching',1000,{fresh:true});
  assert.equal(complete.sourceMessageCount,562);
  assert.equal(complete.deletedMessageCount,6);
  assert.equal(complete.messages.length,556);
  assert.equal(complete.truncated,false);

  const more=Array.from({length:1001},(_,index)=>({...raw[0],message_id:`om_more${index}`,deleted:false}));
  offset=0;
  context.feishuGet=async()=>{const items=more.slice(offset,offset+50);offset+=items.length;return {items,has_more:offset<more.length,page_token:offset<more.length?`p${offset}`:''};};
  const capped=await getChatMessages('coaching',1000,{fresh:true});
  assert.equal(capped.sourceMessageCount,1000);
  assert.equal(capped.truncated,true);
});

test('background recruitment snapshot reads the full current cycle for both source chats and calendar',async()=>{
  const calls=[];
  const context={
    recruitmentCycleMonthForDate,recruitmentCycleRange,
    getChatMessages:async(key,limit,window)=>{calls.push({key,limit,window});return {messages:[],sourceMessageCount:0,deletedMessageCount:0,truncated:false,reactionStatus:'已核验'};},
    getDocument:async()=>({content:''}),readRecruitmentCalendar:async window=>{calls.push({key:'calendar',window});return {events:{},status:'已连接：正式面试日历已读取 0 条详情事件。'};},
    parseRecruitmentMessages:()=>({candidates:[],funnel:{},interviewEvents:{},submissionMessageCounts:{},sourceDate:''}),
    parseEmploymentMessages:()=>({candidates:[],sourceDate:''}),mergeRecruitmentCandidates:()=>[],
    supplementalEmploymentCandidates:()=>[],addStructuredAssessments:async candidates=>({candidates,summary:null,status:'待核验'}),
    linkVerifiedRecruitmentCalendar:candidates=>({candidates,matchedCount:0,pendingCount:0}),
    parseLatestCoachSummary:()=>null,recruitmentReviewerOpenId:'ou_reviewer',lifecycleSourceStatus:()=> 'current',
    lifecycleSnapshotPath:()=>'/unused',writeJsonAtomic:async()=>{},structuredClone,Date,
  };
  const refresh=isolatedServerFunction('refreshRecruitmentLifecycle','readRecruitmentCalendar',context);
  await refresh('2026-09-24');
  const september=recruitmentCycleRange('2026-09');
  assert.deepEqual(calls.map(call=>call.key),['recruitment','coaching','calendar']);
  assert.ok(calls.every(call=>JSON.stringify(call.window)===JSON.stringify(september)));
  assert.deepEqual(calls.slice(0,2).map(call=>call.limit),[1000,1000]);
  calls.length=0;
  await refresh('2026-09-25');
  const october=recruitmentCycleRange('2026-10');
  assert.ok(calls.every(call=>JSON.stringify(call.window)===JSON.stringify(october)));
});

test('recruitment page shows pending review figures while reviewer identity is absent, but accepts a true zero',async()=>{
  const html=await readFile(new URL('../exports/recruitment-pool/recruitment-dashboard.html',import.meta.url),'utf8');
  const coverage=html.match(/function verifiedRecruitmentCoverage\(snapshot\)\{[\s\S]*?\n    \}/)?.[0];
  const render=html.match(/function updateDynamicFunnel\(snapshot\)\{[\s\S]*?\n    \}/)?.[0];
  assert.ok(coverage&&render);
  const ids=['metricCandidates','funnelCandidates','metricScreened','funnelScreened','metricInterview','funnelInterview',
    'metricInterviewPassed','funnelInterviewPassed','alertReview','conversionScreened','funnelInterviewScheduled',
    'conversionInterview','conversionInterviewPassed','metricAssessment','funnelAssessment'];
  const elements=Object.fromEntries(ids.map(id=>[id,{textContent:'',title:''}]));
  const queryElements={'#unmatchedHistory summary':{textContent:''},'#unmatchedRecords':{innerHTML:''}};
  const context=vm.createContext({...elements,document:{querySelector:selector=>queryElements[selector],querySelectorAll:()=>[]}});
  vm.runInContext(`${coverage}\n${render}`,context);
  const base={funnel:{candidateCount:49,initialPassedCount:0,initialPendingCount:0,groupEvaluatedCount:0,groupPassedCount:0},
    candidates:[],calendarStatus:'已连接：正式面试日历已读取 58 条详情事件。',
    coverage:{capped:false,chatMessages:375,reactionStatus:'待配置审查人身份',employmentStatus:'已读取',employmentCapped:false}};
  vm.runInContext('updateDynamicFunnel(snapshot)',vm.createContext({...context,snapshot:base}));
  assert.equal(elements.metricCandidates.textContent,49);
  for(const id of ['metricScreened','metricInterview','metricInterviewPassed','alertReview'])assert.equal(elements[id].textContent,'待核验');
  const ready={...base,coverage:{...base.coverage,reactionStatus:'已核验'}};
  vm.runInContext('updateDynamicFunnel(snapshot)',vm.createContext({...context,snapshot:ready}));
  for(const id of ['metricScreened','metricInterview','metricInterviewPassed','alertReview'])assert.equal(elements[id].textContent,0);
  assert.match(html,/id="calendarCoverageRule"/);
  assert.doesNotMatch(html,/正式面试日历待授权；当前仅展示授权群聊中明确记录的面试信息/);
});

const submissionCandidate=(name,{stage='initial_pass',initialReview='OK',sourceId='om_one',date='2026-09-22'}={})=>({
  name,stage,status:stage==='initial_pass'?'初审通过':stage,inSubmissionCohort:true,date,
  timeline:[[date,'已送审']],submissionEvidence:{name,date,sourceId,initialReview},
});
const calendarEvent=(title,eventId='cal_one')=>({name:title,status:'calendar',eventId});

test('only one exact formal event and one verified OK submission advance to interview feedback',()=>{
  const short=submissionCandidate('王丽',{sourceId:'om_short'});
  const target=submissionCandidate('王丽娜',{sourceId:'om_target'});
  const result=linkVerifiedRecruitmentCalendar([short,target],{
    '2026-09-25':[calendarEvent('王丽娜面试 · 15:00')]
  },{'王丽':1,'王丽娜':1},{sourceReady:true,advanceStage:true});
  assert.equal(result.matchedCount,1);
  assert.equal(result.pendingCount,0);
  assert.equal(result.candidates[0].stage,'initial_pass');
  assert.equal(result.candidates[1].stage,'pending_feedback');
  assert.equal(result.candidates[1].calendarEvidence.eventId,'cal_one');
  assert.deepEqual(result.candidates[1].timeline.at(-1),['2026-09-25','正式面试日历已安排：王丽娜面试 · 15:00']);
});

test('ambiguous title, repeated event, repeated submission or missing event id remain pending',()=>{
  const short=submissionCandidate('王丽',{sourceId:'om_short'});
  const long=submissionCandidate('王丽娜',{sourceId:'om_long'});
  const names={'王丽':1,'王丽娜':1};
  const ambiguous=linkVerifiedRecruitmentCalendar([short,long],{'2026-09-25':[calendarEvent('王丽、王丽娜面试')]},names,{sourceReady:true,advanceStage:true});
  assert.equal(ambiguous.matchedCount,null);
  assert.equal(ambiguous.pendingCount,1);
  assert.ok(ambiguous.candidates.every(item=>item.stage==='initial_pass' && item.calendarScheduleStatus?.startsWith('待核验')));
  const duplicate=linkVerifiedRecruitmentCalendar([short],{'2026-09-25':[calendarEvent('王丽面试','cal_a'),calendarEvent('王丽复试','cal_b')]},names,{sourceReady:true,advanceStage:true});
  assert.equal(duplicate.matchedCount,null);
  assert.equal(duplicate.candidates[0].stage,'initial_pass');
  const repeatedSubmission=linkVerifiedRecruitmentCalendar([short],{'2026-09-25':[calendarEvent('王丽面试')]},{'王丽':2},{sourceReady:true,advanceStage:true});
  assert.equal(repeatedSubmission.matchedCount,null);
  const noId=linkVerifiedRecruitmentCalendar([short],{'2026-09-25':[calendarEvent('王丽面试','')]},names,{sourceReady:true,advanceStage:true});
  assert.equal(noId.matchedCount,null);
  const sharedSubmission=linkVerifiedRecruitmentCalendar([
    submissionCandidate('王丽',{sourceId:'om_shared'}),submissionCandidate('王丽娜',{sourceId:'om_shared'})
  ],{'2026-09-25':[calendarEvent('王丽面试','cal_short'),calendarEvent('王丽娜面试','cal_long')]},names,{sourceReady:true,advanceStage:true});
  assert.equal(sharedSubmission.matchedCount,null);
  assert.ok(sharedSubmission.candidates.every(item=>item.stage==='initial_pass'));
  const sharedEventId=linkVerifiedRecruitmentCalendar([short,long],{
    '2026-09-25':[calendarEvent('王丽面试','cal_shared'),calendarEvent('王丽娜面试','cal_shared')]
  },names,{sourceReady:true,advanceStage:true});
  assert.equal(sharedEventId.matchedCount,null);
});

test('unverified reaction, prior date, negative review and higher-stage conclusions never auto-promote',()=>{
  const target=submissionCandidate('李华',{sourceId:'om_target'});
  const events={'2026-09-25':[calendarEvent('李华正式面试')]};
  const counts={'李华':1};
  const unverified=linkVerifiedRecruitmentCalendar([target],events,counts,{sourceReady:true,advanceStage:false});
  assert.equal(unverified.candidates[0].stage,'initial_pass');
  assert.equal(unverified.candidates[0].timeline.length,1);
  const negative=linkVerifiedRecruitmentCalendar([submissionCandidate('李华',{stage:'initial_fail',initialReview:'No',sourceId:'om_target'})],events,counts,{sourceReady:true,advanceStage:true});
  assert.equal(negative.candidates[0].stage,'initial_fail');
  assert.equal(negative.matchedCount,null);
  assert.match(negative.candidates[0].calendarScheduleStatus,/待核验/);
  const higher=linkVerifiedRecruitmentCalendar([submissionCandidate('李华',{stage:'interview_pass',sourceId:'om_target'})],events,counts,{sourceReady:true,advanceStage:true});
  assert.equal(higher.candidates[0].stage,'interview_pass');
  assert.equal(higher.matchedCount,null);
  assert.match(higher.candidates[0].calendarScheduleStatus,/待核验/);
  const early=linkVerifiedRecruitmentCalendar([target],{'2026-09-21':[calendarEvent('李华面试')]},counts,{sourceReady:true,advanceStage:true});
  assert.equal(early.matchedCount,null);
  assert.equal(early.candidates[0].stage,'initial_pass');
  const sourceAbsent=linkVerifiedRecruitmentCalendar([target],events,counts,{sourceReady:false,advanceStage:true});
  assert.equal(sourceAbsent.matchedCount,null);
  assert.equal(sourceAbsent.pendingCount,null);
  assert.equal(sourceAbsent.candidates[0].stage,'initial_pass');
});
