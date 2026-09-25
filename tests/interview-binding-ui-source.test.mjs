import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const reviewer='ou_verified_reviewer';
const chatId='oc_recruitment';
const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
const html=await readFile(new URL('../exports/recruitment-pool/recruitment-dashboard.html',import.meta.url),'utf8');
const submissionText='候选人：周小雨\n'+('送审说明与确认信息。'.repeat(30));
const postText='面试结果：周小雨\n'+('具体面试评价与待改善事项。'.repeat(30))+'\n结论：不通过';
function fixture(){
  const submission={messageId:'om_submission',chatId,type:'text',text:submissionText,
    sender:{id:'ou_recruiter'},resources:[],appLink:''};
  const post={messageId:'om_post',chatId,type:'post',text:postText,
    sender:{id:reviewer},resources:[],appLink:''};
  const snapshot={cycle:{month:'2026-09'},interviewBindings:[],candidates:[{
    name:'周小雨',inSubmissionCohort:true,
    submissionEvidence:{sourceId:submission.messageId,date:'2026-09-23'},
    calendarEvidence:{eventId:'evt_one',date:'2026-09-24',title:'周小雨正式面试'},
  }]};
  return {snapshot,chat:{messages:[submission,post]},submission,post};
}
function optionsFor(snapshot,chat){
  const code=source.slice(source.indexOf('function interviewBindingOptions('),source.indexOf('async function submitInterviewBinding('));
  assert.ok(code.startsWith('function interviewBindingOptions('));
  return vm.runInNewContext(`${code}\ninterviewBindingOptions`,{
    verifiedRecruitmentReviewerOpenId:reviewer,
    inspectInterviewPost:()=>({status:'ready',outcome:'fail'}),
    verifyInterviewBindingSources:()=>({status:'ready',sourceCycleMonth:'2026-09',submissionMessageId:'om_submission',
      calendarEventId:'evt_one',calendarDate:'2026-09-24',postMessageId:'om_post',
      postDate:'2026-09-24',outcome:'fail',sourceFingerprint:'fingerprint'}),
    recruitmentReviewerOpenId:reviewer,recruitmentCalendarId:'cal_one',
    feishuChats:{recruitment:{chatId}},chinaDateFor:()=> '2026-09-25',
  })(snapshot,chat);
}
function submitFor(snapshot,chat){
  const code=source.slice(source.indexOf('async function submitInterviewBinding('),source.indexOf('async function lifecycleApi('));
  assert.ok(code.startsWith('async function submitInterviewBinding('));
  let writes=0;
  class FeishuError extends Error {constructor(message,status,code){super(message);this.status=status;this.code=code}}
  const submit=vm.runInNewContext(`${code}\nsubmitInterviewBinding`,{
    interviewBindingEnabled:true,verifiedInterviewBindingActor:async()=>reviewer,
    FeishuError,recruitmentCycleRange:()=>({month:'2026-09'}),
    readRequestJson:async req=>req.payload,
    interviewBindingLock:{run:fn=>fn()},interviewBindingSources:async()=>({snapshot,chat}),
    verifyInterviewBindingSources:()=>({status:'ready',cycleMonth:'2026-09',sourceCycleMonth:'2026-09',candidateName:'周小雨',
      submissionMessageId:'om_submission',calendarId:'cal_one',calendarEventId:'evt_one',
      postMessageId:'om_post',postDate:'2026-09-24',outcome:'fail',sourceFingerprint:'fingerprint'}),
    feishuChats:{recruitment:{chatId}},recruitmentCalendarId:'cal_one',chinaDateFor:()=> '2026-09-25',
    readRecruitmentInterviewJournal:async()=>({entries:[]}),
    writeDurableJsonAtomic:async()=>{writes+=1},
    interviewBindingPath:'/candidate-only',randomUUID:()=> 'record-one',URL,
  });
  const req={headers:{origin:'https://hub.fandow.com',host:'hub.fandow.com',
    'sec-fetch-site':'same-origin','x-requested-with':'XMLHttpRequest','content-type':'application/json'},
    payload:{cycleMonth:'2026-09',candidateName:'周小雨',submissionMessageId:'om_submission',
      calendarEventId:'evt_one',postMessageId:'om_post',outcome:'fail',expectedSourceFingerprint:'fingerprint'}};
  return {submit,req,writes:()=>writes};
}

