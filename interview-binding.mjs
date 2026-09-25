import {createHash} from 'node:crypto';

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

/** A signed binding may inspect only the explicit heading and final conclusion.
 * Free-form bullets are intentionally never interpreted as a decision.
 */
export function inspectInterviewPost(message, candidateName, knownNames = []) {
  const text = String(message?.text || '').replace(/\r/gu,'');
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
  reviewerOpenId, recruitmentChatId, calendarId, today, now=new Date().toISOString()
}={}) {
  const cycleMonth=String(payload?.cycleMonth||''),name=String(payload?.candidateName||'');
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
  if(chat?.key!=='recruitment'||chat?.chatId!==recruitmentChatId||chat?.truncated||chat?.paginationIssue
    ||chat?.reactionStatus!=='已核验'||!Array.isArray(chat?.messages)
    ||chat?.sourceMessageCount!==chat.messages.length+(chat.deletedMessageCount||0))
    return pending('招聘群当前周期消息不完整');
  if(chat.messages.some(item=>item?.chatId!==recruitmentChatId||!messageId(item?.messageId)
    ||!Number.isFinite(new Date(item?.createdAt||'').getTime())
    ||new Date(item.createdAt).getTime()/1000<cycle.startTime
    ||new Date(item.createdAt).getTime()/1000>=cycle.endTime+1))
    return pending('招聘群消息的来源、日期或编号无法核验');
  const matches=(snapshot.candidates||[]).filter(item=>item?.inSubmissionCohort&&item.name===name);
  if(matches.length!==1||snapshot.submissionMessageCounts?.[name]!==1
    ||matches[0].submissionIdentityStatus==='ambiguous'||matches[0].boundaryCarryover)
    return pending('该姓名在当前周期不能对应唯一送审候选人');
  const candidate=matches[0],submission=candidate.submissionEvidence;
  const rawSubmissions=chat.messages.filter(item=>item.messageId===submissionId);
  if(submission?.sourceId!==submissionId||submission?.name!==name||submission?.initialReview!=='OK'
    ||!dateOnly(submission?.date)||rawSubmissions.length!==1||sourceDate(rawSubmissions[0].createdAt)!==submission.date)
    return pending('送审消息、初审通过记录或候选人身份无法一一对应');
  if((snapshot.candidates||[]).filter(item=>item?.inSubmissionCohort&&item.submissionEvidence?.sourceId===submissionId).length!==1)
    return pending('同一送审消息对应多个候选人');
  const calendarEvents=Object.entries(snapshot.interviewEvents||{}).flatMap(([date,items])=>
    (Array.isArray(items)?items:[]).filter(item=>item?.status==='calendar'&&item.eventId===calendarEventId)
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
    postSender:posts[0].sender?.id,outcome});
  return {status:'ready',cycleMonth,candidateName:name,submissionMessageId:submissionId,
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
      statuses.push({submissionMessageId:candidate.submissionEvidence?.sourceId,status:'pending',reason});
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
