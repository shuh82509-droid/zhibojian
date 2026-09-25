import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {inspectInterviewPost,verifyInterviewBindingSources,projectInterviewBindings} from '../interview-binding.mjs';
import {centralFeishuOpenId,recruitmentCycleRange,recruitmentBoundaryCycleRange,
  parseRecruitmentMessages,linkRecruitmentCalendarAcrossBoundary} from '../lifecycle-engine.mjs';

const reviewer='ou_0e5926902d4d6051d0ea14f042bb56f4';
const chatId='oc_b66a4cb78495045fce0caed731d7870e';
const calendarId='calendar_official';
const options={reviewerOpenId:reviewer,recruitmentChatId:chatId,calendarId,today:'2026-09-25',now:'2026-09-25T00:00:00.000Z'};
function fixture(){
  const title='周小雨正式面试 · 16:00';
  const submission={messageId:'om_submission',chatId,type:'text',text:'候选人：求职者【周小雨】是否符合【主播】的邀约标准',
    sender:{id:'ou_recruiter'},createdAt:'2026-09-23T03:00:00.000Z',updatedAt:null};
  const post={messageId:'om_post',chatId,type:'post',
    text:'面试结果\n**周小雨**\n颜值4 表现力4\n- 自然流话术较琐碎，须补充用户疑问处理。\n- **不通过**@倪梦萍',
    sender:{id:reviewer},createdAt:'2026-09-24T10:00:00.000Z',updatedAt:null};
  const candidate={name:'周小雨',stage:'pending_feedback',status:'待面评',inSubmissionCohort:true,
    submissionEvidence:{name:'周小雨',sourceId:'om_submission',date:'2026-09-23',initialReview:'OK'},
    calendarEvidence:{eventId:'evt_one',date:'2026-09-24',title}};
  const snapshot={cycle:recruitmentCycleRange('2026-09'),calendarStatus:'已连接：正式面试日历已读取 1 条详情事件。',
    coverage:{capped:false,reactionStatus:'已核验',chatMessages:2},
    candidates:[candidate],submissionMessageCounts:{周小雨:1},
    interviewEvents:{'2026-09-24':[{eventId:'evt_one',name:title,status:'calendar',summaryFingerprint:'a'.repeat(64),
      startAt:'2026-09-24T07:30:00.000Z',endAt:'2026-09-24T08:30:00.000Z'}]},
    funnel:{groupEvaluatedCount:0,groupPassedCount:0}};
  const chat={key:'recruitment',chatId,truncated:false,paginationIssue:'',reactionStatus:'已核验',
    sourceMessageCount:2,deletedMessageCount:0,messages:[submission,post]};
  const payload={cycleMonth:'2026-09',candidateName:'周小雨',submissionMessageId:'om_submission',
    calendarEventId:'evt_one',postMessageId:'om_post',outcome:'fail'};
  return {snapshot,chat,payload};
}

function crossFixture(){
  const cycle=recruitmentCycleRange('2026-10');
  const previous=recruitmentBoundaryCycleRange('2026-10').previous;
  const submission={messageId:'om_previous_submission',chatId,type:'text',
    text:'候选人：求职者【周小雨】是否符合【主播】的邀约标准',
    sender:{id:'ou_recruiter'},createdAt:'2026-09-24T03:00:00.000Z',updatedAt:null,
    reactions:{details:[{emojiType:'OK',operatorId:reviewer}]}};
  const post={messageId:'om_current_post',chatId,type:'post',
    text:'面试结果\n**周小雨**\n颜值4 表现力4\n- 镜头状态稳定，互动自然；\n- **不通过**@倪梦萍',
    sender:{id:reviewer},createdAt:'2026-09-25T09:00:00.000Z',updatedAt:null};
  const previousChat={key:'recruitment',chatId,truncated:false,paginationIssue:'',reactionStatus:'已核验',
    sourceMessageCount:1,deletedMessageCount:0,messages:[submission]};
  const chat={key:'recruitment',chatId,truncated:false,paginationIssue:'',reactionStatus:'已核验',
    sourceMessageCount:1,deletedMessageCount:0,messages:[post]};
  const prior=parseRecruitmentMessages(previousChat.messages,{reviewerOpenId:reviewer});
  const current=parseRecruitmentMessages(chat.messages,{reviewerOpenId:reviewer});
  const event={eventId:'evt_cross',name:'周小雨正式面试 · 16:00',status:'calendar',
    summaryFingerprint:'c'.repeat(64),startAt:'2026-09-25T07:30:00.000Z',
    endAt:'2026-09-25T08:30:00.000Z'};
  const interviewEvents={'2026-09-25':[event]};
  const linked=linkRecruitmentCalendarAcrossBoundary(current.candidates,prior,interviewEvents,
    current.submissionMessageCounts,{boundaryDate:'2026-09-25',previousCycle:previous,
      currentSourceReady:true,previousSourceReady:true,advanceStage:true});
  const snapshot={cycle,calendarStatus:'已连接：正式面试日历已读取 1 条详情事件。',
    coverage:{capped:false,reactionStatus:'已核验'},candidates:linked.candidates,
    submissionMessageCounts:current.submissionMessageCounts,boundaryCarryover:linked.boundary,
    interviewEvents,funnel:{groupEvaluatedCount:0,groupPassedCount:0}};
  const payload={cycleMonth:'2026-10',sourceCycleMonth:'2026-09',candidateName:'周小雨',
    submissionMessageId:submission.messageId,calendarEventId:event.eventId,
    postMessageId:post.messageId,outcome:'fail'};
  return {snapshot,chat,previousChat,payload,prior,current,linked,previous,event};
}

