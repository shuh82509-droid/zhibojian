import {createHash} from 'node:crypto';
import {parseRecruitmentMessages, recruitmentBoundaryCycleRange, linkVerifiedRecruitmentCalendar} from './lifecycle-engine.mjs';

const messageId = value => /^om_[A-Za-z0-9_]+$/u.test(String(value || ''));
const eventId = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\s\u0000-\u001f]/u.test(value);
const dateOnly = value => /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(String(value || ''));
const pending = reason => ({status:'pending',reason});
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const sourceDate = value => {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
};
const completeRecruitmentChat = (chat, recruitmentChatId, cycle) =>
  chat?.key==='recruitment' && chat?.chatId===recruitmentChatId && !chat?.truncated
  && !chat?.paginationIssue && chat?.reactionStatus==='已核验' && Array.isArray(chat?.messages)
  && Number.isSafeInteger(chat?.sourceMessageCount) && Number.isSafeInteger(chat?.deletedMessageCount)
  && chat.sourceMessageCount===chat.messages.length+chat.deletedMessageCount
  && Number.isSafeInteger(cycle?.startTime) && Number.isSafeInteger(cycle?.endTime)
  && chat.messages.every(item=>item?.chatId===recruitmentChatId && messageId(item?.messageId)
    && Number.isFinite(Date.parse(item?.createdAt||''))
    && Date.parse(item.createdAt)/1000>=cycle.startTime
    && Date.parse(item.createdAt)/1000<cycle.endTime+1);

export const formalRecruitmentCalendarEvents = events => Object.fromEntries(
  Object.entries(events && typeof events==='object' ? events : {}).map(([date,items])=>[date,
    (Array.isArray(items)?items:[]).filter(item=>item && !Array.isArray(item)
      && item.status==='calendar' && item.source==='正式面试日历' && eventId(item.eventId))]));

/** A group post, offer or stale snapshot is never an official interview result.
 * This projection is also applied when the self-binding feature is disabled.
 * Fresh, verified self-bindings may be retained only after same-request source
 * verification; callers must never set either trust flag for disk snapshots.
 */