test('无原帖直达链接的纯文本来源向本人完整展示，而非 180 字摘要',()=>{
  const {snapshot,chat}=fixture();
  const options=optionsFor(snapshot,chat);
  assert.equal(options.length,1);
  assert.equal(options[0].submissionText,submissionText);
  assert.equal(options[0].postText,postText);
  assert.ok(options[0].postText.length>180);
  assert.match(html,/id="interviewBindingSubmissionText"/u);
  assert.match(html,/id="interviewBindingPostText"/u);
  assert.match(html,/#interviewBindingSubmissionText'\)\.textContent/u);
  assert.match(html,/#interviewBindingPostText'\)\.textContent/u);
  assert.match(html,/\.assessment-source-text\{[^}]*white-space:pre-wrap/u);
});

test('面评帖媒体即使有原帖链接也不能证明机器读到了完整结果',()=>{
  const {snapshot,chat,submission,post}=fixture();
  submission.resources=[{type:'image',key:'img_one'}];
  assert.equal(optionsFor(snapshot,chat).length,0);
  submission.resources=[];
  post.resources=[{type:'file',key:'file_one'}];
  assert.equal(optionsFor(snapshot,chat).length,0);
  post.appLink='https://applink.feishu.cn/client/chat/open?openChatId=oc_recruitment&position=1';
  assert.equal(optionsFor(snapshot,chat).length,0);
  post.resources=[];
  post.hasMediaOrResource=true;
  assert.equal(optionsFor(snapshot,chat).length,0);
  post.hasMediaOrResource=false;
  assert.equal(optionsFor(snapshot,chat).length,1);
  post.textTruncated=true;
  assert.equal(optionsFor(snapshot,chat).length,0);
  post.textTruncated=false;
  post.reviewTextTruncated=true;
  assert.equal(optionsFor(snapshot,chat).length,0);
});

test('飞书富文本中的媒体标签与资源键均标记；非本人 GET 在取源前清空选项',()=>{
  const code=source.slice(source.indexOf('  function messageHasMediaOrResource('),source.indexOf('  const source = feishuChats[sourceKey];'));
  const hasMedia=vm.runInNewContext(`${code}\nmessageHasMediaOrResource`);
  assert.equal(hasMedia({zh_cn:{content:[[{tag:'text',text:'可见正文'}]]}}),false);
  assert.equal(hasMedia({zh_cn:{content:[[{tag:'img',image_key:'img_one'}]]}}),true);
  assert.equal(hasMedia({zh_cn:{content:[[{tag:'media',media_key:'media_one'}]]}}),true);
  assert.equal(hasMedia({content:{file_key:'file_one'}}),true);
  assert.equal(hasMedia({content:[[{tag:'at',user_id:'ou_mention'}]]}),true);
  assert.equal(hasMedia({content:[[{tag:'a',text:'查看',href:'https://example.com'}]]}),true);
  assert.match(source,/textTruncated: extractedText\.length > 8000/u);
  assert.match(source,/reviewTextTruncated:reviewText\.length > 8000/u);
  const anonymousGate=source.indexOf('if(!identityVerified)return json(res,200,{ok:true,enabled:interviewBindingEnabled,identityVerified:false,');
  const sourceRead=source.indexOf('const {chat,previousChat,snapshot}=await interviewBindingSources(month);',anonymousGate);
  assert.ok(anonymousGate>=0&&sourceRead>anonymousGate);
});

test('审阅文本保留重复段落与原始换行，不静默去重或截断后允许签署',()=>{
  const code=source.slice(source.indexOf('function messageText('),source.indexOf('function messageResources('));
  const extract=vm.runInNewContext(`${code}\nmessageText`);
  const rich={zh_cn:{title:'标题',content:[[{tag:'text',text:'同一句\n'}],[{tag:'text',text:'同一句\n'}]]}};
  assert.equal(extract(rich,8001,false),'标题\n同一句\n\n同一句\n');
  const {snapshot,chat,submission}=fixture();
  submission.reviewText='完整第一段\n完整第二段';
  assert.equal(optionsFor(snapshot,chat)[0].submissionText,submission.reviewText);
  submission.reviewText='超长'.repeat(4001);
  assert.equal(optionsFor(snapshot,chat).length,0);
});

test('完整审阅文本仅在本人绑定的专用实时源读取中返回，且不进入通用缓存',async()=>{
  const textCode=source.slice(source.indexOf('function messageText('),source.indexOf('function messageResources('));
  const extract=vm.runInNewContext(`${textCode}\nmessageText`);
  const chatCode=source.slice(source.indexOf('async function getChatMessages('),source.indexOf('async function findChatByName('));
  const cache=new Map();
  const raw={message_id:'om_one',chat_id:chatId,msg_type:'post',
    body:{content:JSON.stringify({zh_cn:{title:'面评',content:[[{tag:'text',text:'第一段'}],[{tag:'text',text:'第一段'}]]}})},
    sender:{id:reviewer},create_time:'1790000000000'};
  const read=vm.runInNewContext(`${chatCode}\ngetChatMessages`,{
    feishuChats:{recruitment:{chatId,name:'招聘群'}},FeishuError:Error,
    feishuGet:async()=>({items:[raw],has_more:false}),
    getMessageReactions:async()=>new Map(),activeChatMessages:items=>items,
    parseMessageContent:content=>JSON.parse(content),messageText:extract,messageResources:()=>[],
    cached:async(_key,_ttl,loader)=>loader(),feishuCache:cache,createHash,URLSearchParams,Date,
  });
  const normal=await read('recruitment',1,{fresh:true});
  const review=await read('recruitment',1,{fresh:true,includeReviewText:true});
  assert.equal(Object.hasOwn(normal.messages[0],'reviewText'),false);
  assert.equal(review.messages[0].reviewText,'面评\n第一段\n第一段');
  assert.equal(cache.size,1);
  await assert.rejects(read('recruitment',1,{includeReviewText:true}),/必须实时读取/u);
  assert.match(source,/getChatMessages\('recruitment',1000,\{\.\.\.cycle,fresh,includeReviewText:true\}\)/u);
});

test('绕过页面直接 POST 的面评媒体即使有链接也禁办；纯文本仍可提交',async()=>{
  const {snapshot,chat,post}=fixture();
  post.resources=[{type:'image',key:'img_one'}];
  const denied=submitFor(snapshot,chat);
  await assert.rejects(denied.submit(denied.req,{}),error=>error.status===409);
  assert.equal(denied.writes(),0);
  post.appLink='https://applink.feishu.cn/client/chat/open?openChatId=oc_recruitment&position=1';
  const linked=submitFor(snapshot,chat);
  await assert.rejects(linked.submit(linked.req,{}),error=>error.status===409);
  assert.equal(linked.writes(),0);
  post.resources=[];
  const allowed=submitFor(snapshot,chat);
  assert.equal((await allowed.submit(allowed.req,{})).postMessageId,'om_post');
  assert.equal(allowed.writes(),1);
});
