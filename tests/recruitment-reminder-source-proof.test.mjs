import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {
  parseRecruitmentMessages,inspectableRecruitmentReminderChat,
  recruitmentChatSourceFingerprint,interviewReminderSourceFingerprint,
  buildInterviewReminderPreview,recruitmentCycleRange,
} from '../lifecycle-engine.mjs';

const reviewer='ou_0e5926902d4d6051d0ea14f042bb56f4';
const phrase='求职者【周小雨】是否符合【主播】的邀约标准';
const submission={messageId:'om_submission',chatId:'oc_recruitment',type:'text',text:phrase,
  reviewText:phrase,createdAt:'2026-09-26T03:00:00.000Z',sender:{id:'ou_recruiter'},
  parseError:false,contentShapeVerified:true,
  reactions:{details:[{emojiType:'OK',operatorId:reviewer}]}};
const chat=messages=>({key:'recruitment',chatId:'oc_recruitment',messages,
  sourceMessageCount:messages.length,deletedMessageCount:0,truncated:false,
  paginationIssue:'',reactionStatus:'已核验'});

test('17:00 source rejects unreadable messages in either recruitment cycle',()=>{
  assert.equal(inspectableRecruitmentReminderChat(chat([submission])),true);
  for(const change of [
    {type:'image',text:'',reviewText:''},
    {type:'post',text:phrase,reviewText:phrase,textTruncated:true},
    {type:'post',text:phrase,reviewText:phrase,reviewTextTruncated:true},
    {type:'post',text:phrase,reviewText:phrase,hasMediaOrResource:true},
    {type:'post',text:phrase,reviewText:phrase,resources:[{type:'file'}]},
    {type:'post',text:phrase,reviewText:undefined},
    {type:'post',text:phrase,reviewText:phrase,parseError:true,contentShapeVerified:false},
    {type:'post',text:phrase,reviewText:phrase,parseError:false,contentShapeVerified:false},
    {type:'post',text:phrase,reviewText:`${phrase}\n求职者【王\n小花】是否符合【主播】的邀约标准`},
    {type:'post',text:phrase,reviewText:`${phrase}\n求\u200b职者【王小花】是否符合【主播】的邀约标准`},
  ]){
    const second={...submission,...change,messageId:'om_opaque'};
    assert.equal(inspectableRecruitmentReminderChat(chat([submission,second])),false,
      JSON.stringify(change));
  }
});

test('duplicate same-name submissions inside one post stay ambiguous even if display text was deduplicated',()=>{
  const repeated={...submission,type:'post',reviewText:`${phrase}\n${phrase}`};
  const parsed=parseRecruitmentMessages([repeated],{reviewerOpenId:reviewer});
  assert.equal(parsed.submissionMessageCounts['周小雨'],1,'one message ID remains one record');
  assert.equal(parsed.candidates[0].submissionIdentityStatus,'ambiguous');
  assert.equal(parsed.candidates[0].stage,'unmapped');
  assert.equal(parsed.funnel.initialPassedCount,0);
});