test('跨周期首日本期仅有面评时合并成唯一待签候选，并以双周期源签署读回',()=>{
  const {snapshot,chat,previousChat,payload,current,linked}=crossFixture();
  assert.equal(current.candidates.length,1,JSON.stringify(current));
  assert.equal(current.candidates[0].inSubmissionCohort,false);
  assert.equal(linked.boundary.status,'verified');
  assert.equal(snapshot.candidates.length,1);
  assert.equal(snapshot.candidates[0].boundaryCarryover,true);
  assert.equal(snapshot.candidates[0].stage,'pending_feedback');
  const crossOptions={...options,today:'2026-09-25',now:'2026-09-25T10:00:00.000Z',previousChat};
  assert.equal(projectInterviewBindings(snapshot,chat,[],crossOptions).candidates[0].interviewBinding.status,'pending');
  const verified=verifyInterviewBindingSources(snapshot,chat,payload,crossOptions);
  assert.equal(verified.status,'ready',verified.reason);
  assert.equal(verified.sourceCycleMonth,'2026-09');
  const entry={...verified,id:'2a3b6e38-8090-425c-bb0a-57e95fb316a5',actorOpenId:reviewer,
    source:'structured_self_interview_binding',createdAt:'2026-09-25T10:00:00.000Z'};
  const readback=projectInterviewBindings(snapshot,chat,[entry],crossOptions);
  assert.equal(readback.candidates[0].interviewBinding.status,'verified');
  assert.equal(readback.candidates[0].stage,'interview_fail');
  const editedPrior={...previousChat,messages:[{...previousChat.messages[0],updatedAt:'2026-09-25T10:30:00.000Z'}]};
  assert.equal(projectInterviewBindings(snapshot,chat,[entry],{...crossOptions,previousChat:editedPrior})
    .candidates[0].interviewBinding.status,'pending');
  const editedPost={...chat,messages:[{...chat.messages[0],updatedAt:'2026-09-25T10:30:00.000Z'}]};
  assert.equal(projectInterviewBindings(snapshot,editedPost,[entry],crossOptions)
    .candidates[0].interviewBinding.status,'pending');
  const hiddenRepeat={...chat,messages:[{...chat.messages[0],
    reviewText:`${chat.messages[0].text}\n**周小雨**\n颜值4 表现力4\n- **通过**@倪梦萍`}]};
  assert.equal(projectInterviewBindings(snapshot,hiddenRepeat,[entry],crossOptions)
    .candidates[0].interviewBinding.status,'pending');
});

