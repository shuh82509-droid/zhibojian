import {createHash} from 'node:crypto';

const ROOM_NAMES = Object.freeze(['官旗', '品牌精选', '优选', '王鸥美肤']);
const RECRUITMENT_REVIEWER_OPEN_ID = 'ou_0e5926902d4d6051d0ea14f042bb56f4';

export function chinaDateFor(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value);
  const pick = type => parts.find(item => item.type === type)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function safeName(value) {
  const name = String(value || '').replace(/[：:，,。！？!\s]+$/gu, '').trim();
  if (!/^[\p{Script=Han}·]{2,12}$/u.test(name)) return '';
  if (/^(候选人|求职者|初审通过|初审不通过|主播|是否符合|招聘端|面试通过|面试结果|面试评价)$/u.test(name)) return '';
  return name;
}

function messageDate(message) {
  const value = new Date(message?.createdAt || '');
  return Number.isNaN(value.getTime()) ? '' : chinaDateFor(value);
}

function findSubmissionNames(text) {
  const names = [];
  const pattern = /求职者\s*[【\[]?\s*([^\s，,。！？：:【】\[\]]{2,20}?)\s*[】\]]?\s*是否符合\s*[【\[]?\s*主播\s*[】\]]?\s*(?:的)?邀约标准/gu;
  for (const match of String(text || '').matchAll(pattern)) {
    const name = safeName(match[1]);
    if (name) names.push(name);
  }
  return names;
}

function reviewerReaction(message, reviewerOpenId) {
  if (!reviewerOpenId) return null;
  const details = Array.isArray(message?.reactions?.details) ? message.reactions.details : [];
  const decisions = details.map(item => ({
    emoji:String(item?.emojiType || item?.emoji_type || ''),
    operatorId:String(item?.operatorId || item?.operator?.operator_id || item?.operator?.open_id || item?.operator?.id || '')
  })).filter(item => item.operatorId === reviewerOpenId && ['OK','No'].includes(item.emoji));
  if (!decisions.length) return null;
  // Feishu does not promise reaction order. Conflicting marks from the same
  // reviewer cannot be resolved by whichever item happened to arrive first.
  return new Set(decisions.map(item => item.emoji)).size === 1 ? decisions[0] : {emoji:null,conflict:true};
}

function interviewEvaluation(text, knownNames = []) {
  const lines = String(text || '').replace(/\r/gu, '').split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.some(line => /颜值|表现力/u.test(line))) return null;
  // Only the reviewer's one-person structured report is machine-actionable.
  // Arbitrary prose can contain a second person's name or a negation such as
  // "没有通过"; substring searches must never advance the first heading.
  const headings = lines.map((line, index) => ({index, name:safeName(line.replace(/^\*{1,2}|\*{1,2}$/gu, '').trim())}))
    .filter(item => item.name && lines[item.index + 1] && /^(?:颜值|表现力)\s*\d/u.test(lines[item.index + 1]));
  if (headings.length !== 1) return null;
  const {name, index:headingIndex} = headings[0];
  // Known names are checked longest first so 李明 is not inferred from 李明欣.
  // A second known candidate anywhere in the report makes attribution unsafe.
  const occupied = [], mentioned = new Set();
  for (const candidate of [...new Set(knownNames)].filter(item => safeName(item) === item)
    .sort((a,b) => b.length-a.length || a.localeCompare(b,'zh-CN'))) {
    let from = 0, at;
    while ((at = String(text).indexOf(candidate,from)) >= 0) {
      const end = at + candidate.length;
      from = end;
      if (occupied.some(([start,finish]) => at < finish && end > start)) continue;
      occupied.push([at,end]);
      mentioned.add(candidate);
    }
  }
  if ([...mentioned].some(candidate => candidate !== name)) return null;
  const scored = /^(?:(?:颜值|表现力)\s*\d+(?:\.\d+)?(?:\s+|[，,、；;]\s*)?)+$/u;
  const result = /^(?:[-—]\s*)?(?:\*{1,2})?(未通过|不通过|通过)(?:\*{1,2})?$/u;
  const namedResult = new RegExp(`^(?:\\*{1,2})?${name}(?:\\*{1,2})?\\s*[：:—-]\\s*(?:\\*{1,2})?(未通过|不通过|通过)(?:\\*{1,2})?$`, 'u');
  // The sender is the configured reviewer. An arbitrary @name after the
  // outcome could refer to another candidate, so only the known reviewer tag
  // is an acceptable suffix in the observed one-person report format.
  const mentionedResult = /^[-—]\s*\*{2}(未通过|不通过|通过)\*{2}\s*@倪梦萍$/u;
  // Free-form prose is not a reliable source of person attribution. Admit only
  // narrow, person-free descriptive phrases seen in the structured reports;
  // unfamiliar commentary stays pending instead of advancing a candidate.
  const safeComment = /^[-—]\s+(?:镜头状态(?:稳定|自然|良好|较好|一般|待提升)(?:[，,、；;]\s*互动(?:自然|良好|较好|一般|待提升))?[。；;]?|表现力[：:]\s*(?:答复|回答|表达|口播|互动|讲解)(?:清晰|自然|流畅|良好|较好|一般|待提升)[。；;]?)$/u;
  let passed = null, resultCount = 0, scoreCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index === headingIndex || (index < headingIndex && (/^(?:面试结果|面试评价)$/u.test(line)
      || /^\[Media:\s*[A-Za-z0-9_-]+\]$/u.test(line)))) continue;
    if (scored.test(line)) {scoreCount += 1; continue;}
    const outcome = line.match(result) || line.match(namedResult) || line.match(mentionedResult);
    if (outcome) {
      if (index !== lines.length - 1) return null;
      resultCount += 1;
      passed = outcome[1] === '通过';
      continue;
    }
    if (index > headingIndex && scoreCount && resultCount === 0 && safeComment.test(line)) continue;
    return null;
  }
  if (!scoreCount || resultCount > 1) return null;
  // An outcome is optional: a scored report without an explicit conclusion is
  // still represented as pending feedback, never as a pass.
  return {name, passed};
}

function offerEvent(text, messageDateValue) {
  const match = String(text || '').match(/新人主播[-：:\s]*([\p{Script=Han}·]{2,12})接受\s*offer\s*(\d{1,2})[.\/-](\d{1,2})待入职/iu);
  const name = safeName(match?.[1]);
  if (!name) return null;
  const year = Number(String(messageDateValue || '').slice(0, 4)) || new Date().getUTCFullYear();
  const startDate = `${year}-${String(Number(match[2])).padStart(2,'0')}-${String(Number(match[3])).padStart(2,'0')}`;
  return {name,startDate};
}

function findResultNames(text, negative) {
  const normalized = String(text || '').replace(/\r/g, '');
  const outcome = negative ? '不通过' : '(?<!不)通过';
  const patterns = [
    new RegExp(`(?:^|\\n)\\s*([\\p{Script=Han}·]{2,12})\\s*(?:[：:]|[-—]|\\s)*(?:初审|筛选)?\\s*${outcome}(?=\\s|[，,。！？!；;]|$)`, 'gu'),
    new RegExp(`(?:候选人|求职者|主播)\\s*([\\p{Script=Han}·]{2,12})[^\\n。]{0,24}?${outcome}(?=\\s|[，,。！？!；;]|$)`, 'gu')
  ];
  const names = [];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const name = safeName(match[1]);
      if (name) names.push(name);
    }
  }
  return names;
}

function updateCandidate(target, event) {
  const existing = target.get(event.name);
  if (!existing || event.date >= existing.date || existing.stage === 'unmapped') {
    const timeline = [...(existing?.timeline || [])];
    if (!timeline.some(item => item[0] === event.date && item[1] === event.note)) timeline.push([event.date, event.note]);
    target.set(event.name, {
      ...(existing || {}),
      ...(event || {}),
      name: event.name,
      stage: event.stage,
      source: '招聘群',
      date: event.date,
      status: event.status,
      note: event.note,
      timeline,
      sourceId: event.sourceId || existing?.sourceId || ''
    });
  }
}

function findStageNames(text, label) {
  const normalized = String(text || '').replace(/\r/g, '');
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`(?:^|\\n)\\s*([\\p{Script=Han}·]{2,12})[^\\n。]{0,32}?${escaped}(?=\\s|[，,。！？!；;]|$)`, 'gu'),
    new RegExp(`${escaped}[^\\n。]{0,18}?(?:候选人|求职者|主播)?\\s*([\\p{Script=Han}·]{2,12})(?=\\s|[，,。！？!；;]|$)`, 'gu')
  ];
  const names = [];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const name = safeName(match[1]);
      if (name) names.push(name);
    }
  }
  return names;
}