test('pre-send fingerprint changes for any new, edited or re-reacted group message',()=>{
  const original=chat([submission]);
  const added=chat([submission,{...submission,messageId:'om_unrelated',text:'无关但新到的群消息',
    reviewText:'无关但新到的群消息'}]);
  const edited=chat([{...submission,reviewText:`${phrase}。`}]);
  const reacted=chat([{...submission,reactions:{details:[{emojiType:'No',operatorId:reviewer}]}}]);
  const first=recruitmentChatSourceFingerprint(original);
  for(const value of [added,edited,reacted])assert.notEqual(recruitmentChatSourceFingerprint(value),first);
  assert.equal(recruitmentChatSourceFingerprint(chat([...added.messages].reverse())),
    recruitmentChatSourceFingerprint(added),'pagination order alone is immaterial');
  const date='2026-09-26';
  const snapshot={cycle:recruitmentCycleRange('2026-10'),calendarStatus:'已连接：正式面试日历已读取详情事件。',
    coverage:{capped:false,reactionStatus:'已核验',chatMessages:1,deletedMessages:0,
      chatSourceFingerprint:first},
    candidates:[{name:'周小雨',inSubmissionCohort:true,
      submissionEvidence:{name:'周小雨',sourceId:'om_submission',date,initialReview:'OK'},
      calendarEvidence:{eventId:'evt_one',date,title:'周小雨面试'}}],
    submissionMessageCounts:{周小雨:1},boundaryCarryover:{status:'not_applicable'},
    interviewEvents:{[date]:[{status:'calendar',source:'正式面试日历',eventId:'evt_one',name:'周小雨面试'}]}};
  assert.equal(buildInterviewReminderPreview(snapshot,date).status,'preview');
  assert.equal(buildInterviewReminderPreview({...snapshot,coverage:{...snapshot.coverage,
    chatSourceFingerprint:''}},date).status,'pending');
  const changed={...snapshot,coverage:{...snapshot.coverage,chatMessages:2,
    chatSourceFingerprint:recruitmentChatSourceFingerprint(added)}};
  assert.notEqual(interviewReminderSourceFingerprint(snapshot,date),
    interviewReminderSourceFingerprint(changed,date));
});

test('reaction proof ignores Feishu row and property order but catches semantic changes',()=>{
  const first={details:[
    {emojiType:'OK',operator:{open_id:reviewer},actionTime:'2026-09-26T03:01:00Z'},
    {emojiType:'No',operatorId:'ou_other',actionTime:'2026-09-26T03:02:00Z'},
  ],counts:[{emojiType:'OK',count:1},{emojiType:'No',count:1}],status:'complete'};
  const reordered={status:'complete',counts:[{count:1,emojiType:'No'},{count:1,emojiType:'OK'}],
    details:[
      {actionTime:'2026-09-26T03:02:00Z',operatorId:'ou_other',emojiType:'No'},
      {actionTime:'2026-09-26T03:01:00Z',operator:{open_id:reviewer},emojiType:'OK'},
    ]};
  const fingerprint=reactions=>recruitmentChatSourceFingerprint(chat([
    {...submission,reactions},
  ]));
  assert.equal(fingerprint(reordered),fingerprint(first));
  for(const changed of [
    {...first,details:[{...first.details[0],emojiType:'No'},first.details[1]]},
    {...first,details:[{...first.details[0],operator:{open_id:'ou_other'}},first.details[1]]},
    {...first,details:[{...first.details[0],actionTime:'2026-09-26T03:03:00Z'},first.details[1]]},
    {...first,details:[...first.details,first.details[0]]},
    {...first,counts:[{...first.counts[0],count:2},first.counts[1]]},
    {...first,status:'partial'},
  ])assert.notEqual(fingerprint(changed),fingerprint(first));
});

test('boundary count object insertion order is immaterial while any count change blocks CAS',()=>{
  const prior={status:'verified',date:'2026-09-25',sourceCycle:'2026-09',matchedCount:2,
    submissionMessageCounts:{周小雨:1,王小花:1},chatSourceFingerprint:'a'.repeat(64),chatMessages:2};
  const reordered={chatMessages:2,chatSourceFingerprint:'a'.repeat(64),matchedCount:2,
    submissionMessageCounts:{王小花:1,周小雨:1},sourceCycle:'2026-09',date:'2026-09-25',status:'verified'};
  const snapshot={coverage:{chatSourceFingerprint:'b'.repeat(64)},boundaryCarryover:prior};
  const fingerprint=boundaryCarryover=>interviewReminderSourceFingerprint(
    {...snapshot,boundaryCarryover},'2026-09-25');
  assert.equal(fingerprint(reordered),fingerprint(prior));
  assert.notEqual(fingerprint({...reordered,submissionMessageCounts:{王小花:2,周小雨:1}}),fingerprint(prior));
  assert.notEqual(fingerprint({...reordered,chatSourceFingerprint:'c'.repeat(64)}),fingerprint(prior));
});