test('跨周期同名、重复、撤回、来源不完整及改判均保持待核验',()=>{
  const {snapshot,chat,previousChat,payload,prior,current,previous,event}=crossFixture();
  const crossOptions={...options,today:'2026-09-25',now:'2026-09-25T10:00:00.000Z',previousChat};
  const check=(changedSnapshot=snapshot,changedChat=chat,changedPayload=payload,changedOptions=crossOptions)=>
    verifyInterviewBindingSources(changedSnapshot,changedChat,changedPayload,changedOptions).status;
  assert.equal(check(snapshot,chat,{...payload,sourceCycleMonth:'2026-10'}),'pending');
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:null}),'pending');
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:{...previousChat,truncated:true}}),'pending');
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:{...previousChat,sourceMessageCount:2}}),'pending');
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:{...previousChat,reactionStatus:'待核验'}}),'pending');
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:{...previousChat,messages:[
    {...previousChat.messages[0],reactions:{details:[{emojiType:'No',operatorId:reviewer}]}}]}}),'pending');
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:{...previousChat,
    sourceMessageCount:1,deletedMessageCount:1,messages:[]}}),'pending');
  const second={...previousChat.messages[0],messageId:'om_same_name_again',createdAt:'2026-09-24T04:00:00.000Z'};
  const repeated={...previousChat,sourceMessageCount:2,messages:[...previousChat.messages,second]};
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:repeated}),'pending');
  const priorMention={messageId:'om_prior_other',chatId,type:'text',text:'周小雨面试情况另议',
    sender:{id:'ou_recruiter'},createdAt:'2026-09-24T04:00:00.000Z'};
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:{...previousChat,
    sourceMessageCount:2,messages:[...previousChat.messages,priorMention]}}),'pending');
  const opaquePrior={...priorMention,text:'',type:'image',sender:{id:reviewer}};
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:{...previousChat,
    sourceMessageCount:2,messages:[...previousChat.messages,opaquePrior]}}),'pending');
  const hiddenPrior={...priorMention,text:'求职者【林小满】是否符合【主播】的邀约标准',
    reviewTextTruncated:true,sender:{id:'ou_another_recruiter'}};
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:{...previousChat,
    sourceMessageCount:2,messages:[...previousChat.messages,hiddenPrior]}}),'pending');
  const hiddenPriorMedia={...hiddenPrior,reviewTextTruncated:false,type:'image',
    hasMediaOrResource:true};
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:{...previousChat,
    sourceMessageCount:2,messages:[...previousChat.messages,hiddenPriorMedia]}}),'pending');
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:{...previousChat,
    messages:[{...previousChat.messages[0],textTruncated:true}]}}),'pending');
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:{...previousChat,
    messages:[{...previousChat.messages[0],hasMediaOrResource:true}]}}),'pending');
  assert.equal(check(snapshot,chat,payload,{...crossOptions,previousChat:{...previousChat,
    messages:[{...previousChat.messages[0],reviewText:
      `${previousChat.messages[0].text}\n求职者【林小满】是否符合【主播】的邀约标准`}]}}),'pending');
  const newSubmission={messageId:'om_current_submission',chatId,type:'text',
    text:previousChat.messages[0].text,createdAt:'2026-09-25T02:00:00.000Z',sender:{id:'ou_recruiter'},
    reactions:{details:[{emojiType:'OK',operatorId:reviewer}]}};
  const conflicted=parseRecruitmentMessages([newSubmission,chat.messages[0]],{reviewerOpenId:reviewer});
  const linked=linkRecruitmentCalendarAcrossBoundary(conflicted.candidates,prior,{'2026-09-25':[event]},
    conflicted.submissionMessageCounts,{boundaryDate:'2026-09-25',previousCycle:previous,
      currentSourceReady:true,previousSourceReady:true});
  assert.equal(linked.boundary.status,'pending');
  assert.equal(check({...snapshot,boundaryCarryover:{status:'pending'}}),'pending');
  assert.equal(check(snapshot,{...chat,messages:[{...chat.messages[0],text:'面试结果\n**周小雨**\n颜值4 表现力4\n- **通过**@倪梦萍'}]}),'pending');
  assert.equal(check(snapshot,{...chat,messages:[{...chat.messages[0],hasMediaOrResource:true}]}),'pending');
  const earlierPost={...chat.messages[0],messageId:'om_earlier_same_name',
    createdAt:'2026-09-25T07:00:00.000Z'};
  assert.equal(check(snapshot,{...chat,sourceMessageCount:2,messages:[earlierPost,...chat.messages]}),'pending');
  const hiddenCurrent={messageId:'om_other_recruiter',chatId,type:'text',
    text:'求职者【林小满】待确认',textTruncated:true,
    sender:{id:'ou_another_recruiter'},createdAt:'2026-09-25T06:00:00.000Z'};
  assert.equal(check(snapshot,{...chat,sourceMessageCount:2,
    messages:[hiddenCurrent,...chat.messages]}),'pending');
  assert.equal(current.candidates[0].evaluationEvidence.sourceId,'om_current_post');
});