function outcomeNames(text, outcome) {
  const source = String(text || '').replace(/\r/gu, '');
  const patterns = outcome === 'hired' ? [
    /(?:^|[\n，,、；;：:\s-])(?:新人主播|新人|主播)?\s*[-：:]?\s*([\p{Script=Han}·]{2,5}?)\s*(?:已|正式|实际)?\s*(?:入职|到岗)(?=\s|[，,。！？!；;]|$)/gu,
    /(?:已入职|实际到岗|到岗确认)[：:\s-]*([\p{Script=Han}·]{2,5})(?=\s|[，,。！？!；;]|$)/gu,
  ] : [
    /(?:^|[\n，,、；;：:\s-])(?:新人主播|新人|主播)?\s*[-：:]?\s*([\p{Script=Han}·]{2,5})[^\n。；;]{0,16}?考核通过(?=\s|[，,。！？!；;]|$)/gu,
    /考核通过[：:\s-]*([\p{Script=Han}·]{2,5})(?=\s|[，,。！？!；;]|$)/gu,
  ];
  const names = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const name = safeName(match[1]);
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}

export function parseEmploymentMessages(messages = [], {reviewerOpenId = RECRUITMENT_REVIEWER_OPEN_ID} = {}) {
  const candidates = new Map();
  const sourceDates = [];
  const ordered = [...messages].sort((a, b) => String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')));
  for (const message of ordered) {
    const senderId = String(message?.sender?.id || '');
    // A display name can be duplicated or edited. Only the configured open ID
    // may contribute an independent daily-report fact.
    if (!reviewerOpenId || senderId !== reviewerOpenId) continue;
    const date = messageDate(message);
    if (!date) continue;
    const text = String(message?.text || '');
    const hiredNames = outcomeNames(text, 'hired');
    const assessmentNames = outcomeNames(text, 'assessment');
    if (!hiredNames.length && !assessmentNames.length) continue;
    sourceDates.push(date);
    for (const name of [...new Set([...hiredNames, ...assessmentNames])]) {
      const existing = candidates.get(name) || {name,timeline:[]};
      const hired = hiredNames.includes(name) || Boolean(existing.actualStartDate);
      const assessmentPassed = assessmentNames.includes(name) || Boolean(existing.assessmentPassed);
      const timeline = [...existing.timeline];
      if (hiredNames.includes(name) && !timeline.some(item => item[0] === date && item[1] === '直播战队日报确认已入职/到岗')) timeline.push([date, '直播战队日报确认已入职/到岗']);
      if (assessmentNames.includes(name) && !timeline.some(item => item[0] === date && item[1] === '直播战队日报确认考核通过')) timeline.push([date, '直播战队日报确认考核通过']);
      candidates.set(name, {
        ...existing,
        name,
        stage:hired?'hired':'unmapped',
        status:hired ? assessmentPassed?'日报称已入职 · 考核通过待双人确认':'日报称已入职 · 归属待核验'
          :'日报称考核通过 · 实际到岗待核验',
        note:hired ? 'WIS直播战队日报有到岗/入职陈述，但缺少本周期精确送审消息 ID，暂不计入招聘漏斗。'
          :'WIS直播战队日报仅有考核通过陈述，未见实际到岗；暂不计入已入职。',
        source:'WIS直播战队',
        date,
        actualStartDate:hired ? (existing.actualStartDate || date) : null,
        actualStartDateBasis:hired ? '日报确认日' : null,
        assessmentPassed,
        timeline,
        sourceId:message?.messageId || existing.sourceId || '',
      });
    }
  }
  return {candidates:[...candidates.values()],sourceDate:sourceDates.sort().at(-1) || ''};
}

export function parseRecruitmentMessages(messages = [], {reviewerOpenId = RECRUITMENT_REVIEWER_OPEN_ID} = {}) {
  const candidates = new Map();
  const submitted = new Set();
  const dailyCounts = {};
  const dailyNames = {};
  const interviewEvents = {};
  const submissionEvidence = new Map();
  const evaluationEvidence = new Map();
  const unresolvedEvaluationEvidence = new Map();
  const sourceDates = [];
  const ordered = [...messages].sort((a, b) => String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')));
  // Evaluate against the complete cycle, not only submissions seen earlier in
  // message order: a second candidate or a duplicate same-name submission may
  // arrive after a report. Neither may be attributed by name alone.
  const submittedNames = new Set(ordered.flatMap(message => findSubmissionNames(message?.text)));
  const submissionRecords = new Map(), unidentifiedSubmissions = new Map();
  const messageNames = new Map(), ambiguousNames = new Set();
  for (const message of ordered) {
    const names = [...new Set(findSubmissionNames(message?.text))];
    if (!names.length) continue;
    const sourceId = String(message?.messageId || '').trim();
    const date = messageDate(message);
    const initialReview = reviewerReaction(message, reviewerOpenId)?.emoji || null;
    for (const name of names) {
      if (!submissionRecords.has(name)) submissionRecords.set(name,new Map());
      if (!sourceId || !date) {
        ambiguousNames.add(name);
        const unidentified = unidentifiedSubmissions.get(name) || [];
        unidentified.push({name,date,sourceId,initialReview});
        unidentifiedSubmissions.set(name,unidentified);
        continue;
      }
      if (!messageNames.has(sourceId)) messageNames.set(sourceId,new Set());
      messageNames.get(sourceId).add(name);
      const records = submissionRecords.get(name);
      const previous = records.get(sourceId);
      if (previous && (previous.date !== date || previous.initialReview !== initialReview
        || previous.text !== String(message?.text || ''))) ambiguousNames.add(name);
      else if (!previous) records.set(sourceId,{name,date,sourceId,initialReview,text:String(message?.text || '')});
    }
  }
  for (const [name,records] of submissionRecords) {
    if (records.size !== 1 || [...records.keys()].some(id => messageNames.get(id)?.size !== 1))
      ambiguousNames.add(name);
  }
  for (const message of ordered) {
    const date = messageDate(message);
    if (!date) continue;
    sourceDates.push(date);
    const text = String(message?.text || '');
    for (const name of findSubmissionNames(text)) {
      const key = `${date}|${name}`;
      if (!submitted.has(key)) {
        submitted.add(key);
        dailyCounts[date] = (dailyCounts[date] || 0) + 1;
        dailyNames[date] = [...new Set([...(dailyNames[date] || []), name])];
      }
      const reaction = reviewerReaction(message, reviewerOpenId);
      if (ambiguousNames.has(name)) continue;
      submissionEvidence.set(name, {name, date, sourceId:message?.messageId || '', initialReview:reaction?.emoji || null});
      if (reaction?.emoji === 'OK') updateCandidate(candidates, {name, date, stage:'initial_pass', status:'初审通过', note:'倪梦萍在送审消息上标记 OK。', sourceId:message?.messageId});
      else if (reaction?.emoji === 'No') updateCandidate(candidates, {name, date, stage:'initial_fail', status:'初审不通过', note:'倪梦萍在送审消息上标记 No。', sourceId:message?.messageId});
      else updateCandidate(candidates, {name, date, stage:'unmapped', status:'初审结果待核验', note:reaction?.conflict ? '倪梦萍对同一送审消息同时标记 OK 与 No，需本人核验。' : '已找到送审记录，但未读到倪梦萍的 OK / No 表情证据。', sourceId:message?.messageId});
    }
    const senderId = String(message?.sender?.id || '');
    const senderName = String(message?.sender?.name || '');
    const isReviewer = Boolean(reviewerOpenId) && senderId === reviewerOpenId;
    const evaluation = isReviewer ? interviewEvaluation(text, new Set([...submittedNames, ...candidates.keys()])) : null;
    if (evaluation && ambiguousNames.has(evaluation.name)) {
      const pending = unresolvedEvaluationEvidence.get(evaluation.name) || [];
      pending.push({date,sourceId:message?.messageId || '',passed:evaluation.passed});
      unresolvedEvaluationEvidence.set(evaluation.name,pending);
    } else if (evaluation) {
      evaluationEvidence.set(evaluation.name, {passed:evaluation.passed, date, sourceId:message?.messageId || ''});
      const stage = evaluation.passed === true ? 'interview_pass' : evaluation.passed === false ? 'interview_fail' : 'pending_feedback';
      const status = evaluation.passed === true ? '面试通过' : evaluation.passed === false ? '面试不通过' : '待面评';
      updateCandidate(candidates, {name:evaluation.name,date,stage,status,note:`招聘群已发布${status}结论。`,sourceId:message?.messageId});
      interviewEvents[date] = [...(interviewEvents[date] || []), {name:evaluation.name,status:stage,source:'面评群消息'}];
    }
    const offer = offerEvent(text, date);
    if (offer && !ambiguousNames.has(offer.name)) {
      const hired = false; // A scheduled start date does not prove actual onboarding.
      updateCandidate(candidates, {name:offer.name,date,stage:hired?'hired':'interview_pass',status:hired?'已入职':'面试通过 · 待入职',note:`招聘群已确认接受 offer，预计入职日期 ${offer.startDate}，实际到岗待核验。`,startDate:offer.startDate,sourceId:message?.messageId});
    }
  }
  for (const name of ambiguousNames) {
    const records = [...(submissionRecords.get(name)?.values() || [])].map(({text,...record}) => record)
      .concat(unidentifiedSubmissions.get(name) || []);
    submissionEvidence.set(name,{name,date:'',sourceId:'',initialReview:null,
      ambiguityReason:'同一招聘周期的送审姓名与消息无法唯一对应'});
    const existing = candidates.get(name);
    candidates.set(name,{
      ...(existing || {}),name,source:'招聘群',stage:'unmapped',status:'同名送审待核验',
      submissionIdentityStatus:'ambiguous',
      note:'同一招聘周期的送审姓名与消息无法唯一对应，不能自动确认初审或面评结果。',
      date:existing?.date || records.at(-1)?.date || '',sourceId:'',
      submissionEvidenceAlternatives:records,
      unresolvedEvaluationEvidence:unresolvedEvaluationEvidence.get(name) || [],
      timeline:existing?.timeline || []
    });
  }
  const cohortNames = [...submissionEvidence.keys()];
  const cohort = new Set(cohortNames);
  const allCandidates = [...candidates.values()].map(candidate => ({...candidate,
    inSubmissionCohort:cohort.has(candidate.name),
    submissionEvidence:submissionEvidence.get(candidate.name) || null,
    evaluationEvidence:evaluationEvidence.get(candidate.name) || null,
  }));
  const cohortEvaluations = [...evaluationEvidence].filter(([name]) => cohort.has(name));
  return {
    candidates: allCandidates.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'zh-CN')),
    cohortNames,
    submissionMessageCounts:Object.fromEntries([...submissionRecords].map(([name,records])=>[name,records.size])),
    funnel: {
      candidateCount:cohortNames.length,
      initialPassedCount:[...submissionEvidence.values()].filter(item => item.initialReview === 'OK').length,
      initialFailedCount:[...submissionEvidence.values()].filter(item => item.initialReview === 'No').length,
      initialPendingCount:[...submissionEvidence.values()].filter(item => !item.initialReview).length,
      groupEvaluatedCount:cohortEvaluations.length,
      groupPassedCount:cohortEvaluations.filter(([,item]) => item.passed === true).length,
      unmatchedCount:allCandidates.filter(item => !item.inSubmissionCohort).length,
    },
    dailyCounts,
    dailyNames,
    interviewEvents,
    sourceDate: sourceDates.sort().at(-1) || '',
    submittedCount: submitted.size
  };
}

