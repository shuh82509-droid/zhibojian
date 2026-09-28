import {createHash} from 'node:crypto';

export const reviewContentContractVersion = 'feishu-textonly-v1';
const MAX_TEXT = 8000;
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nameValid = value => typeof value === 'string' && /^[\p{Script=Han}·]{2,12}$/u.test(value)
  && !/^(候选人|求职者|初审通过|初审不通过|主播|是否符合|招聘端|面试通过)$/u.test(value);
const projectionHash = text => hash(`${reviewContentContractVersion}\n${text}`);

// Detection normalization only adds rejection evidence; it never repairs a slot.
function slotsForText(text) {
  const detection = text.normalize('NFKC').replace(/\p{Cf}/gu, '');
  const visibleSlotCount = [...detection.matchAll(/求\s*职\s*者/gu)].length;
  const markers = [...text.matchAll(/求职者/gu)];
  const names = [], spans = [];
  let parsedCompleteSlotCount = 0, validatedIdentitySlotCount = 0;
  const template = /^求职者\s*(?:【([^【】\r\n]*)】|\[([^\[\]\r\n]*)\]|([^\s，,。！？：:【】\[\]]+))\s*是否符合\s*(?:【主播】|\[主播\]|主播)\s*(?:的)?邀约标准/u;
  for (let index = 0; index < markers.length; index += 1) {
    const start = markers[index].index, boundary = markers[index + 1]?.index ?? text.length;
    const match = text.slice(start, boundary).match(template);
    const name = match ? (match[1] ?? match[2] ?? match[3]).trim() : '';
    const identityValid = Boolean(match && nameValid(name));
    if (match) parsedCompleteSlotCount += 1;
    if (identityValid) { validatedIdentitySlotCount += 1; names.push(name); }
    spans.push({start,end:match ? start + match[0].length : boundary,name:identityValid ? name : '',complete:Boolean(match),identityValid});
  }
  const complete = visibleSlotCount > 0 && visibleSlotCount === markers.length
    && visibleSlotCount === parsedCompleteSlotCount && visibleSlotCount === validatedIdentitySlotCount;
  return {status:visibleSlotCount === 0 ? 'none' : complete ? 'complete' : 'pending',
    reasonCode:visibleSlotCount === 0 ? 'no_submission_slots' : complete ? 'complete_submission_slots' : 'submission_slot_coverage_incomplete',
    names,visibleSlotCount,parsedCompleteSlotCount,validatedIdentitySlotCount,spans};
}