test('跨周期本人 GET 仅展示双源完整选项，POST 写入源周期并拒绝重签',async()=>{
  const {snapshot,chat,previousChat,payload}=crossFixture();
  const verifiedAt=(snap,current,request,opts)=>verifyInterviewBindingSources(snap,current,request,
    {...opts,now:'2026-09-25T10:00:00.000Z'});
  const optionsCode=(await readFile(new URL('../server.js',import.meta.url),'utf8'))
    .split('function interviewBindingOptions(')[1].split('async function submitInterviewBinding(')[0];
  const offer=vm.runInNewContext(`function interviewBindingOptions(${optionsCode}\ninterviewBindingOptions`,{
    verifiedRecruitmentReviewerOpenId:reviewer,inspectInterviewPost,
    verifyInterviewBindingSources:verifiedAt,
    recruitmentReviewerOpenId:reviewer,recruitmentCalendarId:calendarId,
    feishuChats:{recruitment:{chatId}},chinaDateFor:()=> '2026-09-25',
  })(snapshot,chat,previousChat);
  assert.equal(offer.length,1);
  assert.equal(offer[0].sourceCycleMonth,'2026-09');
  assert.equal(offer[0].submissionMessageId,'om_previous_submission');
  assert.equal(offer[0].postMessageId,'om_current_post');
  const submitCode=(await readFile(new URL('../server.js',import.meta.url),'utf8'))
    .split('async function submitInterviewBinding(')[1].split('async function lifecycleApi(')[0];
  class FeishuError extends Error {constructor(message,status,code){super(message);this.status=status;this.code=code}}
  let journal={schemaVersion:1,entries:[]},writes=0;
  const submit=vm.runInNewContext(`async function submitInterviewBinding(${submitCode}\nsubmitInterviewBinding`,{
    interviewBindingEnabled:true,verifiedInterviewBindingActor:async()=>reviewer,
    FeishuError,recruitmentCycleRange,readRequestJson:async req=>req.payload,
    interviewBindingLock:{run:fn=>fn()},interviewBindingSources:async()=>({snapshot,chat,previousChat}),
    verifyInterviewBindingSources:verifiedAt,feishuChats:{recruitment:{chatId}},
    recruitmentCalendarId:calendarId,chinaDateFor:()=> '2026-09-25',
    readRecruitmentInterviewJournal:async()=>journal,
    writeDurableJsonAtomic:async(_path,next)=>{journal=structuredClone(next);writes+=1},
    interviewBindingPath:'/candidate-only',randomUUID:()=> '2a3b6e38-8090-425c-bb0a-57e95fb316a5',URL,
  });
  const req={headers:{origin:'https://hub.fandow.com',host:'hub.fandow.com',
    'sec-fetch-site':'same-origin','x-requested-with':'XMLHttpRequest','content-type':'application/json'},
    payload:{...payload,expectedSourceFingerprint:offer[0].sourceFingerprint}};
  const response=await submit(req,{});
  assert.equal(response.submissionMessageId,'om_previous_submission');
  assert.equal(writes,1);
  assert.equal(journal.entries[0].sourceCycleMonth,'2026-09');
  assert.equal(journal.entries[0].cycleMonth,'2026-10');
  await assert.rejects(submit(req,{}),error=>error.status===409);
  assert.equal(writes,1);
});

test('跨周期实时读取仅取当期、前期各一份招聘群快照与一份正式日历',async()=>{
  const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function interviewBindingSources('),
    source.indexOf('function interviewBindingOptions('));
  const calls=[];
  const current={key:'recruitment',period:'2026-10'};
  const prior={key:'recruitment',period:'2026-09'};
  const calendar={events:{'2026-09-25':[{status:'calendar',eventId:'evt_cross'}]},status:'已连接：1'};
  const read=vm.runInNewContext(`${code}\ninterviewBindingSources`,{
    recruitmentCycleRange:month=>({month,period:'current'}),
    recruitmentBoundaryCycleRange:()=>({date:'2026-09-25',previous:{period:'previous'}}),
    getChatMessages:async(_key,_limit,opts)=>{calls.push(['chat',opts.period,opts.includeReviewText]);
      return opts.period==='previous'?prior:current},
    readRecruitmentCalendar:async()=>{calls.push(['calendar']);return calendar},
    recruitmentCycleSnapshot:async(_month,opts)=>{calls.push(['snapshot',opts.previousChatProvided,
      opts.recruitmentChat===current,opts.previousRecruitmentChat===prior,
      opts.calendarSource===calendar]);return {cycle:{month:'2026-10'}}},
  });
  const result=await read('2026-10');
  assert.equal(result.chat,current);
  assert.equal(result.previousChat,prior);
  assert.deepEqual(calls,[['chat','current',true],['calendar'],['chat','previous',true],
    ['snapshot',true,true,true,true]]);
});

test('本人富文本帖允许自由描述，但仅末尾明确结论与唯一标题可用于本人签署',()=>{
  const {chat}=fixture();
  assert.deepEqual(inspectInterviewPost(chat.messages[1],'周小雨',['周小雨']).status,'ready');
  assert.equal(inspectInterviewPost(chat.messages[1],'周小雨',['周小雨']).outcome,'fail');
  assert.equal(inspectInterviewPost({...chat.messages[1],text:'面试结果\n**周小雨**\n颜值4 表现力4\n- 说过没有通过。'},'周小雨',['周小雨']).status,'pending');
  assert.equal(inspectInterviewPost({...chat.messages[1],text:'面试结果\n**周小雨**\n颜值4 表现力4\n- 林小满也须复核\n- **不通过**'},'周小雨',['周小雨','林小满']).status,'pending');
  assert.equal(inspectInterviewPost({...chat.messages[1],text:'面试结果\n**周小雨**\n颜值4 表现力4\n**林小满**\n颜值3 表现力3\n- **不通过**'},'周小雨',['周小雨','林小满']).status,'pending');
  assert.equal(inspectInterviewPost({...chat.messages[1],text:'面试结果\n**周小雨**\n颜值4 表现力4\n**未知新人**\n颜值3 表现力3\n- **不通过**'},'周小雨',['周小雨']).status,'pending');
});