export function sanitizeRecruitmentOutcome(snapshot,{
  trustedFreshCalendar=false,trustedFreshChat=false,trustedFreshBinding=false,
  trustedFreshAssessment=false
}={}) {
  if(!snapshot || typeof snapshot!=='object')return snapshot;
  const result=structuredClone(snapshot);
  const originalEvents=result.interviewEvents && typeof result.interviewEvents==='object'
    ?result.interviewEvents:{};
  const formalEvents=trustedFreshCalendar && String(result.calendarStatus||'').startsWith('已连接：')
    ?formalRecruitmentCalendarEvents(originalEvents):{};
  if(!trustedFreshCalendar && String(result.calendarStatus||'').startsWith('已连接：'))
    result.calendarStatus='待核验：本次未重读正式面试日历；历史日程仅作线索。';
  const candidates=Array.isArray(result.candidates)?result.candidates:[];
  const sourceReady=trustedFreshCalendar && trustedFreshChat
    && String(result.calendarStatus||'').startsWith('已连接：')
    && result.coverage?.capped===false && result.coverage?.reactionStatus==='已核验';
  const rechecked=linkVerifiedRecruitmentCalendar(candidates.map(candidate=>
    candidate?.inSubmissionCohort && candidate.submissionEvidence?.initialReview==='OK'
      ?{...candidate,stage:'initial_pass',calendarEvidence:null}:candidate),
    formalEvents,result.submissionMessageCounts,{sourceReady,advanceStage:false}).candidates;
  const clueText=text=>/面试(?:不)?通过|面评(?:不)?通过|已入职|入职\/到岗|考核通过|接受\s*offer/iu.test(String(text||''));
  let signedCount=0,signedPassed=0,unverifiedCount=0;
  result.candidates=candidates.map((candidate,index)=>{
    if(!candidate || typeof candidate!=='object')return candidate;
    const submission=candidate.submissionEvidence;
    const cohort=candidate.inSubmissionCohort===true && messageId(submission?.sourceId)
      && submission?.name===candidate.name && dateOnly(submission?.date)
      && result.submissionMessageCounts?.[candidate.name]===1
      && candidates.filter(item=>item?.inSubmissionCohort&&item?.name===candidate.name).length===1
      && candidates.filter(item=>item?.inSubmissionCohort
        && item?.submissionEvidence?.sourceId===submission.sourceId).length===1;
    const calendar=candidate.calendarEvidence;
    const checked=rechecked[index]?.calendarEvidence;
    const matchedCurrent=cohort && checked && calendar?.source==='正式面试日历'
      && checked.eventId===calendar.eventId && checked.date===calendar.date && checked.title===calendar.title;
    const matchedCarry=candidate.boundaryCarryover===true && result.boundaryCarryover?.status==='verified'
      && result.boundaryCarryover?.submissionMessageCounts?.[candidate.name]===1
      && messageId(submission?.sourceId) && calendar?.source==='正式面试日历'
      && Object.entries(formalEvents).flatMap(([date,items])=>items.map(item=>({date,item})))
        .filter(({date,item})=>date===calendar.date && item.eventId===calendar.eventId
          && item.name===calendar.title).length===1;
    const signedCalendar=Boolean(sourceReady && (matchedCurrent || matchedCarry));
    const signed=Boolean(trustedFreshBinding && signedCalendar
      && candidate.interviewBinding?.status==='verified'
      && ['pass','fail'].includes(candidate.interviewBinding.outcome)
      && candidate.interviewBinding.recordId);
    // The first day may carry a signed submission from the prior cycle.
    // Preserve its verified stage, but keep the current-cycle funnel scoped
    // exactly like projectInterviewBindings: current cohort only.
    if(signed && candidate.inSubmissionCohort===true && candidate.submissionIdentityStatus!=='ambiguous'){
      signedCount+=1;if(candidate.interviewBinding.outcome==='pass')signedPassed+=1;
    }
    const timeline=Array.isArray(candidate.timeline)?candidate.timeline:[];
    const hasClue=['interview_pass','interview_fail','hired','interviewed','progress','pending_feedback'].includes(candidate.stage)
      || Boolean(calendar) || Boolean(candidate.evaluationEvidence) || Boolean(candidate.startDate)
      || Boolean(candidate.actualStartDate) || typeof candidate.assessmentPassed==='boolean'
      || Boolean(candidate.assessmentEvidenceStatus) || Boolean(candidate.assessmentEvidence?.length)
      || candidate.interviewBinding?.status==='verified'
      || clueText(candidate.status) || clueText(candidate.note)
      || timeline.some(row=>clueText(row?.[1]));
    if(!hasClue && !signed)return candidate;
    if(!signed)unverifiedCount+=1;
    const stage=signed ? candidate.interviewBinding.outcome==='pass'?'interview_pass':'interview_fail'
      : !cohort && !matchedCarry?'unmapped'
      : submission?.initialReview==='No'?'initial_fail'
      : submission?.initialReview==='OK' ? signedCalendar?'pending_feedback':'initial_pass':'unmapped';
    const status=signed ? candidate.interviewBinding.outcome==='pass'?'面试通过 · 本人绑定':'面试不通过 · 本人绑定'
      : stage==='initial_fail'?'初审不通过 · 后续记录待核验'
      : stage==='initial_pass'?'初审通过 · 面评结论待核验'
      : stage==='pending_feedback'?'正式面试已安排 · 面评结论待核验'
      : '送审或面评归属待核验';
    const rawTimeline=timeline.filter(row=>clueText(row?.[1])
      && !String(row?.[1]||'').startsWith('倪梦萍本人绑定面评'));
    const safeTimeline=timeline.map(row=>{
      if(!clueText(row?.[1]) || signed && String(row?.[1]||'').startsWith('倪梦萍本人绑定面评'))return row;
      return [row[0],'招聘群面评、Offer 或日报线索待核验；不作为正式面试或到岗结论。'];
    });
    return {...candidate,stage,status,
      note:signed?'本人面评绑定已核验；Offer 与实际到岗仍待独立核验。'
        :'招聘群面评、Offer 或日报仅作线索；正式结论待本人绑定。',
      date:signedCalendar?calendar.date:cohort&&submission?.date?submission.date:candidate.date,
      startDate:null,actualStartDate:null,actualStartDateBasis:null,
      calendarEvidence:signedCalendar?calendar:null,
      evaluationEvidence:signed?candidate.evaluationEvidence:null,
      assessmentPassed:trustedFreshAssessment?candidate.assessmentPassed:null,
      assessmentEvidence:trustedFreshAssessment?candidate.assessmentEvidence:null,
      assessmentEvidenceStatus:trustedFreshAssessment?candidate.assessmentEvidenceStatus
        :'待核验：双人确认记录本次未重读',
      timeline:safeTimeline,
      interviewBinding:signed?candidate.interviewBinding:{status:'pending',reason:'本人面评来源未在本次读取中完整核验'},
      unverifiedOutcome:candidate.unverifiedOutcome
        ?{...candidate.unverifiedOutcome,reportedAssessmentEvidenceStatus:
          Object.hasOwn(candidate.unverifiedOutcome,'reportedAssessmentEvidenceStatus')
            ?candidate.unverifiedOutcome.reportedAssessmentEvidenceStatus:candidate.assessmentEvidenceStatus??null}
        :{reportedStage:candidate.stage,reportedStatus:candidate.status,
        reportedNote:candidate.note,reportedStartDate:candidate.startDate||null,
        reportedActualStartDate:candidate.actualStartDate||null,
        reportedAssessmentPassed:candidate.assessmentPassed??null,
        reportedAssessmentEvidence:candidate.assessmentEvidence||null,
        reportedAssessmentEvidenceStatus:candidate.assessmentEvidenceStatus??null,
        groupEvaluationEvidence:candidate.evaluationEvidence||null,
        reportedCalendarEvidence:!signedCalendar?calendar||null:null,rawTimeline},
    };
  });
  result.interviewEvents=Object.fromEntries(Object.entries(originalEvents).map(([date,items])=>[date,
    (Array.isArray(items)?items:[]).map(item=>{
      if(formalEvents[date]?.includes(item))return item;
      if(Array.isArray(item))return {name:item[0],status:'pending_feedback',source:'历史面评线索待核验',reportedStatus:item[1]};
      if(!item || typeof item!=='object')return item;
      return {...item,status:'pending_feedback',source:item.status==='calendar'&&item.source==='正式面试日历'
        ?'历史日历待复核':'招聘群面评线索',
        reportedStatus:item.reportedStatus??item.status};
    })]));
  if(Array.isArray(result.interviewBindings))result.interviewBindings=result.interviewBindings.map(item=>{
    if(item?.status!=='verified')return item;
    const candidate=result.candidates.find(row=>row?.submissionEvidence?.sourceId===item.submissionMessageId
      &&row?.interviewBinding?.status==='verified');
    return candidate?item:{...item,status:'pending',reason:'已签面评来源未在本次读取中完整核验'};
  });
  result.funnel={...(result.funnel||{}),groupEvaluatedCount:trustedFreshBinding&&sourceReady?signedCount:null,
    groupPassedCount:trustedFreshBinding&&sourceReady?signedPassed:null,hiredCount:null,
    interviewScheduledCount:sourceReady?result.funnel?.interviewScheduledCount:null,
    interviewScheduledPendingCount:sourceReady?result.funnel?.interviewScheduledPendingCount:null,
    assessmentPassedCount:trustedFreshAssessment?result.funnel?.assessmentPassedCount:null,
    assessmentFailedCount:trustedFreshAssessment?result.funnel?.assessmentFailedCount:null,
    assessmentConflictCount:trustedFreshAssessment?result.funnel?.assessmentConflictCount:null};
  result.coverage={...(result.coverage||{}),interviewOutcomeStatus:unverifiedCount
    ?'群面评、Offer 或旧快照仅作线索；正式结论待本人绑定':'仅本人已签面评可形成正式结论'};
  if(!trustedFreshAssessment)result.assessmentStatus='待核验：考核结论须重新读取双人确认记录';
  result.assessmentOutcomeVerification=trustedFreshAssessment
    ?'current_structured_dual_review_v1':'pending_revalidation';
  if(!trustedFreshBinding || unverifiedCount)result.status='partial';
  result.interviewOutcomeVerification='self_binding_required_v1';
  return result;
}