function calendarTitleNamesPerson(title, name) {
  const summary = String(title || ''), candidate = String(name || '').trim();
  if (!candidate) return false;
  let from = 0;
  while (from < summary.length) {
    const index = summary.indexOf(candidate, from);
    if (index < 0) return false;
    const before = summary.slice(0, index).trimEnd();
    const after = summary.slice(index + candidate.length).trimStart();
    // An event entitled 王丽娜面试/复盘 must never be attributed to 王丽. The
    // limited role/interview/review labels cover normal calendar title shapes;
    // any other ambiguous title stays pending for a human to reconcile.
    const left = !before || !/\p{Script=Han}$/u.test(before) || /(?:(?:正式|线上|线下|视频)?面试|初试|复试|试播|复盘|候选人|主播|姓名)$/u.test(before);
    const right = !after || !/^\p{Script=Han}/u.test(after) || /^(?:(?:正式|线上|线下|视频)?面试|初试|复试|试播|复盘|主播)/u.test(after);
    if (left && right) return true;
    from = index + candidate.length;
  }
  return false;
}

/** Join formal calendar events to the single, source-backed recruitment submission.
 * A title mentioning two cohort members, duplicate event, or repeated submission
 * cannot silently become an interview-stage transition. A missing source is null,
 * not a measured zero. Existing later-stage conclusions are never rewritten.
 */
export function linkVerifiedRecruitmentCalendar(candidates = [], calendarEvents = {}, submissionMessageCounts = {}, {
  sourceReady = false, advanceStage = false
} = {}) {
  const original = Array.isArray(candidates) ? candidates : [];
  if (!sourceReady) return {candidates:original, matchedCount:null, pendingCount:null};
  const cohort = original.filter(item => item?.inSubmissionCohort && safeName(item?.name) === item?.name);
  const candidateCounts = new Map();
  const sourceIdCounts = new Map();
  for (const item of cohort) {
    candidateCounts.set(item.name, (candidateCounts.get(item.name) || 0) + 1);
    const sourceId = String(item.submissionEvidence?.sourceId || '');
    if (sourceId) sourceIdCounts.set(sourceId, (sourceIdCounts.get(sourceId) || 0) + 1);
  }
  const hits = new Map(), conflicted = new Set();
  let pendingCount = 0;
  for (const [date, events] of Object.entries(calendarEvents || {})) {
    for (const event of Array.isArray(events) ? events : []) {
      if (event?.status !== 'calendar') continue;
      const named = cohort.filter(item => (!item.boundaryCarryoverDate || item.boundaryCarryoverDate === date)
        && calendarTitleNamesPerson(event.name, item.name));
      if (!named.length) continue; // An unrelated event is not a missing cohort interview.
      const names = [...new Set(named.map(item => item.name))];
      const validEvent = /^20\d{2}-\d{2}-\d{2}$/u.test(date) && Boolean(String(event.eventId || '').trim());
      if (names.length !== 1 || !validEvent) {
        names.forEach(name => conflicted.add(name));
        pendingCount += 1;
        continue;
      }
      const name = names[0];
      const matches = hits.get(name) || [];
      matches.push({date, title:String(event.name || ''), eventId:String(event.eventId)});
      hits.set(name, matches);
    }
  }
  const eventIdCounts = new Map();
  for (const matches of hits.values()) for (const item of matches)
    eventIdCounts.set(item.eventId, (eventIdCounts.get(item.eventId) || 0) + 1);
  const verified = new Map();
  for (const [name, matches] of hits) {
    const candidate = cohort.find(item => item.name === name);
    const submission = candidate?.submissionEvidence;
    const validSubmission = candidateCounts.get(name) === 1 && candidate?.submissionIdentityStatus !== 'ambiguous'
      && submissionMessageCounts?.[name] === 1
      && /^om_[A-Za-z0-9_]+$/u.test(String(submission?.sourceId || ''))
      && sourceIdCounts.get(submission?.sourceId) === 1
      && submission?.name === name && /^20\d{2}-\d{2}-\d{2}$/u.test(String(submission?.date || ''));
    if (conflicted.has(name) || matches.length !== 1 || !validSubmission || matches[0].date < submission.date
      || eventIdCounts.get(matches[0]?.eventId) !== 1
      || !['initial_pass','pending_feedback','interview_pass','interview_fail'].includes(candidate.stage)
      || submission.initialReview !== 'OK') {
      conflicted.add(name);
      pendingCount += matches.length;
      continue;
    }
    verified.set(name, matches[0]);
  }
  const linked = original.map(candidate => {
    if (!candidate?.inSubmissionCohort) return candidate;
    if (conflicted.has(candidate.name)) return {...candidate, calendarScheduleStatus:'待核验：日历与唯一送审记录未能一一对应'};
    const event = verified.get(candidate.name);
    if (!event) return candidate;
    const evidence = {source:'正式面试日历', eventId:event.eventId, date:event.date, title:event.title};
    const base = {...candidate, calendarEvidence:evidence, calendarScheduleStatus:'已核验：正式面试日历唯一匹配'};
    if (!advanceStage || candidate.stage !== 'initial_pass' || candidate.submissionEvidence?.initialReview !== 'OK') return base;
    const note = `正式面试日历已安排：${event.title}`;
    const timeline = [...(candidate.timeline || [])];
    if (!timeline.some(item => item[0] === event.date && item[1] === note)) timeline.push([event.date,note]);
    return {...base, stage:'pending_feedback', status:'已安排正式面试 · 待面评', date:event.date, timeline};
  });
  return {candidates:linked, matchedCount:pendingCount ? null : verified.size, pendingCount};
}

