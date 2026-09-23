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
  if (/^(候选人|求职者|初审通过|初审不通过|主播|是否符合|招聘端|面试通过)$/u.test(name)) return '';
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
  const details = Array.isArray(message?.reactions?.details) ? message.reactions.details : [];
  return details.map(item => ({
    emoji:String(item?.emojiType || item?.emoji_type || ''),
    operatorId:String(item?.operatorId || item?.operator?.operator_id || item?.operator?.open_id || item?.operator?.id || '')
  })).find(item => item.operatorId === reviewerOpenId && ['OK','No'].includes(item.emoji));
}

function interviewEvaluation(text) {
  const normalized = String(text || '').replace(/\r/gu, '');
  if (!/颜值\s*\d|表现力\s*\d|-\s*(?:通过|不通过)/u.test(normalized) && !/面试(?:评价|结果)/u.test(normalized)) return null;
  const nameMatch = normalized.match(/(?:^|\n)\s*\**\s*([\p{Script=Han}·]{2,12})\s*\**\s*(?:\n|颜值)/u);
  const name = safeName(nameMatch?.[1]);
  if (!name) return null;
  if (/不通过/u.test(normalized)) return {name,passed:false};
  if (/(?<!不)通过/u.test(normalized)) return {name,passed:true};
  return {name,passed:null};
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

export function parseEmploymentMessages(messages = [], {reviewerOpenId = RECRUITMENT_REVIEWER_OPEN_ID, reviewerName = '倪梦萍'} = {}) {
  const candidates = new Map();
  const sourceDates = [];
  const ordered = [...messages].sort((a, b) => String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')));
  for (const message of ordered) {
    const senderId = String(message?.sender?.id || '');
    const senderName = String(message?.sender?.name || '');
    if (senderId !== reviewerOpenId && senderName !== reviewerName) continue;
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
        stage:'hired',
        status:assessmentPassed ? '已入职 · 考核通过' : '已入职',
        note:assessmentPassed ? 'WIS直播战队日报已确认入职与考核通过。' : 'WIS直播战队日报已确认入职/到岗；考核结果待核验。',
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
  const sourceDates = [];
  const ordered = [...messages].sort((a, b) => String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')));
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
      submissionEvidence.set(name, {name, date, sourceId:message?.messageId || '', initialReview:reaction?.emoji || null});
      if (reaction?.emoji === 'OK') updateCandidate(candidates, {name, date, stage:'initial_pass', status:'初审通过', note:'倪梦萍在送审消息上标记 OK。', sourceId:message?.messageId});
      else if (reaction?.emoji === 'No') updateCandidate(candidates, {name, date, stage:'initial_fail', status:'初审不通过', note:'倪梦萍在送审消息上标记 No。', sourceId:message?.messageId});
      else updateCandidate(candidates, {name, date, stage:'unmapped', status:'初审结果待核验', note:'已找到送审记录，但未读到倪梦萍的 OK / No 表情证据。', sourceId:message?.messageId});
    }
    const senderId = String(message?.sender?.id || '');
    const senderName = String(message?.sender?.name || '');
    const isReviewer = senderId === reviewerOpenId;
    const evaluation = isReviewer ? interviewEvaluation(text) : null;
    if (evaluation) {
      evaluationEvidence.set(evaluation.name, {passed:evaluation.passed, date, sourceId:message?.messageId || ''});
      const stage = evaluation.passed === true ? 'interview_pass' : evaluation.passed === false ? 'interview_fail' : 'pending_feedback';
      const status = evaluation.passed === true ? '面试通过' : evaluation.passed === false ? '面试不通过' : '待面评';
      updateCandidate(candidates, {name:evaluation.name,date,stage,status,note:`招聘群已发布${status}结论。`,sourceId:message?.messageId});
      interviewEvents[date] = [...(interviewEvents[date] || []), {name:evaluation.name,status:stage,source:'面评群消息'}];
    }
    const offer = offerEvent(text, date);
    if (offer) {
      const hired = false; // A scheduled start date does not prove actual onboarding.
      updateCandidate(candidates, {name:offer.name,date,stage:hired?'hired':'interview_pass',status:hired?'已入职':'面试通过 · 待入职',note:`招聘群已确认接受 offer，预计入职日期 ${offer.startDate}，实际到岗待核验。`,startDate:offer.startDate,sourceId:message?.messageId});
    }
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

export function buildInterviewReminderPreview(snapshot, date) {
  const pending = (reason) => ({status:'pending',reason,date,matches:[],text:'',readyForSend:false});
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(String(date || ''))) return pending('面试日期无效');
  if (!String(snapshot?.calendarStatus || '').startsWith('已连接：')) return pending('正式面试日历尚未接入');
  if (snapshot?.coverage?.capped || !snapshot?.coverage?.chatMessages) return pending('招聘群证据不完整');
  const events = (snapshot?.interviewEvents?.[date] || []).filter(item => item?.status === 'calendar');
  if (!events.length) return pending('当天没有可核验的正式面试日程');
  const candidates = (snapshot?.candidates || []).filter(item => item?.inSubmissionCohort && item?.name);
  const matches = [];
  for (const event of events) {
    const names = candidates.filter(item => String(event.name || '').includes(item.name)).map(item => item.name);
    if (names.length !== 1) return pending('面试日程与候选人姓名无法一一核对');
    matches.push({name:names[0],eventId:event.eventId || ''});
  }
  const unique = [...new Set(matches.map(item => item.name))];
  return {
    status:'preview', date, matches, readyForSend:false,
    text:`【今日主播面试结果提醒｜${date}】\n今日面试候选人：${unique.join('、')}。\n请在面评群逐一确认“通过 / 未通过”，未取得明确结论的保留待核验。`,
    reason:'仅生成预览；须核对品牌营销部中枢机器人身份、收件人和实际发送回执后才能启用',
  };
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
  const merged = new Map(base.map(item => [item.name, {...item}]));
  for (const update of updates) {
    const existing = merged.get(update.name);
    const timeline = [...(existing?.timeline || [])];
    for (const item of update.timeline || []) if (!timeline.some(row => row[0] === item[0] && row[1] === item[1])) timeline.push(item);
    merged.set(update.name, {...(existing || {}), ...update, media:existing?.media || update.media, timeline});
  }
  return [...merged.values()];
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