/** A signed binding may inspect only the explicit heading and final conclusion.
 * Free-form bullets are intentionally never interpreted as a decision.
 */
export function inspectInterviewPost(message, candidateName, knownNames = []) {
  const text = String(message?.reviewText ?? message?.text ?? '').replace(/\r/gu,'');
  if (message?.type !== 'post' || !text || text.length > 8000
    || message?.textTruncated || message?.reviewTextTruncated
    || message?.hasMediaOrResource || message?.resources?.length)
    return pending('本人面评必须是完整、可核验的招聘群富文本帖');
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const names = [...new Set([candidateName,...knownNames].filter(name => typeof name === 'string' && name))]
    .sort((a,b) => b.length-a.length || a.localeCompare(b,'zh-CN'));
  // A name embedded in a longer candidate name is not a second person.
  const mentions = new Set(),occupied=[];
  for (const name of names) {
    let start=0,index;
    while ((index=text.indexOf(name,start))>=0) {
      start=index+name.length;
      if(occupied.some(([from,to])=>index<to&&index+name.length>from))continue;
      occupied.push([index,index+name.length]);mentions.add(name);
    }
  }
  if (mentions.size !== 1 || !mentions.has(candidateName)) return pending('面评帖包含其他候选人或缺少本人的唯一姓名');
  const headings=lines.map((line,index)=>({index,name:line.replace(/^\*{1,2}|\*{1,2}$/gu,'').trim()}))
    .filter(item=>/^[\p{Script=Han}·]{2,12}$/u.test(item.name)
      && !/^(面试结果|面试评价|候选人)$/u.test(item.name)
      && /(?:颜值|表现力)\s*[：:]?\s*\d/u.test(lines[item.index+1]||''));
  if(headings.length!==1||headings[0].name!==candidateName)return pending('面评帖没有唯一的候选人标题');
  const scoreText=lines.slice(headings[0].index+1).join('\n');
  if(!/颜值\s*[：:]?\s*\d/u.test(scoreText)||!/表现力\s*[：:]?\s*\d/u.test(scoreText))
    return pending('面评帖缺少可核对的颜值与表现力评分');
  const last=lines.at(-1)||'';
  const named=new RegExp(`^(?:\\*{1,2})?${escapeRegExp(candidateName)}(?:\\*{1,2})?\\s*[：:—-]\\s*(?:\\*{1,2})?(未通过|不通过|通过)(?:\\*{1,2})?$`,'u');
  const result=last.match(/^(?:[-—]\s*)?(?:\*{1,2})?(未通过|不通过|通过)(?:\*{1,2})?(?:\s*@倪梦萍)?$/u)||last.match(named);
  if(!result)return pending('面评帖末尾没有唯一、明确的通过或不通过结论');
  // The current cycle's roster is not a complete list of people who can be
  // mentioned in a post. A second person's named conclusion must not slip
  // through merely because that person was submitted in an older cycle.
  const beforeResult=lines.slice(0,-1);
  const unformat=line=>line.replace(/[*_]/gu,''); // Structural checks only; source fingerprints retain the original text.
  if(beforeResult.some(line=>/通过/u.test(unformat(line))))return pending('面评帖在末尾结论前还有结果陈述，归属须人工核验');
  const scored=/^(?:(?:颜值|表现力)\s*[：:]?\s*\d+(?:\.\d+)?(?:\s+|[，,、；;]\s*)?)+$/u;
  // An open-ended bullet can name a person outside this cycle's roster. Only
  // explicitly person-free observations are machine-attributable; all other
  // prose remains visible for the reviewer but cannot produce a signed result.
  const safeDescription=/^(?:自然流话术较琐碎，须补充用户疑问处理[。.]?|镜头状态(?:稳定|自然|良好|较好|一般|待提升)(?:[，,、；;]\s*互动(?:自然|良好|较好|一般|待提升))?[。；;]?|表现力[：:]\s*(?:答复|回答|表达|口播|互动|讲解)(?:清晰|自然|流畅|良好|较好|一般|待提升)[。；;]?)$/u;
  for(let index=0;index<beforeResult.length;index+=1){
    const line=beforeResult[index];
    if(index===headings[0].index||/^\[Media:\s*[A-Za-z0-9_-]+\]$/u.test(line))continue;
    if(index<headings[0].index&&/^(?:面试结果|面试评价)$/u.test(line))continue;
    if(index>headings[0].index&&scored.test(line))continue;
    // Preserve a narrow set of person-free bullets for the reviewer to read.
    // The full post remains available through its original Feishu link.
    if(index>headings[0].index&&/^[-—]\s+\S/u.test(line)){
      const description=unformat(line).replace(/^[-—]\s+/u,'').trim();
      if(safeDescription.test(description))continue;
    }
    return pending('面评帖含无法唯一归属的标题、评分或段落，须人工核验');
  }
  return {status:'ready',outcome:result[1]==='通过'?'pass':'fail'};
}