/** Pure projection: raw JSON bytes and full visible rows are hashed before limits. */
export function projectRecruitmentMessageContent(rawContent, msgType) {
  let parsed, parseError = typeof rawContent !== 'string';
  if (!parseError) { try { parsed = JSON.parse(rawContent); } catch { parseError = true; } }
  let contentShapeVerified = !parseError && record(parsed), unsupportedStyle = false;
  let hasMediaOrResource = false, resourceCount = 0;
  const resources = [];
  const resource = (type, key = '', name) => {
    hasMediaOrResource = true; resourceCount += 1;
    if (resources.length < 20) resources.push({type,key,...(name === undefined ? {} : {name})});
  };
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const resourceKeys = Object.keys(value).filter(key => /(?:image|file|media|video|audio|sticker|resource|attachment)_key$/iu.test(key));
    if (Object.hasOwn(value,'tag') && !['text','plain_text'].includes(value.tag)) {
      hasMediaOrResource = true;
      if (!resourceKeys.length) resource(String(value.tag || 'unknown'));
    }
    if (Object.hasOwn(value,'style') && (!Array.isArray(value.style)
      || value.style.some(style => style !== 'bold'))) unsupportedStyle = true;
    for (const [key, child] of Object.entries(value)) {
      if (resourceKeys.includes(key)) resource(key.replace(/_key$/iu,''),typeof child === 'string' ? child : '',
        key==='file_key' ? (typeof value.file_name === 'string' ? value.file_name : '') : undefined);
      visit(child);
    }
  };
  visit(parsed);
  let fullText = '';
  if (msgType === 'text') {
    contentShapeVerified = contentShapeVerified && Object.keys(parsed).length === 1 && typeof parsed.text === 'string';
    if (typeof parsed?.text === 'string') fullText = parsed.text;
  } else if (msgType === 'post') {
    let block = parsed;
    if (record(parsed)) {
      const keys = Object.keys(parsed);
      if (keys.length === 1 && /^(?:zh_cn|zh-CN|en_us|en-US)$/u.test(keys[0])) block = parsed[keys[0]];
    }
    contentShapeVerified = contentShapeVerified && record(block)
      && Object.keys(block).every(key => ['title','content'].includes(key))
      && (block.title === undefined || typeof block.title === 'string') && Array.isArray(block.content);
    if (record(block)) {
      const lines = typeof block.title === 'string' && block.title.length ? [block.title] : [];
      if (Array.isArray(block.content)) for (const row of block.content) {
        if (!Array.isArray(row)) { contentShapeVerified = false; continue; }
        let line = '';
        for (const node of row) {
          const valid = record(node) && ['text','plain_text'].includes(node.tag) && typeof node.text === 'string'
            && Object.keys(node).every(key => ['tag','text','style'].includes(key))
            && (node.style === undefined || (Array.isArray(node.style) && node.style.every(style => style === 'bold')));
          if (!valid) contentShapeVerified = false;
          if (typeof node?.text === 'string') line += node.text;
        }
        lines.push(line);
      }
      fullText = lines.join('\n');
    }
  } else { contentShapeVerified = false; resource(String(msgType || 'unknown_type')); }
  const truncated = fullText.length > MAX_TEXT;
  return {reviewContentContractVersion,parseError,contentShapeVerified,
    reviewText:fullText.slice(0,MAX_TEXT),text:fullText.slice(0,MAX_TEXT),
    reviewTextTruncated:truncated,textTruncated:truncated,fullProjectionLength:fullText.length,
    hasMediaOrResource,resourceCount,resources,unsupportedStyle,
    contentFingerprint:typeof rawContent === 'string' ? hash(rawContent) : '',
    reviewTextFingerprint:projectionHash(fullText),submissionSlotCoverage:slotsForText(fullText)};
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,19) === value.slice(0,19);
}

/** Complete-source qualification only, never evidence of a business binding. */
export function inspectRecruitmentContent(message) {
  const pending = reasonCode => ({status:'pending',reasonCode,text:''});
  if (!record(message) || message.reviewContentContractVersion !== reviewContentContractVersion
    || message.parseError !== false || message.contentShapeVerified !== true
    || message.reviewTextTruncated !== false || message.textTruncated !== false
    || typeof message.reviewText !== 'string' || !message.reviewText.trim() || message.text !== message.reviewText
    || message.reviewText.length > MAX_TEXT || message.fullProjectionLength !== message.reviewText.length
    || !/^[a-f0-9]{64}$/u.test(message.contentFingerprint || '')
    || message.reviewTextFingerprint !== projectionHash(message.reviewText)) return pending('source_unverified');
  if (message.hasMediaOrResource !== false || message.unsupportedStyle !== false
    || message.resourceCount !== 0 || !Array.isArray(message.resources) || message.resources.length !== 0) return pending('unsupported_visible_semantics');
  if (!['text','post'].includes(message.type) || typeof message.messageId !== 'string' || !message.messageId.trim()
    || typeof message.chatId !== 'string' || !message.chatId.trim()
    || typeof message.sender?.id !== 'string' || !message.sender.id.trim()
    || !validTimestamp(message.createdAt) || !validTimestamp(message.updatedAt)
    || new Date(message.updatedAt).getTime() < new Date(message.createdAt).getTime()
    || message.deleted === true || message.isDeleted === true || message.recalled === true) return pending('source_identity_unverified');
  return {status:'text_ready',reasonCode:'complete_text_projection',text:message.reviewText};
}