/** Carry a prior-cycle submission only when the official calendar names that
 * person on the first day of the next cycle. No prior-cycle person is imported
 * just because their name occurred in the old chat. An incomplete previous
 * source blocks first-day attribution but leaves unrelated later dates alone.
 */
export function linkRecruitmentCalendarAcrossBoundary(currentCandidates = [], previousParsed = null,
  calendarEvents = {}, currentSubmissionCounts = {}, {
    boundaryDate = '', previousCycle = null, currentSourceReady = false,
    previousSourceReady = false, advanceStage = false
  } = {}) {
  const original = Array.isArray(currentCandidates) ? currentCandidates : [];
  const firstDayEvents = (calendarEvents?.[boundaryDate] || []).filter(item => item?.status === 'calendar');
  const regular = (events) => linkVerifiedRecruitmentCalendar(original, events, currentSubmissionCounts,
    {sourceReady:currentSourceReady,advanceStage});
  if (!firstDayEvents.length) {
    const linked = regular(calendarEvents);
    return {...linked, boundary:{status:'not_applicable',date:boundaryDate,matchedCount:0},carryCandidates:[]};
  }
  const withoutBoundary = {...calendarEvents};
  delete withoutBoundary[boundaryDate];
  const pending = reason => {
    const linked = regular(withoutBoundary);
    return {...linked, matchedCount:null,
      pendingCount:linked.pendingCount === null ? null : linked.pendingCount + firstDayEvents.length,
      boundary:{status:'pending',date:boundaryDate,reason,matchedCount:null},carryCandidates:[]};
  };
  if (!currentSourceReady || !previousSourceReady || !previousParsed || !previousCycle)
    return pending('跨周期招聘群或正式日历来源尚未完整核验');
  const prior = (previousParsed.candidates || []).filter(item => item?.inSubmissionCohort
    && item.submissionEvidence?.date >= previousCycle.startDate
    && item.submissionEvidence?.date < previousCycle.endDate)
    .map(item => ({...item,boundaryCarryoverDate:boundaryDate,boundarySourceCycle:previousCycle.month}));
  // A first-day event can carry an unreviewed, OK-marked submission, not the
  // previous cycle's interview result. Retests and offers need a new explicit
  // source association; retaining the old pass/fail would label the new event
  // as already evaluated. Leave the old record untouched and fail closed.
  if(prior.some(item=>firstDayEvents.some(event=>calendarTitleNamesPerson(event.name,item.name))
    && (item.stage!=='initial_pass'||item.evaluationEvidence||item.calendarEvidence
      ||item.interviewBinding||item.startDate||item.actualStartDate)))
    return pending('上周期已有面评、面试或录用证据，不能自动归属到新周期首日面试');
  // A new-cycle report for the same person is a separate, unlinked assertion.
  // Do not render it beside an older submission as two contradictory people or
  // send a reminder from the older row until the evidence is reconciled.
  const currentNames = new Set(original.map(item => item?.name).filter(Boolean));
  if (prior.some(item => currentNames.has(item.name)
    && firstDayEvents.some(event => calendarTitleNamesPerson(event.name,item.name))))
    return pending('跨周期同名面评或送审与上周期证据尚未关联');
  const counts = {...currentSubmissionCounts};
  for (const [name,count] of Object.entries(previousParsed.submissionMessageCounts || {}))
    counts[name] = (counts[name] || 0) + count;
  const linked = linkVerifiedRecruitmentCalendar([...original,...prior],calendarEvents,counts,
    {sourceReady:true,advanceStage});
  const firstDayLinked = linked.candidates.filter(item => item.calendarEvidence?.date === boundaryDate);
  const eventIds = firstDayEvents.map(item => String(item.eventId || ''));
  const linkedIds = firstDayLinked.map(item => String(item.calendarEvidence.eventId || ''));
  if (linked.pendingCount !== 0 || firstDayLinked.length !== firstDayEvents.length
    || eventIds.some(id => !id || linkedIds.filter(value => value === id).length !== 1))
    return pending('跨周期送审与首日正式面试日程无法唯一匹配');
  const current = linked.candidates.slice(0, original.length);
  const carryCandidates = linked.candidates.slice(original.length)
    .filter(item => item.calendarEvidence?.date === boundaryDate)
    .map(item => ({...item,inSubmissionCohort:false,boundaryCarryover:true}));
  return {candidates:[...current,...carryCandidates],matchedCount:linked.matchedCount,pendingCount:0,
    boundary:{status:'verified',date:boundaryDate,sourceCycle:previousCycle.month,
      matchedCount:firstDayLinked.length,submissionMessageCounts:previousParsed.submissionMessageCounts || {}},
    carryCandidates};
}

/** Recalled messages remain in Feishu list pages, but their reaction records
 * are inaccessible. Exclude them from both review lookup and candidate parsing.
 */
export function activeChatMessages(messages = []) {
  if (!Array.isArray(messages)) throw new Error('招聘群消息列表无法核验。');
  return messages.filter(message => message && message.deleted !== true);
}

/** A partial reaction response must never turn an unknown review into zero.
 * The Feishu batch endpoint pages each message independently after ten
 * reactions, and can report per-message failures while the outer call succeeds.
 */
export async function readCompleteMessageReactions(messageIds = [], requestBatch) {
  if (!Array.isArray(messageIds) || typeof requestBatch !== 'function') throw new Error('招聘表情读取参数无效。');
  const ids = [...new Set(messageIds)];
  if (ids.some(id => !/^om_[A-Za-z0-9_]+$/u.test(id))) throw new Error('招聘消息编号无法核验。');
  const results = new Map();
  for (let start = 0; start < ids.length; start += 20) {
    const states = new Map(ids.slice(start,start + 20).map(id => [id,{counts:null,items:[],pageTokens:new Set(),signatures:new Set()}]));
    let pending = [...states.keys()].map(message_id => ({message_id}));
    for (let page = 0; pending.length; page += 1) {
      if (page >= 100) throw new Error('招聘表情分页超过安全上限，结果待核验。');
      const response = await requestBatch({queries:pending,page_size_per_message:10});
      if (!Array.isArray(response?.success_msg_reaction_details) || !Array.isArray(response?.success_msg_reaction_counts)
        || !Array.isArray(response?.fail_msg_reaction_details) || response.fail_msg_reaction_details.length) {
        throw new Error('招聘表情批量读取不完整，结果待核验。');
      }
      const details = new Map(response.success_msg_reaction_details.map(row => [row.message_id,row]));
      const counts = new Map(response.success_msg_reaction_counts.map(row => [row.message_id,row]));
      if (details.size !== response.success_msg_reaction_details.length || counts.size !== response.success_msg_reaction_counts.length)
        throw new Error('招聘表情批量结果包含重复消息，结果待核验。');
      const next = [];
      for (const query of pending) {
        const detail = details.get(query.message_id), count = counts.get(query.message_id), state = states.get(query.message_id);
        if (!detail || !count || !Array.isArray(detail.message_reaction_items) || !Array.isArray(count.reaction_count)
          || typeof detail.has_more !== 'boolean') throw new Error('招聘表情缺少完整消息记录，结果待核验。');
        const normalizedCounts = count.reaction_count.map(row => ({reactionType:row.reaction_type,count:Number(row.count)}))
          .sort((left,right) => left.reactionType.localeCompare(right.reactionType));
        if (normalizedCounts.some(row => !row.reactionType || !Number.isSafeInteger(row.count) || row.count < 0))
          throw new Error('招聘表情计数无法核验。');
        if (state.counts === null) state.counts = normalizedCounts;
        else if (JSON.stringify(state.counts) !== JSON.stringify(normalizedCounts))
          throw new Error('招聘表情在分页期间发生变化，结果待重新核验。');
        for (const item of detail.message_reaction_items) {
          const signature = JSON.stringify([item?.operator?.operator_id,item?.emoji_type,item?.action_time]);
          if (!item?.operator?.operator_id || !item?.emoji_type || !item?.action_time || state.signatures.has(signature))
            throw new Error('招聘表情详情缺失或跨页重复，结果待核验。');
          state.signatures.add(signature);
          state.items.push({emojiType:item.emoji_type,actionTime:item.action_time,operatorId:item.operator.operator_id});
        }
        if (detail.has_more) {
          const token = detail.page_token;
          if (typeof token !== 'string' || !token || state.pageTokens.has(token))
            throw new Error('招聘表情分页标记无效，结果待核验。');
          state.pageTokens.add(token);
          next.push({message_id:query.message_id,page_token:token});
        }
      }
      pending = next;
    }
    for (const [id,state] of states) {
      if (state.counts.reduce((sum,row) => sum + row.count,0) !== state.items.length)
        throw new Error('招聘表情总数与详情不符，结果待核验。');
      results.set(id,{counts:state.counts,details:state.items});
    }
  }
  return results;
}