/** Recheck the complete authorized sources before an individual's signed write
 * and on every later read. IDs, not names or card payloads, are authoritative.
 */
export function verifyInterviewBindingSources(snapshot, chat, payload, {
  reviewerOpenId, recruitmentChatId, calendarId, today, now=new Date().toISOString(), previousChat=null
}={}) {
  const cycleMonth=String(payload?.cycleMonth||''),name=String(payload?.candidateName||'');
  const requestedSourceCycleMonth=String(payload?.sourceCycleMonth||cycleMonth);
  const submissionId=String(payload?.submissionMessageId||''),calendarEventId=String(payload?.calendarEventId||'');
  const postId=String(payload?.postMessageId||''),outcome=String(payload?.outcome||'');
  if(!/^20\d{2}-(?:0[1-9]|1[0-2])$/u.test(cycleMonth)||!name||!messageId(submissionId)
    ||!eventId(calendarEventId)||!messageId(postId)||!['pass','fail'].includes(outcome)||!dateOnly(today)
    ||!calendarId||(payload.calendarId&&payload.calendarId!==calendarId))
    return pending('面评绑定字段无效');
  if(snapshot?.cycle?.month!==cycleMonth || !snapshot?.calendarStatus?.startsWith('已连接：')
    || snapshot?.coverage?.capped || snapshot?.coverage?.reactionStatus!=='已核验')
    return pending('招聘周期、表情或正式日历来源尚未完整核验');
  const cycle=snapshot.cycle;
  if(!completeRecruitmentChat(chat,recruitmentChatId,cycle))
    return pending('招聘群当前周期消息不完整');
  const matches=(snapshot.candidates||[]).filter(item=>
    (item?.inSubmissionCohort||item?.boundaryCarryover)&&item.name===name);
  if(matches.length!==1)
    return pending('该姓名在当前周期或跨周期首日不能对应唯一送审候选人');
  const candidate=matches[0],carry=candidate.boundaryCarryover===true;
  const expectedSourceCycleMonth=carry?candidate.boundarySourceCycle:cycleMonth;
  if(requestedSourceCycleMonth!==expectedSourceCycleMonth)
    return pending('送审来源周期与日历面试周期不一致');
  let submissionChat=chat,submissionCounts=snapshot.submissionMessageCounts;
  if(carry){
    const previousCycle=recruitmentBoundaryCycleRange(cycleMonth).previous;
    if(snapshot.boundaryCarryover?.status!=='verified'
      || expectedSourceCycleMonth!==previousCycle.month
      || snapshot.boundaryCarryover?.date!==cycle.startDate
      || snapshot.boundaryCarryover?.sourceCycle!==previousCycle.month
      || candidate.boundaryCarryoverDate!==cycle.startDate
      || candidate.calendarEvidence?.date!==cycle.startDate
      || !completeRecruitmentChat(previousChat,recruitmentChatId,previousCycle))
      return pending('跨周期首日的上周期招聘群、正式日历或本人身份来源不完整');
    const prior=parseRecruitmentMessages(previousChat.messages.map(item=>
      ({...item,text:item.reviewText??item.text})),{reviewerOpenId});
    const priorMatches=(prior.candidates||[]).filter(item=>item?.inSubmissionCohort&&item.name===name);
    if(priorMatches.length!==1||prior.submissionMessageCounts?.[name]!==1
      ||priorMatches[0].submissionIdentityStatus==='ambiguous'
      ||priorMatches[0].submissionEvidence?.sourceId!==submissionId
      ||priorMatches[0].submissionEvidence?.initialReview!=='OK'
      ||priorMatches[0].evaluationEvidence||priorMatches[0].calendarEvidence
      ||priorMatches[0].interviewBinding||priorMatches[0].startDate||priorMatches[0].actualStartDate)
      return pending('上周期同名、重复送审或已有面评/入职证据，不能跨周期绑定');
    submissionChat=previousChat;
    submissionCounts=snapshot.boundaryCarryover.submissionMessageCounts;
  }
  if(submissionCounts?.[name]!==1
    ||candidate.submissionIdentityStatus==='ambiguous')
    return pending('该姓名在当前周期不能对应唯一送审候选人');
  const submission=candidate.submissionEvidence;
  const rawSubmissions=submissionChat.messages.filter(item=>item.messageId===submissionId);
  if(submission?.sourceId!==submissionId||submission?.name!==name||submission?.initialReview!=='OK'
    ||!dateOnly(submission?.date)||rawSubmissions.length!==1||sourceDate(rawSubmissions[0].createdAt)!==submission.date)
    return pending('送审消息、初审通过记录或候选人身份无法一一对应');
  if((snapshot.candidates||[]).filter(item=>(item?.inSubmissionCohort||item?.boundaryCarryover)
    &&item.submissionEvidence?.sourceId===submissionId).length!==1)
    return pending('同一送审消息对应多个候选人');
  if(carry){
    const selected=rawSubmissions[0];
    if(!['text','post'].includes(selected?.type)||selected?.textTruncated
      ||selected?.reviewTextTruncated||selected?.hasMediaOrResource
      ||selected?.resources?.length||!String(selected?.text||'').trim()
      ||!String(selected?.reviewText??selected?.text??'').trim())
      return pending('上周期送审原文含截断或不可核验内容，跨周期绑定待人工核验');
    // Any unreadable group message could conceal a second submission, even
    // when it was sent by a recruiter other than the reviewer.
    const opaque=item=>!['text','post'].includes(item?.type)
      ||item?.textTruncated||item?.reviewTextTruncated||item?.hasMediaOrResource
      ||item?.resources?.length||!String(item?.reviewText??item?.text??'').trim();
    const otherPriorMentions=submissionChat.messages.filter(item=>item?.messageId!==submissionId
      &&!['system','notice','reaction'].includes(item?.type)
      &&(opaque(item)||String(item?.text||'').includes(name)
        ||String(item?.reviewText||'').includes(name)));
    if(otherPriorMentions.length)return pending('上周期还有同名或不完整消息，跨周期归属须人工核验');
  }
  const calendarEvents=Object.entries(snapshot.interviewEvents||{}).flatMap(([date,items])=>
    (Array.isArray(items)?items:[]).filter(item=>item?.status==='calendar'
      &&item.source==='正式面试日历'&&item.eventId===calendarEventId)
      .map(item=>({date,...item})));
  if(calendarEvents.length!==1||candidate.calendarEvidence?.eventId!==calendarEventId
    ||candidate.calendarEvidence?.date!==calendarEvents[0].date
    ||candidate.calendarEvidence?.title!==calendarEvents[0].name
    ||!/^[a-f0-9]{64}$/u.test(String(calendarEvents[0].summaryFingerprint||''))
    ||!dateOnly(calendarEvents[0].date)||calendarEvents[0].date<submission.date||calendarEvents[0].date>today)
    return pending('正式面试日历事件未与唯一送审消息核验，或面试尚未发生');
  const startAt=Date.parse(calendarEvents[0].startAt||''),endAt=Date.parse(calendarEvents[0].endAt||''),current=Date.parse(now);
  if(!Number.isFinite(startAt)||!Number.isFinite(endAt)||!Number.isFinite(current)
    ||endAt<=startAt||endAt>current)
    return pending('正式日历缺少可核验的面试结束时间，或面试尚未结束');
  const posts=chat.messages.filter(item=>item.messageId===postId);
  if(posts.length!==1||posts[0].sender?.id!==reviewerOpenId||posts[0].chatId!==recruitmentChatId
    ||Date.parse(posts[0].createdAt)<endAt||sourceDate(posts[0].createdAt)>today)
    return pending('面评帖并非倪梦萍本人在面试后发布于指定招聘群');
  const post=inspectInterviewPost(posts[0],name,(snapshot.candidates||[]).map(item=>item.name));
  if(post.status!=='ready')return post;
  if(carry&&chat.messages.some(item=>item?.messageId!==postId
    && !['system','notice','reaction'].includes(item?.type)
    &&(String(item?.text||'').includes(name)||String(item?.reviewText||'').includes(name)
      ||!['text','post'].includes(item?.type)||item?.textTruncated||item?.reviewTextTruncated
      ||item?.hasMediaOrResource||item?.resources?.length
      ||!String(item?.reviewText??item?.text??'').trim())))
    return pending('跨周期首日还有另一条同名或不完整群消息，须人工核验');
  const systemMessageTypes=new Set(['system','notice','reaction']);
  const relatedOpinions=chat.messages.filter(item=>item?.messageId!==postId
    && item.sender?.id===reviewerOpenId && !systemMessageTypes.has(item?.type)
    && Date.parse(item.createdAt)>=endAt && sourceDate(item.createdAt)<=today
    // A later same-name statement can reverse the result without using one
    // of our known outcome words. A truncated or opaque message may conceal
    // the name itself. Image, audio, file, card and future authored message
    // types cannot be checked from the flattened text. System events and
    // reactions are not reviewer-authored message bodies.
    && (!['post','text'].includes(item.type)
      || item.textTruncated || item.reviewTextTruncated || item.hasMediaOrResource
      || item.resources?.length
      || !String(item.text||'').trim() || String(item.text||'').includes(name)
      || String(item.reviewText||'').includes(name)));
  if(relatedOpinions.length)
    return pending('面试后存在另一条本人结果、同名消息或不完整内容，结论须人工核验');
  if(post.outcome!==outcome)return pending('本人选择的结论与面评帖末尾明确结论冲突');
  if(candidate.evaluationEvidence?.sourceId&&candidate.evaluationEvidence.sourceId!==postId)
    return pending('当前周期已有另一条面评帖，须先核验相互关系');
  if(typeof candidate.evaluationEvidence?.passed==='boolean'
    && candidate.evaluationEvidence.passed!==(outcome==='pass'))
    return pending('现有群面评结论与本人选择的结论冲突');
  if(payload.postDate&&payload.postDate!==sourceDate(posts[0].createdAt))return pending('面评帖发表日期与签署记录不一致');
  // Preserve the exact original same-cycle digest for already signed records.
  // A carry binding adds the preceding cycle and its independent reaction
  // evidence, so it cannot be replayed as an ordinary current-cycle record.
  const sourceFingerprint=hash({cycleMonth,calendarId,recruitmentChatId,submissionId,name,
    submissionDate:submission.date,initialReview:submission.initialReview,
    submissionText:rawSubmissions[0].text,submissionUpdatedAt:rawSubmissions[0].updatedAt||'',
    submissionContentFingerprint:rawSubmissions[0].contentFingerprint||'',
    submissionSender:rawSubmissions[0].sender?.id,submissionResources:rawSubmissions[0].resources||[],
    calendarEventId,calendarDate:calendarEvents[0].date,calendarTitle:calendarEvents[0].name,
    calendarSummaryFingerprint:calendarEvents[0].summaryFingerprint,
    calendarStartAt:calendarEvents[0].startAt,calendarEndAt:calendarEvents[0].endAt,
    postId,postText:posts[0].text,postUpdatedAt:posts[0].updatedAt||'',postCreatedAt:posts[0].createdAt,
    postContentFingerprint:posts[0].contentFingerprint||'',
    postResources:posts[0].resources||[],
    postSender:posts[0].sender?.id,outcome,
    ...(carry?{sourceCycleMonth:expectedSourceCycleMonth,
      submissionCycleStart:recruitmentBoundaryCycleRange(cycleMonth).previous.startTime,
      submissionCycleEnd:recruitmentBoundaryCycleRange(cycleMonth).previous.endTime,
      submissionReactions:rawSubmissions[0].reactions||null}:{})});
  return {status:'ready',cycleMonth,sourceCycleMonth:expectedSourceCycleMonth,candidateName:name,submissionMessageId:submissionId,
    calendarId,calendarEventId,postMessageId:postId,outcome,sourceFingerprint,
    calendarDate:calendarEvents[0].date,postDate:sourceDate(posts[0].createdAt)};
}