export function inspectSubmissionSlots(message) {
  const content = inspectRecruitmentContent(message);
  const slots = slotsForText(typeof message?.reviewText === 'string' ? message.reviewText : '');
  if (content.status !== 'text_ready') {
    // The projector retains counts/names/spans from the full body, not raw text.
    const observed = record(message?.submissionSlotCoverage) ? message.submissionSlotCoverage : slots;
    return {...slots,names:Array.isArray(observed.names) ? observed.names.filter(nameValid) : slots.names,
      visibleSlotCount:Number.isInteger(observed.visibleSlotCount) && observed.visibleSlotCount >= slots.visibleSlotCount ? observed.visibleSlotCount : slots.visibleSlotCount,
      parsedCompleteSlotCount:Number.isInteger(observed.parsedCompleteSlotCount) ? observed.parsedCompleteSlotCount : slots.parsedCompleteSlotCount,
      validatedIdentitySlotCount:Number.isInteger(observed.validatedIdentitySlotCount) ? observed.validatedIdentitySlotCount : slots.validatedIdentitySlotCount,
      spans:Array.isArray(observed.spans) ? observed.spans : slots.spans,status:'pending',reasonCode:content.reasonCode};
  }
  return slots;
}

export function inspectReviewText(message, expectedName) {
  const result = {status:'pending',reasonCode:'source_unverified',passed:null,scores:null,
    sourceIds:typeof message?.messageId === 'string' && message.messageId ? [message.messageId] : [],
    contentFingerprint:message?.contentFingerprint || '',reviewTextFingerprint:message?.reviewTextFingerprint || ''};
  const pending = reasonCode => ({...result,reasonCode});
  const content = inspectRecruitmentContent(message);
  if (content.status !== 'text_ready') return pending(content.reasonCode);
  if (message.type !== 'post') return pending('review_requires_post');
  if (!nameValid(expectedName)) return pending('expected_identity_unverified');
  if (slotsForText(content.text).status !== 'none') return pending('unknown_extra_content');
  const lines = content.text.split(/\r\n|\n|\r/u).map(line => line.trim());
  if (lines[0] === '面试结果' || lines[0] === '面试评价') lines.shift();
  if (lines[0] !== expectedName) return pending('review_name_mismatch');
  lines.shift();
  if (lines.length < 2 || lines.some(line => !line)) return pending('incomplete_or_multiple_structure');
  const outcome = lines.at(-1).match(/^结果\s*[:：]\s*(通过|不通过|未通过)$/u);
  if (!outcome) return pending(/通过|淘汰|暂缓|另议/u.test(lines.at(-1)) ? 'ambiguous_outcome' : 'incomplete_or_multiple_structure');
  lines.pop();
  const number = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
  const field = new RegExp(`^(颜值|表现力)\\s*[:：]?\\s*(${number})(?=$|[\\s,，])`,'u');
  const scores = {};
  for (const line of lines) {
    let remaining = line;
    while (remaining) {
      const match = remaining.match(field);
      if (!match) return pending(/^(?:颜值|表现力|结果)/u.test(remaining) ? 'incomplete_or_multiple_structure' : 'unknown_extra_content');
      if (Object.hasOwn(scores,match[1])) return pending('incomplete_or_multiple_structure');
      const value = Number(match[2]);
      if (!Number.isFinite(value)) return pending('incomplete_or_multiple_structure');
      scores[match[1]] = value;
      const rest = remaining.slice(match[0].length);
      if (rest && !/^[\s,，]+\S/u.test(rest)) return pending('incomplete_or_multiple_structure');
      remaining = rest.replace(/^[\s,，]+/u,'');
    }
  }
  if (Object.keys(scores).length !== 2) return pending('incomplete_or_multiple_structure');
  return {...result,status:'text_ready',reasonCode:'explicit_single_review_syntax',passed:outcome[1] === '通过',scores};
}