export function interviewReminderSourceFingerprint(snapshot, date) {
  // Bind the reminder to both named calendar events and the recruitment chat
  // cohort. Sorting makes harmless API order changes irrelevant.
  const calendar = (snapshot?.interviewEvents?.[date] || [])
    .filter(item => item?.status === 'calendar')
    .map(item => [String(item.eventId || ''), String(item.name || ''),
      String(item.startAt || ''),String(item.endAt || ''),String(item.summaryFingerprint || '')])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const cohort = (snapshot?.candidates || [])
    .filter(item => item?.inSubmissionCohort || item?.boundaryCarryover)
    .map(item => [String(item.name || ''), String(item.submissionEvidence?.sourceId || ''),
      String(item.submissionEvidence?.initialReview || ''),String(item.calendarEvidence?.eventId || '')])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const submissionCounts = Object.entries(snapshot?.submissionMessageCounts || {})
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({calendar, cohort, submissionCounts, capped:Boolean(snapshot?.coverage?.capped),
    reactionStatus:String(snapshot?.coverage?.reactionStatus || ''),
    boundary:snapshot?.boundaryCarryover || null});
}

export function buildInterviewReminderPreview(snapshot, date) {
  const pending = (reason) => ({status:'pending',reason,date,matches:[],text:'',readyForSend:false});
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(String(date || ''))) return pending('面试日期无效');
  if (!String(snapshot?.calendarStatus || '').startsWith('已连接：')) return pending('正式面试日历尚未接入');
  if (snapshot?.coverage?.capped || snapshot?.coverage?.reactionStatus !== '已核验') return pending('招聘群证据不完整');
  const events = (snapshot?.interviewEvents?.[date] || []).filter(item => item?.status === 'calendar');
  if (!events.length) return pending('当天没有可核验的正式面试日程');
  const boundaryDate = recruitmentCycleRange(recruitmentCycleMonthForDate(date)).startDate;
  if (date === boundaryDate && snapshot?.boundaryCarryover?.status !== 'verified')
    return pending('跨周期招聘群来源与首日面试人尚未完整核验');
  if (date !== boundaryDate && !snapshot?.coverage?.chatMessages) return pending('招聘群证据不完整');
  const candidates = (snapshot?.candidates || []).filter(item => (item?.inSubmissionCohort ||
    (date === boundaryDate && item?.boundaryCarryover)) && item?.name);
  const matches = [];
  for (const event of events) {
    const named = candidates.filter(item => calendarTitleNamesPerson(event.name, item.name));
    const candidate = named[0];
    const count = candidate?.boundaryCarryover
      ? snapshot?.boundaryCarryover?.submissionMessageCounts?.[candidate.name]
      : snapshot?.submissionMessageCounts?.[candidate?.name];
    if (named.length !== 1 || count !== 1 || candidate?.submissionIdentityStatus === 'ambiguous'
      || candidate?.submissionEvidence?.initialReview !== 'OK'
      || !/^om_[A-Za-z0-9_]+$/u.test(String(candidate?.submissionEvidence?.sourceId || ''))
      || !/^20\d{2}-\d{2}-\d{2}$/u.test(String(candidate?.submissionEvidence?.date || ''))
      || candidate.submissionEvidence.date > date || candidate.calendarEvidence?.eventId !== event.eventId)
      return pending('面试日程与唯一送审候选人无法一一核对');
    // A carried submission is read from the previous recruitment cycle, but
    // the self-binding path still accepts only this cycle's submission cohort.
    // Do not call the full-day 17:00 roster send-ready until that older source
    // can be signed and read back through the same exact-ID binding path.
    if (candidate.boundaryCarryover)
      return pending('跨周期首日候选人的上周期送审与本人面评尚不能完整绑定读回，17:00 提醒待核验');
    matches.push({name:candidate.name,eventId:event.eventId || ''});
  }
  const unique = [...new Set(matches.map(item => item.name))];
  if (unique.length !== matches.length || matches.some(item => !item.eventId) ||
      new Set(matches.map(item => item.eventId)).size !== matches.length)
    return pending('正式面试日程与候选人或事件编号未能一一对应');
  return {
    status:'preview', date, matches, sourceReady:true, readyForSend:false,
    text:`【今日主播面试结果提醒｜${date}】\n今日面试候选人：${unique.join('、')}。\n请在面评群逐一确认“通过 / 未通过”，未取得明确结论的保留待核验。`,
    reason:'正式日历事件与送审候选人已逐一匹配；发送前仍需核验机器人身份和收件人',
  };
}

/** Recruitment cycles run from the previous month's 25th through this month's 24th. */
export function recruitmentCycleMonthForDate(date) {
  const value = String(date || '');
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(value)) return '';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + (day >= 25 ? 1 : 0), 1)).toISOString().slice(0, 7);
}