test('当期名单以外的第二人混入自由描述时不能归属末尾结论',()=>{
  const {snapshot,chat,payload}=fixture();
  const mixed={...chat.messages[1],text:'面试结果\n**周小雨**\n颜值4 表现力4\n- 李晓燕也参加本轮面试，镜头状态一般\n- **不通过**@倪梦萍'};
  assert.equal(inspectInterviewPost(mixed,'周小雨',['周小雨']).status,'pending');
  assert.equal(verifyInterviewBindingSources(snapshot,{...chat,messages:[chat.messages[0],mixed]},payload,options).status,'pending');
  assert.equal(inspectInterviewPost({...chat.messages[1],textTruncated:true},'周小雨',['周小雨']).status,'pending');
  assert.equal(inspectInterviewPost({...chat.messages[1],hasMediaOrResource:true},'周小雨',['周小雨']).status,'pending');
  assert.equal(inspectInterviewPost({...chat.messages[1],resources:[{type:'image',key:'img_one'}]},'周小雨',['周小雨']).status,'pending');
});

test('三项精确来源加本人身份和帖末结论共同构成可绑定证据',()=>{
  const {snapshot,chat,payload}=fixture();
  const result=verifyInterviewBindingSources(snapshot,chat,payload,options);
  assert.equal(result.status,'ready');
  assert.equal(result.outcome,'fail');
  assert.match(result.sourceFingerprint,/^[a-f0-9]{64}$/u);
  assert.equal(verifyInterviewBindingSources(snapshot,chat,{...payload,outcome:'pass'},options).status,'pending');
  assert.equal(verifyInterviewBindingSources(snapshot,chat,{...payload,submissionMessageId:'om_fake'},options).status,'pending');
  assert.equal(verifyInterviewBindingSources(snapshot,chat,{...payload,calendarEventId:'evt_fake'},options).status,'pending');
  assert.equal(verifyInterviewBindingSources(snapshot,chat,{...payload,postMessageId:'om_fake'},options).status,'pending');
  assert.equal(verifyInterviewBindingSources(snapshot,chat,{...payload,cycleMonth:'2026-10'},options).status,'pending');
  assert.equal(verifyInterviewBindingSources(snapshot,chat,payload,{...options,now:'2026-09-24T08:00:00.000Z'}).status,'pending');
  const beforeEnd={...chat,messages:[chat.messages[0],{...chat.messages[1],createdAt:'2026-09-24T08:00:00.000Z'}]};
  assert.equal(verifyInterviewBindingSources(snapshot,beforeEnd,payload,options).status,'pending');
});

test('第二人未出现在当期名单时，具名结论或第二份面评仍不能绑定到首人',()=>{
  const {snapshot,chat,payload}=fixture();
  for(const body of [
    '林小满：通过',
    '- 林小满：通过',
    '- **通过**@倪梦萍',
    '- **周小雨：通过**',
    '- 结论（林小满）：通过',
    '林小满：颜值8 表现力8',
    '**林小满**\n待补充评分',
    '- **林小满**',
    '- 林小满',
    '- 林小满：淘汰',
    '- 林小满：面评如下',
    '- 求职者【林小满】',
    '- 林小满：颜值8 表现力8',
    '- 林小满：通**过**',
    '- **通**过',
    '- __林小满__',
    '- 淘汰 ✅',
  ]){
    const mixed={...chat.messages[1],text:`**周小雨**\n颜值4 表现力4\n${body}\n- **不通过**@倪梦萍`};
    assert.equal(inspectInterviewPost(mixed,'周小雨',['周小雨']).status,'pending',body);
    assert.equal(verifyInterviewBindingSources(snapshot,{...chat,messages:[chat.messages[0],mixed]},payload,options).status,'pending',body);
  }
  const verified=verifyInterviewBindingSources(snapshot,chat,payload,options);
  const signed={...verified,id:'65acc534-c889-47e9-a80e-9832bd142039',actorOpenId:reviewer,
    source:'structured_self_interview_binding',createdAt:'2026-09-24T11:00:00.000Z'};
  const edited={...chat,messages:[chat.messages[0],{...chat.messages[1],
    text:'**周小雨**\n颜值4 表现力4\n- 林小满：通过\n- **不通过**@倪梦萍'}]};
  const reread=projectInterviewBindings(snapshot,edited,[signed],options);
  assert.equal(reread.candidates[0].interviewBinding.status,'pending');
  assert.equal(reread.funnel.groupEvaluatedCount,0);
});