test('timed recruitment source rejects malformed, non-string or wrong-shape Feishu bodies',async()=>{
  const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
  const start=server.indexOf('function parseMessageContent(');
  const end=server.indexOf('async function findChatByName(',start);
  assert.ok(start>=0&&end>start);
  let rawItems=[];
  const read=vm.runInNewContext(`${server.slice(start,end)}\ngetChatMessages`,{
    feishuChats:{recruitment:{chatId:'oc_recruitment',name:'招聘群'}},
    feishuGet:async()=>({items:rawItems,has_more:false}),
    getMessageReactions:async ids=>new Map(ids.map(id=>[id,
      {counts:[{reactionType:'OK',count:1}],details:[{emojiType:'OK',operatorId:reviewer}]}])),
    activeChatMessages:items=>items,cached:async(_key,_ttl,load)=>load(),
    feishuCache:new Map(),createHash,URLSearchParams,Date,
  });
  const raw=(id,type,content)=>({message_id:id,chat_id:'oc_recruitment',msg_type:type,
    body:{content},sender:{id:'ou_recruiter'},create_time:'1790391600000'});
  const valid=raw('om_submission','text',JSON.stringify({text:phrase}));
  rawItems=[valid];
  const sound=await read('recruitment',10,{fresh:true,includeReviewText:true});
  assert.equal(sound.messages[0].parseError,false);
  assert.equal(sound.messages[0].contentShapeVerified,true);
  assert.equal(inspectableRecruitmentReminderChat(sound),true);
  const other='求职者【王小花】是否符合【主播】的邀约标准';
  for(const [type,content,expectedParseError] of [
    ['text',other,true],
    ['post',`{"zh_cn":{"title":"${other}","content":`,true],
    ['post',{zh_cn:{title:'送审',content:[[{tag:'text',text:other}]]}},true],
    ['text',JSON.stringify({text:null}),false],
    ['post',JSON.stringify({text:other}),false],
    ['post',JSON.stringify({zh_cn:{title:'送审',content:other}}),false],
    ['post',JSON.stringify({zh_cn:{title:'送审',content:[[
      {tag:'text',text:phrase},{tag:'plain_text',content:other},
    ]]}}),false],
    ['post',JSON.stringify({zh_cn:{title:'送审',content:[[
      {tag:'text',text:phrase,href:`https://example.com/${encodeURIComponent(other)}`},
    ]]}}),false],
  ]){
    rawItems=[valid,raw('om_hidden',type,content)];
    const source=await read('recruitment',10,{fresh:true,includeReviewText:true});
    const hidden=source.messages.find(item=>item.messageId==='om_hidden');
    assert.equal(hidden.parseError,expectedParseError);
    assert.equal(hidden.contentShapeVerified,false);
    assert.equal(inspectableRecruitmentReminderChat(source),false,
      `unreadable second applicant must block reminder: ${type}`);
  }
  rawItems=[valid,raw('om_post','post',JSON.stringify({zh_cn:{title:'送审',content:[
    [{tag:'text',text:other}],
  ]}}))];
  const readable=await read('recruitment',10,{fresh:true,includeReviewText:true});
  assert.equal(readable.messages[1].contentShapeVerified,true);
  assert.equal(inspectableRecruitmentReminderChat(readable),true);
  rawItems=[valid,raw('om_hyphen','post',JSON.stringify({'zh-CN':{title:'送审',content:[
    [{tag:'text',text:other}],
  ]}}))];
  const hyphenLocale=await read('recruitment',10,{fresh:true,includeReviewText:true});
  assert.equal(hyphenLocale.messages[1].contentShapeVerified,true);
  assert.equal(inspectableRecruitmentReminderChat(hyphenLocale),true);
  rawItems=[raw('om_split','post',JSON.stringify({zh_cn:{content:[[
    {tag:'text',text:phrase},
    {tag:'text',text:'求职者【周'},
    {tag:'text',text:'小雨】是否符合【主播】的邀约标准'},
  ]]}}))];
  const split=await read('recruitment',10,{fresh:true,includeReviewText:true});
  assert.equal(split.messages[0].reviewText,`${phrase}${phrase}`,
    'nodes within one Feishu post row must be joined without a separator');
  assert.equal(inspectableRecruitmentReminderChat(split),true);
  const repeated=parseRecruitmentMessages(split.messages,{reviewerOpenId:reviewer});
  assert.equal(repeated.candidates[0].submissionIdentityStatus,'ambiguous');
  assert.equal(repeated.candidates[0].stage,'unmapped');
  rawItems=[raw('om_split_line','post',JSON.stringify({zh_cn:{content:[
    [{tag:'text',text:phrase}],
    [{tag:'text',text:'求职者【王'}],
    [{tag:'text',text:'小花】是否符合【主播】的邀约标准'}],
  ]}}))];
  const crossLine=await read('recruitment',10,{fresh:true,includeReviewText:true});
  assert.equal(crossLine.messages[0].contentShapeVerified,true);
  assert.equal(inspectableRecruitmentReminderChat(crossLine),false,
    'an applicant marker broken over visual lines cannot be silently ignored');
});