export function recruitmentCycleRange(month) {
  const value = String(month || '');
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/u.test(value)) throw Object.assign(new Error('招聘月份格式应为 YYYY-MM。'), {status:400});
  const [year, monthNumber] = value.split('-').map(Number);
  const startMonth = monthNumber === 1 ? 12 : monthNumber - 1;
  const startYear = monthNumber === 1 ? year - 1 : year;
  const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-25`;
  const endDate = `${year}-${String(monthNumber).padStart(2, '0')}-25`;
  return {
    month:value,
    startDate,
    endDate,
    startTime:Math.floor(new Date(`${startDate}T00:00:00+08:00`).getTime() / 1000),
    // Bound the requested range to the last second before the next cycle.
    endTime:Math.floor(new Date(`${endDate}T00:00:00+08:00`).getTime() / 1000) - 1
  };
}

export function recruitmentBoundaryCycleRange(month) {
  const current = recruitmentCycleRange(month);
  const previousDate = chinaDateFor(new Date((current.startTime - 1) * 1000));
  const previous = recruitmentCycleRange(recruitmentCycleMonthForDate(previousDate));
  return {date:current.startDate,previous};
}

/** Late restarts must not turn a timed work reminder into an after-hours send. */
export function lifecycleReminderWindow(kind, chinaMinute) {
  const start = kind === 'interview' ? 17 * 60 : kind === 'coach' ? 17 * 60 + 30 : null;
  if (start === null || !Number.isInteger(chinaMinute) || chinaMinute < 0 || chinaMinute >= 24 * 60) return 'invalid';
  if (chinaMinute < start) return 'before';
  return chinaMinute < start + 60 ? 'open' : 'missed';
}

function utcDate(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

const dateText = value => value.toISOString().slice(0, 10);
const shiftDate = (value, days) => {
  const result = new Date(value.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};

/** The business week is Wednesday through the following Tuesday, inclusive. */
export function reviewWeekFor(date = chinaDateFor()) {
  const day = utcDate(date);
  if (!day) return null;
  const start = shiftDate(day, -((day.getUTCDay() + 4) % 7));
  const end = shiftDate(start, 6);
  return {start:dateText(start),end:dateText(end),previousStart:dateText(shiftDate(start, -7)),previousEnd:dateText(shiftDate(start, -1))};
}

/** A multi-page Sheets read is usable only when every page and the final
 * sentinel read came from the same positive workbook revision. */
export async function readVersionedCoachRankingRows(rowCount, fetchRange) {
  if (!Number.isInteger(rowCount) || rowCount < 5 || rowCount > 4000 || typeof fetchRange !== 'function') {
    throw new Error('周排名工作表行数无法核验，已停止轮转统计。');
  }
  const values = [];
  let revision = null;
  for (let start = 1; start <= rowCount; start += 250) {
    const end = Math.min(rowCount, start + 249);
    const page = await fetchRange(start, end);
    const pageRevision = Number(page?.revision);
    if (!Number.isSafeInteger(pageRevision) || pageRevision <= 0 || !Array.isArray(page?.values)) {
      throw new Error('周排名 Q:U 内容或版本缺失，已停止轮转统计。');
    }
    if (revision !== null && pageRevision !== revision) {
      throw new Error('周排名读取期间版本发生变化，已停止轮转统计。');
    }
    revision = pageRevision;
    for (let offset = 0; offset <= end - start; offset += 1) {
      values.push(Array.isArray(page.values[offset]) ? page.values[offset] : []);
    }
  }
  // Row 1 of the verified sheet is blank. Re-read the non-empty heading area
  // so the values API always returns a values array along with its revision.
  const sentinel = await fetchRange(2, 3);
  if (!Number.isSafeInteger(Number(sentinel?.revision)) || Number(sentinel.revision) !== revision || !Array.isArray(sentinel?.values)) {
    throw new Error('周排名读取结束时版本发生变化或无法核验，已停止轮转统计。');
  }
  return {values, revision};
}

/** The official instance_view API has no pagination fields. Read the full
 * performance week and independently verify it against two shorter windows;
 * an inconsistent or incomplete response must never become a zero count. */
export async function readVerifiedCoachInstances(week, readRange) {
  const startDate = utcDate(week?.start), endDate = utcDate(week?.end);
  if (!startDate || !endDate || endDate.getTime() - startDate.getTime() !== 6 * 86400_000 || typeof readRange !== 'function') {
    throw new Error('教练复盘统计周范围无法核验。');
  }
  const start = Math.floor(Date.parse(`${week.start}T00:00:00+08:00`) / 1000);
  const end = Math.floor(Date.parse(`${week.end}T23:59:59+08:00`) / 1000);
  const split = start + 3 * 86400;
  function normalize(data) {
    if (!Array.isArray(data?.items) || (Object.hasOwn(data,'has_more') && data.has_more !== false)
      || (data.page_token !== undefined && data.page_token !== null && data.page_token !== '')
      || (data.sync_token !== undefined && data.sync_token !== null && data.sync_token !== '')) {
      throw new Error('教练日历实例视图未返回完整、可核验的日程。');
    }
    const found = new Map();
    for (const item of data.items) {
      const eventId = String(item?.event_id || '');
      const status = String(item?.status || '');
      const time = item?.start_time;
      const rawTimestamp = time?.timestamp;
      const hasTimestamp = rawTimestamp !== undefined && rawTimestamp !== null && String(rawTimestamp) !== '';
      const timestamp = hasTimestamp ? Number(rawTimestamp) : 0;
      if (!eventId || typeof item.summary !== 'string' || !['tentative','confirmed','cancelled'].includes(status)
        || (hasTimestamp && (!Number.isSafeInteger(timestamp) || timestamp <= 0))
        || (!hasTimestamp && !utcDate(time?.date))) {
        throw new Error('教练日历实例缺少可核验的 ID、标题、状态或开始时间。');
      }
      const instant = hasTimestamp ? new Date(timestamp * 1000) : null;
      if (instant && Number.isNaN(instant.getTime())) throw new Error('教练日历实例开始时间无效。');
      const event = {eventId,summary:item.summary,status,
        date:instant ? chinaDateFor(instant) : time.date,startAt:instant ? instant.toISOString() : ''};
      const previous = found.get(eventId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error('教练日历实例 ID 重复且内容不一致。');
      found.set(eventId,event);
    }
    return found;
  }
  const full = normalize(await readRange(start,end));
  const first = normalize(await readRange(start,split - 1));
  const second = normalize(await readRange(split,end));
  const combined = new Map(first);
  for (const [id,event] of second) {
    const previous = combined.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error('教练日历分段实例内容发生变化。');
    combined.set(id,event);
  }
  if (full.size !== combined.size || [...full].some(([id,event]) => JSON.stringify(combined.get(id)) !== JSON.stringify(event))) {
    throw new Error('教练日历周窗与分段实例不一致，已停止计次。');
  }
  return [...full.values()];
}

/** Private, room-specific digest for a second read immediately before POST.
 * Keep titles and event IDs out of public snapshots and notification journals. */
export function coachCalendarFingerprint(events) {
  if (!Array.isArray(events)) throw new Error('教练日历实例清单无法核验。');
  const seen = new Set();
  const rows = events.map(event => {
    const {eventId,summary,status,date,startAt} = event || {};
    if (typeof eventId !== 'string' || !eventId || seen.has(eventId) || typeof summary !== 'string'
      || !['tentative','confirmed','cancelled'].includes(status) || !utcDate(date)
      || (startAt !== '' && (typeof startAt !== 'string' || !Number.isFinite(Date.parse(startAt))))) {
      throw new Error('教练日历实例指纹无法核验。');
    }
    seen.add(eventId);
    return [eventId,summary,status,date,startAt];
  }).sort((left,right) => left[0].localeCompare(right[0]));
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

export async function assertCoachRankingRevision(expectedRevision, readSentinel) {
  const sentinel = await readSentinel();
  const actual = Number(sentinel?.revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0 || !Number.isSafeInteger(actual) || actual !== expectedRevision || !Array.isArray(sentinel?.values)) {
    throw new Error('周排名在通知前已变化或版本无法核验，已停止发送。');
  }
  return true;
}

const roomForRotation = value => {
  const text = String(value || '').trim();
  if (text === '官旗') return '官旗';
  if (text === '品牌精选' || text === '品牌') return '品牌精选';
  if (text === '优选') return '优选';
  if (text === '王鸥美肤' || text === '王鸥') return '王鸥美肤';
  return '';
};

/** Q:U in the verified weekly-rank sheet: current room, anchor, score, rank, next room. */
export function parseWeeklyCoachRotation(rows = [], date = chinaDateFor()) {
  const week = reviewWeekFor(date);
  const pending = reason => ({status:'pending',reason,week,rooms:{}});
  if (!week || !Array.isArray(rows)) return pending('统计日期或周排名内容无效');
  const heading = /(?:20\d{2}[.\/-])?(\d{1,2})[.\/-](\d{1,2})\s*[-—～~至]\s*(\d{1,2})[.\/-](\d{1,2})\s*日?主播排名/u;
  const previous = `${Number(week.previousStart.slice(5, 7))}.${Number(week.previousStart.slice(8))}-${Number(week.previousEnd.slice(5, 7))}.${Number(week.previousEnd.slice(8))}`;
  let firstRow = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const match = String(rows[index]?.[0] || '').match(heading);
    if (!match) continue;
    const period = `${Number(match[1])}.${Number(match[2])}-${Number(match[3])}.${Number(match[4])}`;
    if (period === previous) {
      if (firstRow >= 0) return pending('上周排名出现多个同日期区段，无法唯一核验轮转名单');
      firstRow = index;
    }
  }
  if (firstRow < 0) return pending(`未找到 ${week.previousStart} 至 ${week.previousEnd} 的完整上周排名`);
  const titles = (rows[firstRow + 1] || []).map(value => String(value || '').trim());
  if (titles[0] !== '本周所在直播间' || titles[1] !== '主播' || !titles[4]?.includes('下周直播间')) return pending('上周排名 Q:U 列头与约定不符');
  const rooms = Object.fromEntries(ROOM_NAMES.map(room => [room, []]));
  const seen = new Set();
  const warnings = [];
  for (let index = firstRow + 2; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const current = String(row[0] || '').trim();
    if (!current || heading.test(current) || current === '本周所在直播间') break;
    const name = safeName(row[1]);
    if (!name) {
      if (roomForRotation(current) || roomForRotation(row[4])) warnings.push(`周排名第 ${index + 1} 行主播姓名待核验`);
      continue;
    }
    const target = roomForRotation(row[4]);
    if (!target) {
      if (!/(离职|考核|新人池|主播池)/u.test(String(row[4] || ''))) warnings.push(`${name}：下周直播间待核验`);
      continue;
    }
    if (seen.has(name)) return pending(`上周排名中主播 ${name} 重复，已停止教练归属判断`);
    seen.add(name);
    rooms[target].push(name);
  }
  if (Object.values(rooms).every(names => names.length === 0)) return pending('上周排名没有可核验的下周直播间归属');
  return {status:warnings.length ? 'partial' : 'ready',week,sourcePeriod:{start:week.previousStart,end:week.previousEnd},rooms,warnings};
}

/** Count only distinct calendar events whose title names exactly one assigned anchor and says 复盘. */
export function countCoachReviews(rotation, eventsByRoom = {}, asOf = new Date()) {
  const pending = reason => ({status:'pending',reason,week:rotation?.week || null,rooms:{}});
  if (rotation?.status !== 'ready') return pending(rotation?.reason || '周排名存在待核验人员');
  const result = {};
  for (const room of ROOM_NAMES) {
    const events = eventsByRoom[room];
    if (!Array.isArray(events)) {
      result[room] = {status:'pending',reason:'教练日历尚未授权或读取失败',anchors:[]};
      continue;
    }
    const anchors = (rotation.rooms[room] || []).map(name => ({name,count:0}));
    const used = new Set();
    for (const event of events) {
      const id = String(event?.eventId || event?.event_id || '');
      const summary = String(event?.summary || '');
      const date = String(event?.date || '');
      const startAt = Date.parse(event?.startAt || '');
      // All-day instances have start_time.date, not a timestamp. They begin
      // at local midnight, so today's all-day review counts at 17:30.
      const happened = Number.isFinite(startAt) ? startAt <= asOf.getTime() : date <= chinaDateFor(asOf);
      if (!id || used.has(id) || event?.status === 'cancelled' || date < rotation.week.start || date > rotation.week.end || !happened || !summary.includes('复盘')) continue;
      const matches = anchors.filter(item => calendarTitleNamesPerson(summary, item.name));
      if (matches.length !== 1) continue;
      used.add(id);
      matches[0].count += 1;
    }
    result[room] = {status:'ready',anchors,zeroReview:anchors.filter(item => item.count === 0).map(item => item.name)};
  }
  return {status:Object.values(result).every(room => room.status === 'ready') ? 'ready' : 'partial',week:rotation.week,rooms:result};
}

export function coachReviewReminder(room, coachName, summary) {
  const entry = summary?.rooms?.[room];
  if (entry?.status !== 'ready') return {status:'pending',reason:entry?.reason || '教练复盘证据待核验'};
  if (!entry.anchors.length) return {status:'pending',reason:'本周没有可核验的轮转主播名单'};
  const lines = entry.anchors.map(item => `${item.name}：${item.count} 次${item.count ? '' : '（本周尚未记录复盘）'}`);
  return {status:'ready',text:`【主播复盘提醒｜${summary.week.start}—${summary.week.end}】\n${coachName}，截至当前，本绩效周 ${room} 直播间主播复盘日历记录：\n${lines.join('\n')}\n请按本周名单逐一复盘；未记录的主播请及时安排。统计仅依据你本人日历中同时含主播姓名和“复盘”的可核验日程。`};
}

function numberFrom(section, pattern) {
  const match = section.match(pattern);
  return match ? Number(match[1]) : null;
}

export function parseLatestCoachSummary(content = '') {
  const source = String(content || '').replace(/\r/g, '');
  const heading = /(?:^|\n)\s*(20\d{2})[.年/-](\d{1,2})[.月/-](\d{1,2})日?\s*新人池情况\s*[：:]?/gu;
  const matches = [...source.matchAll(heading)];
  if (!matches.length) return null;
  const sections = matches.map((match, index) => {
    const date = `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
    const end = matches[index + 1]?.index ?? source.length;
    return { date, text: source.slice(match.index, end) };
  }).sort((a, b) => b.date.localeCompare(a.date));
  const latest = sections[0];
  const training = latest.text.match(/培训进度[：:]?\s*([\p{Script=Han}·]{2,12})?\s*入职培训第\s*(\d+)\s*天/u);
  return {
    date: latest.date,
    inTraining: numberFrom(latest.text, /新人池[：:]?\s*(\d+)\s*人/u),
    projectHeadcount: numberFrom(latest.text, /项目内编制[^\d]{0,12}(\d+)\s*人/u),
    pendingAssessment: numberFrom(latest.text, /待入职考核[：:]?\s*(\d+)\s*人/u),
    yesterdaySubmitted: numberFrom(latest.text, /昨日送审简历数量[：:]?\s*(\d+)\s*(?:个|份)?/u),
    newcomerName: safeName(training?.[1] || ''),
    newcomerDay: training ? Number(training[2]) : null
  };
}