test('同名、初审未通过、多日历事件、伪造发送人及撤回帖均保持待核验',()=>{
  const {snapshot,chat,payload}=fixture();
  assert.equal(verifyInterviewBindingSources({...snapshot,submissionMessageCounts:{周小雨:2}},chat,payload,options).status,'pending');
  const no={...snapshot,candidates:[{...snapshot.candidates[0],submissionEvidence:{...snapshot.candidates[0].submissionEvidence,initialReview:'No'}}]};
  assert.equal(verifyInterviewBindingSources(no,chat,payload,options).status,'pending');
  const events={...snapshot,interviewEvents:{'2026-09-24':[...snapshot.interviewEvents['2026-09-24'],snapshot.interviewEvents['2026-09-24'][0]]}};
  assert.equal(verifyInterviewBindingSources(events,chat,payload,options).status,'pending');
  const forged={...chat,messages:[chat.messages[0],{...chat.messages[1],sender:{id:'ou_other'}}]};
  assert.equal(verifyInterviewBindingSources(snapshot,forged,payload,options).status,'pending');
  const recalled={...chat,messages:[chat.messages[0]],sourceMessageCount:2,deletedMessageCount:1};
  assert.equal(verifyInterviewBindingSources(snapshot,recalled,payload,options).status,'pending');
});

test('同一候选人的两条本人面评帖即使结论一致，也不能任选其中一条绑定',()=>{
  const {snapshot,chat,payload}=fixture();
  const second={...chat.messages[1],messageId:'om_second_post',
    text:'面试结果\n**周小雨**\n颜值4 表现力4\n- **通过**@倪梦萍',
    createdAt:'2026-09-24T10:30:00.000Z'};
  const two={...chat,sourceMessageCount:3,messages:[...chat.messages,second]};
  assert.match(verifyInterviewBindingSources(snapshot,two,payload,options).reason,/另一条本人结果/u);
  assert.equal(verifyInterviewBindingSources(snapshot,two,{...payload,postMessageId:'om_second_post',outcome:'pass'},options).status,'pending');
  const original=verifyInterviewBindingSources(snapshot,chat,payload,options);
  const signed={...original,id:'65acc534-c889-47e9-a80e-9832bd142039',actorOpenId:reviewer,
    source:'structured_self_interview_binding',createdAt:'2026-09-24T11:00:00.000Z'};
  assert.equal(projectInterviewBindings(snapshot,two,[signed],options).candidates[0].interviewBinding.status,'pending');
  assert.equal(projectInterviewBindings(snapshot,two,[signed],options).funnel.groupEvaluatedCount,0);
  const sameConclusion={...two,messages:[...chat.messages,{...second,
    text:'面试结果\n**周小雨**\n颜值4 表现力4\n- **不通过**@倪梦萍'}]};
  assert.equal(verifyInterviewBindingSources(snapshot,sameConclusion,payload,options).status,'pending');
  const correction={...two,messages:[...chat.messages,{...second,type:'text',text:'更正：周小雨面试通过。'}]};
  assert.equal(verifyInterviewBindingSources(snapshot,correction,payload,options).status,'pending');
});

test('本人面试后另发同名口语结论、截断帖或不完整富文本时原绑定保持待核验',()=>{
  const {snapshot,chat,payload}=fixture();
  for(const extra of [
    {type:'text',text:'周小雨：淘汰'},
    {type:'text',text:'周小雨：录用'},
    {type:'text',text:'周小雨：待定'},
    {type:'post',text:'其它候选人的面评'.repeat(500),textTruncated:true},
    {type:'post',text:'其它候选人的面评',reviewTextTruncated:true},
    {type:'post',text:'其它候选人的面评',hasMediaOrResource:true},
    {type:'image',text:'',resources:[{type:'image',key:'img_one'}]},
    {type:'file',text:'',resources:[{type:'file',key:'file_one'}]},
    {type:'audio',text:'',hasMediaOrResource:true},
    {type:'media',text:'',hasMediaOrResource:true},
    {type:'interactive',text:'卡片内容'},
  ]){
    const second={...extra,messageId:'om_later',chatId,sender:{id:reviewer},createdAt:'2026-09-24T10:30:00.000Z'};
    const expanded={...chat,sourceMessageCount:3,messages:[...chat.messages,second]};
    assert.equal(verifyInterviewBindingSources(snapshot,expanded,payload,options).status,'pending',extra.text.slice(0,20));
  }
  const unrelated={...chat.messages[1],messageId:'om_other',text:'面试结果\n**陈小河**\n颜值4 表现力4\n- **通过**@倪梦萍',createdAt:'2026-09-24T10:30:00.000Z'};
  assert.equal(verifyInterviewBindingSources(snapshot,{...chat,sourceMessageCount:3,messages:[...chat.messages,unrelated]},payload,options).status,'ready');
  for(const type of ['system','notice','reaction']){
    const metadata={messageId:'om_metadata',chatId,type,text:'周小雨：通过',sender:{id:reviewer},createdAt:'2026-09-24T10:30:00.000Z'};
    assert.equal(verifyInterviewBindingSources(snapshot,{...chat,sourceMessageCount:3,messages:[...chat.messages,metadata]},payload,options).status,'ready',type);
  }
});