test('timed snapshot takes a fresh undeduplicated read and downgrades opaque chat evidence',async()=>{
  const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
  const start=server.indexOf('async function recruitmentCycleSnapshot(');
  const end=server.indexOf('\nconst rankingCellText =',start);
  assert.ok(start>=0&&end>start);
  let source=chat([submission]),sourceOptions=[],linkOptions=[],trustOptions=[];
  const context={recruitmentCycleRange,interviewBindingEnabled:false,
    getChatMessages:async(key,_limit,options)=>{
      if(key==='recruitment'){sourceOptions.push(options);return source;}
      return {messages:[],sourceMessageCount:0,truncated:false};
    },
    readRecruitmentCalendar:async()=>({events:{},status:'已连接：正式面试日历已读取 0 条详情事件。'}),
    parseRecruitmentMessages:()=>({candidates:[],funnel:{},interviewEvents:{},
      submissionMessageCounts:{},dailyCounts:{},dailyNames:{}}),
    parseEmploymentMessages:()=>({candidates:[],sourceDate:''}),
    supplementalEmploymentCandidates:()=>[],
    addStructuredAssessments:async candidates=>({candidates,summary:null,status:'待核验'}),
    linkRecruitmentCalendarWithBoundary:async(candidates,_parsed,_chat,_calendar,_cycle,options)=>{
      linkOptions.push(options);return {candidates,matchedCount:0,pendingCount:0,
        boundary:{status:'not_applicable'}};
    },
    recruitmentReviewerOpenId:reviewer,recruitmentCalendarId:'calendar_official',
    recruitmentChatSourceFingerprint,completeRecruitmentChatSource:()=>true,
    inspectableRecruitmentReminderChat,
    sanitizeRecruitmentOutcome:(snapshot,trust)=>{trustOptions.push(trust);return snapshot;},
    structuredClone,Date};
  const snapshot=vm.runInNewContext(`${server.slice(start,end)}\nrecruitmentCycleSnapshot`,context);
  const first=await snapshot('2026-10',{reminderDate:'2026-09-26'});
  assert.equal(sourceOptions[0].fresh,true);
  assert.equal(sourceOptions[0].includeReviewText,true);
  assert.equal(linkOptions[0].requireReminderProof,true);
  assert.equal(trustOptions[0].trustedFreshChat,true);
  assert.equal(first.coverage.chatSourceFingerprint,recruitmentChatSourceFingerprint(source));
  source=chat([submission,{...submission,messageId:'om_hidden',type:'image',text:'',reviewText:''}]);
  await snapshot('2026-10',{reminderDate:'2026-09-26'});
  assert.equal(trustOptions[1].trustedFreshChat,false);
});