export function mergeRecruitmentCandidates(base = [], updates = []) {
  const merged=base.map(item=>({...item}));
  for (const update of updates) {
    const submissionId=String(update?.submissionMessageId || update?.submissionEvidence?.sourceId || '');
    if (!/^om_[A-Za-z0-9_]+$/u.test(submissionId)) continue;
    const matching=merged.map((item,index)=>({item,index})).filter(({item})=>item?.name===update?.name
      && item?.inSubmissionCohort===true && item?.submissionIdentityStatus!=='ambiguous'
      && item?.submissionEvidence?.sourceId===submissionId);
    if(matching.length!==1)continue;
    const {item:existing,index}=matching[0];
    // A separately sourced record with the same display name cannot resolve
    // two competing submission message IDs in the recruitment cycle.
    if (existing?.submissionIdentityStatus === 'ambiguous') continue;
    const timeline = [...(existing?.timeline || [])];
    for (const item of update.timeline || []) if (!timeline.some(row => row[0] === item[0] && row[1] === item[1])) timeline.push(item);
    merged[index]={...existing,...update,media:existing.media || update.media,timeline};
  }
  return merged;
}

export function assessmentSubmissionKey(cycleMonth, submissionMessageId) {
  const cycle = String(cycleMonth || '');
  const sourceId = String(submissionMessageId || '');
  return /^20\d{2}-(?:0[1-9]|1[0-2])$/u.test(cycle) && /^om_[A-Za-z0-9_]+$/u.test(sourceId)
    ? `${cycle}:${sourceId}` : '';
}

export function structuredAssessmentForCandidate(summary, candidate, cycleMonth) {
  const key = assessmentSubmissionKey(cycleMonth,candidate?.submissionEvidence?.sourceId);
  const match = key && summary?.bySubmission?.[key];
  return match?.candidateName === candidate?.name ? match : null;
}

/** A signed structured conclusion is distinct from, and never labelled as, a private chat. */
export function structuredAssessmentSummary(candidates = [], entries = [], cycleMonth = '', assessors = {}) {
  const bySubmission = {};
  let passedCount = 0, failedCount = 0, conflictCount = 0, awaitingCount = 0;
  const cohort = candidates.filter(item => item?.inSubmissionCohort && item?.name);
  const sourceCounts = new Map();
  for (const candidate of cohort) {
    const key = assessmentSubmissionKey(cycleMonth,candidate.submissionEvidence?.sourceId);
    if (key) sourceCounts.set(key,(sourceCounts.get(key) || 0)+1);
  }
  for (const candidate of cohort) {
    const key = assessmentSubmissionKey(cycleMonth,candidate.submissionEvidence?.sourceId);
    if (!key) {awaitingCount += 1;continue;}
    if (sourceCounts.get(key) !== 1) {
      bySubmission[key] = {candidateName:'',status:'送审消息对应多个候选人，待人工核验',passed:null,source:'结构化双人确认',signed:[]};
      conflictCount += 1;
      continue;
    }
    const decisions = entries.filter(entry => candidate.submissionEvidence?.sourceId && entry?.cycleMonth === cycleMonth && entry?.candidateName === candidate.name
      && entry?.submissionMessageId === candidate.submissionEvidence?.sourceId && assessors[entry?.actorOpenId]
      && ['pass','fail'].includes(entry?.outcome));
    const byActor = new Map(decisions.map(entry => [entry.actorOpenId,entry]));
    const signed = [...byActor.values()].map(entry => ({actorName:assessors[entry.actorOpenId],outcome:entry.outcome,at:entry.createdAt,recordId:entry.id}));
    const outcomes = [...byActor.values()].map(entry => entry.outcome);
    const duplicate = byActor.size !== decisions.length;
    const complete = !duplicate && Object.keys(assessors).length === 2 && outcomes.length === 2;
    const conflict = duplicate || (complete && new Set(outcomes).size !== 1);
    const passed = complete && !conflict ? outcomes[0] === 'pass' : null;
    const status = conflict ? '结论冲突，待人工核验' : !complete ? '待两位负责人逐人确认' : passed ? '双人确认考核通过' : '双人确认考核未通过';
    if (conflict) conflictCount += 1;
    else if (!complete) awaitingCount += 1;
    else if (passed) passedCount += 1;
    else failedCount += 1;
    bySubmission[key] = {candidateName:candidate.name,status,passed,source:'结构化双人确认',signed};
  }
  return {bySubmission,passedCount,failedCount,conflictCount,awaitingCount,source:'结构化双人确认；未读取指定私聊'};
}