test('本人签署投影有读回；来源变更、重复记录或自动结论冲突不冒充面试通过',()=>{
  const {snapshot,chat,payload}=fixture();
  const verified=verifyInterviewBindingSources(snapshot,chat,payload,options);
  const entry={...verified,id:'65acc534-c889-47e9-a80e-9832bd142039',actorOpenId:reviewer,
    source:'structured_self_interview_binding',createdAt:'2026-09-24T11:00:00.000Z'};
  const one=projectInterviewBindings(snapshot,chat,[entry],options);
  assert.equal(one.candidates[0].stage,'interview_fail');
  assert.equal(one.candidates[0].interviewBinding.status,'verified');
  assert.equal(one.funnel.groupEvaluatedCount,1);
  assert.equal(one.funnel.groupPassedCount,0);
  const changed={...chat,messages:[chat.messages[0],{...chat.messages[1],updatedAt:'2026-09-24T12:00:00.000Z'}]};
  const stale=projectInterviewBindings(snapshot,changed,[entry],options);
  assert.equal(stale.candidates[0].interviewBinding.status,'pending');
  const changedSubmission={...chat,messages:[{...chat.messages[0],resources:[{type:'file',key:'changed'}]},chat.messages[1]]};
  assert.equal(projectInterviewBindings(snapshot,changedSubmission,[entry],options).candidates[0].interviewBinding.status,'pending');
  const changedRichText={...chat,messages:[chat.messages[0],{...chat.messages[1],contentFingerprint:'different_link_target'}]};
  assert.equal(projectInterviewBindings(snapshot,changedRichText,[entry],options).candidates[0].interviewBinding.status,'pending');
  const changedCalendar={...snapshot,interviewEvents:{'2026-09-24':[{...snapshot.interviewEvents['2026-09-24'][0],
    summaryFingerprint:'b'.repeat(64)}]}};
  assert.equal(projectInterviewBindings(changedCalendar,chat,[entry],options).candidates[0].interviewBinding.status,'pending');
  const laterDuplicate={...snapshot,submissionMessageCounts:{周小雨:2},
    candidates:[{...snapshot.candidates[0],stage:'unmapped',submissionIdentityStatus:'ambiguous',
      submissionEvidence:{name:'周小雨',sourceId:'',date:'',initialReview:null}}]};
  const lost=projectInterviewBindings(laterDuplicate,chat,[entry],options);
  assert.equal(lost.candidates[0].stage,'unmapped');
  assert.equal(lost.interviewBindings[0].status,'pending');
  const duplicate=projectInterviewBindings(snapshot,chat,[entry,{...entry,id:'5b313142-628e-4fe2-89a0-cb54efb1d301'}],options);
  assert.equal(duplicate.candidates[0].interviewBinding.status,'pending');
  const conflictSnapshot={...snapshot,candidates:[{...snapshot.candidates[0],stage:'interview_pass',evaluationEvidence:{passed:true}}]};
  const conflict=projectInterviewBindings(conflictSnapshot,chat,[entry],options);
  assert.equal(conflict.candidates[0].stage,'pending_feedback');
  assert.equal(conflict.candidates[0].interviewBinding.status,'pending');
  const autoOnly={...snapshot,candidates:[{...snapshot.candidates[0],stage:'interview_pass',evaluationEvidence:{passed:true}}],
    funnel:{groupEvaluatedCount:1,groupPassedCount:1}};
  const unbound=projectInterviewBindings(autoOnly,chat,[],options);
  assert.equal(unbound.candidates[0].stage,'pending_feedback');
  assert.equal(unbound.funnel.groupEvaluatedCount,0);
  assert.equal(unbound.funnel.groupPassedCount,0);
  const arrivedWithoutBinding={...snapshot,candidates:[{...snapshot.candidates[0],stage:'hired',
    actualStartDate:'2026-09-24',status:'已入职'}]};
  const unboundArrival=projectInterviewBindings(arrivedWithoutBinding,chat,[],options);
  assert.equal(unboundArrival.candidates[0].stage,'pending_feedback');
  assert.equal(unboundArrival.candidates[0].actualStartDate,'2026-09-24');
  assert.match(unboundArrival.candidates[0].status,/面评本人绑定待核验/u);
  const signedArrival=projectInterviewBindings(arrivedWithoutBinding,chat,[entry],options);
  assert.equal(signedArrival.candidates[0].stage,'interview_fail');
  assert.equal(signedArrival.candidates[0].actualStartDate,'2026-09-24');
});

