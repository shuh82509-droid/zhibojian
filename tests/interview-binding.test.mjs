import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {inspectInterviewPost,verifyInterviewBindingSources,projectInterviewBindings} from '../interview-binding.mjs';
import {centralFeishuOpenId,recruitmentCycleRange} from '../lifecycle-engine.mjs';

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

test('本人富文本帖允许自由描述，但仅末尾明确结论与唯一标题可用于本人签署',()=>{
  const {chat}=fixture();
  assert.deepEqual(inspectInterviewPost(chat.messages[1],'周小雨',['周小雨']).status,'ready');
  assert.equal(inspectInterviewPost(chat.messages[1],'周小雨',['周小雨']).outcome,'fail');
  assert.equal(inspectInterviewPost({...chat.messages[1],text:'面试结果\n**周小雨**\n颜值4 表现力4\n- 说过没有通过。'},'周小雨',['周小雨']).status,'pending');
  assert.equal(inspectInterviewPost({...chat.messages[1],text:'面试结果\n**周小雨**\n颜值4 表现力4\n- 林小满也须复核\n- **不通过**'},'周小雨',['周小雨','林小满']).status,'pending');
  assert.equal(inspectInterviewPost({...chat.messages[1],text:'面试结果\n**周小雨**\n颜值4 表现力4\n**林小满**\n颜值3 表现力3\n- **不通过**'},'周小雨',['周小雨','林小满']).status,'pending');
  assert.equal(inspectInterviewPost({...chat.messages[1],text:'面试结果\n**周小雨**\n颜值4 表现力4\n**未知新人**\n颜值3 表现力3\n- **不通过**'},'周小雨',['周小雨']).status,'pending');
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
  assert.match(source,/recruitmentCycleSnapshot\(month,\{fresh,recruitmentChat:chat\}\)/u);
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