/** Resolve only an exact, verified OA number binding; never infer from a name or role. */
export function centralFeishuOpenId(auth, verifiedNumbers = {}) {
  if (auth?.mode !== 'central' || auth?.degraded || !auth?.ok) return '';
  const user = auth.user || {};
  const number = typeof user.number === 'string' ? user.number : '';
  if (!/^FD-\d{6}$/u.test(number) || !Object.hasOwn(verifiedNumbers,number)) return '';
  const boundOpenId = verifiedNumbers[number];
  if (!/^ou_[A-Za-z0-9]+$/u.test(boundOpenId || '')) return '';
  const values = [user.open_id,user.openId,user.feishu_open_id,user.feishuOpenId]
    .filter(value=>typeof value==='string' && value.trim());
  const unique=[...new Set(values)];
  return unique.length<=1 && (!unique.length || unique[0]===boundOpenId) ? boundOpenId : '';
}

/** Only the same app's current contact record can confirm an OA employee binding. */
export function isVerifiedLiveCenterContact(user, {openId, name, departmentId, employeeNo = ''} = {}) {
  return Boolean(user?.open_id === openId && user?.name === name
    && user?.status?.is_activated === true && user?.status?.is_exited === false
    && user?.status?.is_frozen === false && user?.status?.is_resigned === false
    && user?.status?.is_unjoin === false
    && Array.isArray(user?.department_ids) && user.department_ids.includes(departmentId)
    && (!employeeNo || user?.employee_no === employeeNo));
}

export function assessmentSubmissionFor(snapshot, payload) {
  const name=safeName(payload?.candidateName);
  if(!name || !['pass','fail'].includes(payload?.outcome))return {status:'invalid',reason:'候选人姓名或考核结论无效。'};
  if(snapshot?.coverage?.capped || !snapshot?.coverage?.chatMessages)return {status:'pending',reason:'招聘群当前周期消息不完整，不允许确认考核。'};
  const matches=(snapshot?.candidates||[]).filter(item=>item.inSubmissionCohort&&item.name===name);
  if(matches.length!==1)return {status:'pending',reason:'未找到唯一的送审候选人。'};
  if(snapshot?.submissionMessageCounts?.[name]!==1)return {status:'pending',reason:'该姓名对应多条送审消息，须核验候选人唯一身份。'};
  const submissionId=matches[0].submissionEvidence?.sourceId;
  const requestId=String(payload?.submissionMessageId||'');
  if(!/^om_[A-Za-z0-9_]+$/u.test(submissionId||'')||requestId!==submissionId)return {status:'pending',reason:'送审消息编号无法与当前候选人核对。'};
  if((snapshot.candidates||[]).filter(item=>item.inSubmissionCohort&&item.submissionEvidence?.sourceId===submissionId).length!==1)
    return {status:'pending',reason:'同一送审消息对应多个候选人，不能确认考核。'};
  if(Object.values(snapshot.dailyNames||{}).filter(names=>Array.isArray(names)&&names.includes(name)).length!==1)
    return {status:'pending',reason:'同名候选人在周期内重复送审，不能仅凭姓名确认。'};
  return {status:'ready',candidate:matches[0],candidateName:name,submissionMessageId:submissionId,outcome:payload.outcome};
}

export function normalizeAnchorReport(report, coachSummary = null) {
  const rooms = {};
  for (const room of Array.isArray(report?.rooms) ? report.rooms : []) {
    if (!ROOM_NAMES.includes(room?.name)) continue;
    const people = (Array.isArray(room.people) ? room.people : []).map((person, index) => {
      const values = Array.isArray(person) ? person : [person?.name, person?.score, person?.resource, person?.delta, person?.evaluation || person?.evidence];
      const name = safeName(values[0]);
      if (!name || name === '待确认') return null;
      const parsedScore = Number(values[1]);
      return {
        name,
        score: Number.isFinite(parsedScore) ? parsedScore : null,
        slot: String(values[2] || '待核验'),
        delta: Number.isFinite(Number(values[3])) ? Number(values[3]) : null,
        comment: String(values[4] || '当日评价待核验'),
        rank: index + 1
      };
    }).filter(Boolean);
    if (people.length) rooms[room.name] = people;
  }
  return {
    date: String(report?.date || coachSummary?.date || ''),
    generatedAt: String(report?.generatedAt || new Date().toISOString()),
    rooms,
    summary: coachSummary,
    sourceCoverage: report?.sourceCoverage || null,
    verifiedRooms: Object.keys(rooms)
  };
}

export function isLifecycleRefreshDue({
  now = new Date(),
  lastAutomaticSlot = '',
  times = ['09:30', '18:00'],
} = {}) {
  const date = chinaDateFor(now);
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const pick = type => Number(parts.find(item => item.type === type)?.value || 0);
  const currentMinutes = pick('hour') * 60 + pick('minute');
  const normalizedTimes = [...new Set((Array.isArray(times) ? times : String(times || '').split(','))
    .map(value => String(value).trim())
    .filter(value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)))]
    .sort();
  const slot = normalizedTimes.filter(value => {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute <= currentMinutes;
  }).at(-1) || '';
  const slotKey = slot ? `${date}T${slot}` : '';
  return {date, slot, slotKey, due:Boolean(slotKey && lastAutomaticSlot !== slotKey)};
}

export { ROOM_NAMES };

export function feishuDocumentLink(field) {
  const strings=value=>typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(strings):value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
  for(const text of strings(field)){
    const url=text.match(/https:\/\/jqx28l0j4lx\.feishu\.cn\/(?:wiki|docx)\/[A-Za-z0-9]+(?:\?[^\s<>()\]"']*)?/u)?.[0];
    if(url)return url;
  }
  return '';
}

/** Return only attributable evaluation sections; operational notices are not reviews. */
export function extractAnchorEvaluation(text, name, names = []) {
  if (/(?:归档通知|归档核对|补归档|开播确认|开播通知|开播主播助理已确认)/u.test(String(text||''))) return '';
  const roster = [...new Set([...names, name])].filter(Boolean);
  const sections = [];
  let owner = '', lines = [];
  const flush = () => {
    if (owner === name) {
      const body = lines.filter(line => !/(?:开播|关播|收播|下播|到岗|打卡)(?:了|啦|时间|提醒|通知|准备|报备|[：:！!]|$)/u.test(line));
      const value = body.join('\n').trim();
      if (/(?:话术|节奏|转化|讲解|逼单|互动|状态|表现|改进|优点|问题|建议|复盘|成交|留人|评价|情绪|痛点|卖点|逻辑)/u.test(value)) sections.push(value);
    }
    lines = [];
  };
  for (const line of String(text || '').split(/\r?\n/u)) {
    const mentions = roster.filter(candidate => line.includes(candidate));
    if (mentions.length) { flush(); owner = mentions.length === 1 ? mentions[0] : ''; }
    if (owner) lines.push(line);
  }
  flush();
  return sections.join('\n\n');
}

export function verifiedAnchorEvidence(snapshot, now=Date.now()) {
  if(!snapshot)return snapshot;
  const names=Object.keys(snapshot.evidenceByAnchor||{});
  const within=(item,days)=>{const t=Date.parse(item.createdAt||'');return Number.isFinite(t)&&t<=now&&t>=now-days*86400000};
  const media=item=>(item.resources||[]).some(r=>['video','audio'].includes(r.type)||/\.(?:mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg)$/iu.test(r.name||''));
  const evidenceByAnchor=Object.fromEntries(names.map(name=>{
    const old=snapshot.evidenceByAnchor[name]||{};
    return [name,{...old,
      evaluations:(old.evaluations||[]).filter(x=>x.source==='WIS直播战队'&&within(x,5)).map(x=>({...x,text:extractAnchorEvaluation(x.text,name,names)})).filter(x=>x.text),
      recordings:(old.recordings||[]).filter(x=>within(x,3)&&media(x)&&names.filter(n=>String(x.text||'').includes(n)).length===1)
    }];
  }));
  return {...snapshot,evidenceByAnchor,evidencePolicy:'attributable-review-v2'};
}