export function projectInterviewBindings(snapshot,chat,entries,options={}) {
  const active=(entries||[]).filter(item=>item?.cycleMonth===snapshot?.cycle?.month);
  const bySubmission=new Map();
  for(const entry of active){
    const key=entry.submissionMessageId;
    const group=bySubmission.get(key)||[];group.push(entry);bySubmission.set(key,group);
  }
  const statuses=[],seenRecords=new Set();
  const candidates=(snapshot.candidates||[]).map(candidate=>{
    const records=bySubmission.get(candidate.submissionEvidence?.sourceId)||[];
    if(!records.length){
      if(candidate.boundaryCarryover){
        const reason='跨周期首日面评尚未由本人绑定上周期送审、正式日历和本周期面评帖';
        statuses.push({submissionMessageId:candidate.submissionEvidence?.sourceId,status:'pending',reason});
        return {...candidate,interviewBinding:{status:'pending',reason}};
      }
      if(!candidate.inSubmissionCohort||!['interview_pass','interview_fail','hired'].includes(candidate.stage))return candidate;
      const reason='群帖自动识别仅作线索；面试阶段须倪梦萍本人绑定送审、日历和面评帖';
      statuses.push({submissionMessageId:candidate.submissionEvidence?.sourceId,status:'pending',reason});
      return {...candidate,stage:'pending_feedback',status:candidate.actualStartDate
        ?'到岗记录存在 · 面评本人绑定待核验':'面评本人绑定待核验',
        interviewBinding:{status:'pending',reason}};
    }
    records.forEach(item=>seenRecords.add(item.id));
    const all=records.map(entry=>({entry,check:verifyInterviewBindingSources(snapshot,chat,entry,options)}));
    const valid=all.filter(item=>item.check.status==='ready'&&item.check.sourceFingerprint===item.entry.sourceFingerprint);
    const conflicting=records.length!==1||valid.length!==1||valid[0]?.entry.candidateName!==candidate.name
      ||(candidate.evaluationEvidence?.passed!==null&&candidate.evaluationEvidence?.passed!==undefined
        &&candidate.evaluationEvidence.passed!==(valid[0]?.entry.outcome==='pass'));
    if(conflicting){
      const reason=records.length!==1?'同一送审消息有重复面评绑定'
        :valid.length!==1?'已签面评所依赖的群帖、日历或送审来源已变化'
        :'群帖自动结论与本人绑定结论冲突';
      statuses.push({submissionMessageId:candidate.submissionEvidence?.sourceId,status:'pending',
        recordId:records[0]?.id,reason});
      return {...candidate,interviewBinding:{status:'pending',reason},
        ...(['interview_pass','interview_fail','hired'].includes(candidate.stage)
          ?{stage:'pending_feedback',status:'面评来源冲突待核验'}:{})};
    }
    const verified=valid[0].entry,passed=verified.outcome==='pass';
    const note=`倪梦萍本人绑定面评${passed?'通过':'未通过'}（群帖 ${verified.postMessageId}，日历 ${verified.calendarEventId}）`;
    const timeline=[...(candidate.timeline||[])];
    if(!timeline.some(item=>item[0]===verified.postDate&&item[1]===note))timeline.push([verified.postDate,note]);
    statuses.push({submissionMessageId:verified.submissionMessageId,status:'verified',outcome:verified.outcome,
      recordId:verified.id,at:verified.createdAt});
    return {...candidate,timeline,interviewBinding:{status:'verified',outcome:verified.outcome,recordId:verified.id,
      at:verified.createdAt,source:'倪梦萍本人结构化绑定',postMessageId:verified.postMessageId},
      evaluationEvidence:{passed,date:verified.postDate,sourceId:verified.postMessageId,source:'本人结构化绑定'},
      ...(['initial_pass','pending_feedback','interview_pass','interview_fail','hired'].includes(candidate.stage)
        ?{stage:passed?'interview_pass':'interview_fail',status:passed?'面试通过 · 本人绑定':'面试不通过 · 本人绑定'}:{})};
  });
  for(const entry of active)if(!seenRecords.has(entry.id))statuses.push({submissionMessageId:entry.submissionMessageId,
    status:'pending',recordId:entry.id,reason:'原送审消息现已无法对应当前周期的唯一候选人'});
  const cohort=candidates.filter(item=>item.inSubmissionCohort&&item.submissionIdentityStatus!=='ambiguous');
  const evaluated=cohort.filter(item=>item.interviewBinding?.status==='verified');
  const passed=evaluated.filter(item=>item.interviewBinding.outcome==='pass');
  return {...snapshot,candidates,interviewBindings:statuses,
    funnel:{...snapshot.funnel,groupEvaluatedCount:evaluated.length,groupPassedCount:passed.length}};
}