test('本人绑定接口拒绝管理员代办、失效 OA 身份与跨站提交，并在结果不明后阻止重复写入',async()=>{
  const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
  const html=await readFile(new URL('../exports/recruitment-pool/recruitment-dashboard.html',import.meta.url),'utf8');
  assert.match(source,/RECRUITMENT_INTERVIEW_BINDING_ENABLED === 'true'/u);
  assert.match(source,/const verified=interviewBindingEnabled\s*\?projectInterviewBindings/u);
  assert.match(source,/writeDurableJsonAtomic\(interviewBindingPath,journal\)/u);
  assert.match(source,/interviewBindingLock\.run\(async\(\)=>\{/u);
  assert.match(source,/recruitmentCycleSnapshot\(month,\{fresh,recruitmentChat:chat,\s*calendarSource,previousRecruitmentChat:previousChat,previousChatProvided:true\}\)/u);
  assert.match(source,/if\(interviewBindingEnabled\|\|stored\?\.recruitmentAttributionSchemaVersion!==1\)\s*return json\(res,200,\{ok:true,data:await readFreshRecruitmentSnapshot\(\)\}\)/u);
  const readerCode=source.slice(source.indexOf('let recruitmentSnapshotReadInFlight=null;'),
    source.indexOf('function completeRecruitmentChatSource('));
  let freshCalls=0;
  const reader=vm.runInNewContext(`${readerCode}\nreadFreshRecruitmentSnapshot`,{
    refreshRecruitmentLifecycle:async(_date,opts)=>{freshCalls+=1;assert.equal(opts.fresh,true);
      assert.equal(opts.persist,false);return {status:'verified'}},chinaDateFor:()=> '2026-09-25',
  });
  const [firstRead,secondRead]=await Promise.all([reader(),reader()]);
  assert.equal(freshCalls,1);
  assert.equal(firstRead.status,'verified');
  assert.equal(secondRead.status,'verified');
  assert.match(html,/id="interviewBindingOption" disabled/u);
  assert.match(html,/id="interviewBindingAttest" type="checkbox" disabled/u);
  assert.match(html,/id="interviewBindingSubmit" type="submit" disabled/u);
  const actorCode=source.slice(source.indexOf('async function verifiedInterviewBindingActor('),source.indexOf('async function interviewBindingSources('));
  const submitCode=source.slice(source.indexOf('async function submitInterviewBinding('),source.indexOf('async function lifecycleApi('));
  assert.ok(actorCode.startsWith('async function verifiedInterviewBindingActor(')&&submitCode.startsWith('async function submitInterviewBinding('));
  class FeishuError extends Error {constructor(message,status,details){super(message);this.status=status;this.details=details}}
  const person=vm.runInNewContext(`${actorCode}\nverifiedInterviewBindingActor`,{
    centralFeishuOpenId,verifiedRecruitmentReviewerOpenId:reviewer,
    verifiedLiveCenterPerson:async(openId,name,number)=>{if(openId!==reviewer||name!=='倪梦萍'||number!=='FD-027097')throw new Error('联系人员不匹配')},
    FeishuError,
  });
  const auth={ok:true,mode:'central',user:{number:'FD-027097',open_id:reviewer}};
  assert.equal(await person(auth),reviewer);
  await assert.rejects(person({...auth,mode:'internal'}),error=>error.status===403);
  await assert.rejects(person({...auth,degraded:true}),error=>error.status===403);
  await assert.rejects(person({...auth,user:{number:'FD-027340'}}),error=>error.status===403);
  const {snapshot,chat,payload}=fixture();
  const expected=verifyInterviewBindingSources(snapshot,chat,payload,options).sourceFingerprint;
  let journal={schemaVersion:1,entries:[]},writes=0;
  const submit=vm.runInNewContext(`${submitCode}\nsubmitInterviewBinding`,{
    interviewBindingEnabled:true,verifiedInterviewBindingActor:person,
    FeishuError,recruitmentCycleRange,readRequestJson:async req=>req.payload,
    interviewBindingLock:{run:fn=>fn()},interviewBindingSources:async()=>({snapshot,chat}),
    verifyInterviewBindingSources,feishuChats:{recruitment:{chatId}},
    recruitmentCalendarId:calendarId,chinaDateFor:()=> '2026-09-25',
    readRecruitmentInterviewJournal:async()=>journal,
    writeDurableJsonAtomic:async(_path,next)=>{journal=structuredClone(next);writes+=1},
    interviewBindingPath:'/candidate-only',randomUUID:()=> '65acc534-c889-47e9-a80e-9832bd142039',URL,
  });
  const headers={origin:'https://hub.fandow.com',host:'hub.fandow.com',
    'sec-fetch-site':'same-origin','x-requested-with':'XMLHttpRequest','content-type':'application/json'};
  const request=(overrides={})=>({headers:{...headers,...overrides.headers},
    payload:{...payload,expectedSourceFingerprint:expected,...overrides.payload}});
  await assert.rejects(submit(request({headers:{origin:'https://evil.example'}}),auth),error=>error.status===403);
  await assert.rejects(submit(request({headers:{origin:'http://hub.fandow.com'}}),auth),error=>error.status===403);
  await assert.rejects(submit(request({payload:{expectedSourceFingerprint:'outdated'}}),auth),error=>error.status===409);
  assert.equal(writes,0);
  const result=await submit(request(),auth);
  assert.equal(result.submissionMessageId,'om_submission');
  assert.equal(writes,1);
  assert.equal(journal.entries.length,1);
  await assert.rejects(submit(request(),auth),error=>error.status===409);
  assert.equal(writes,1);
});
