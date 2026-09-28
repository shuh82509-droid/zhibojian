/**
 * Native Calendar source collector draft. This is a private read contract, NOT
 * OAuth authentication, ownership evidence, a reminder permit, or C1 V1 input.
 * The server must supply its approved calendar list and its authorized reader.
 * Raw native data remains in this invocation's memory; never serialize it to
 * HTTP, shared caches, logs, or lifecycle snapshots. No token/refresh/send I/O.
 */
import {createHash} from 'node:crypto';

export const nativeCalendarSourceVersion = 'wis-native-calendar-source-v1';
const CALENDAR_ID = /^[A-Za-z0-9_@.\-]{3,256}$/u;
const EVENT_ID = /^[A-Za-z0-9_@.\-]{1,256}$/u;
const OPEN_ID = /^ou_[A-Za-z0-9_]+$/u;
const MAX_RAW_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_PAGES = 200, MAX_EVENTS = 20000, MAX_DURATION = 120000;
const object = value => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const dataObject = value => object(value) && Object.values(Object.getOwnPropertyDescriptors(value))
  .every(descriptor => Object.hasOwn(descriptor,'value'));
const lexical = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const sha = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort(lexical)
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  if (value === null || ['string','boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value,-0)) return JSON.stringify(value);
  throw new Error('native_value_unverified');
}
const token = value => typeof value === 'string' && value.length <= 8192
  && !/[\p{Cc}\p{Cf}]/u.test(value);
function seconds(value) {
  return typeof value === 'string' && /^[1-9]\d{0,9}$/u.test(value)
    && Number.isSafeInteger(Number(value)) && Number(value) < 4102444800;
}
function approved(ids, calendarId) {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= 16
    && Array.from({length:ids.length},(_,index) => Object.hasOwn(ids,index)).every(Boolean)
    && ids.every(id => typeof id === 'string' && CALENDAR_ID.test(id))
    && new Set(ids).size === ids.length && ids.includes(calendarId);
}

/** A pure query builder. A caller-supplied list is not itself authorization. */
export function buildNativeCalendarRequest(request, approvedCalendarIds) {
  const deny = () => { throw Object.assign(new Error('原生日历只读请求不符合固定来源契约。'), {code:'calendar_native_query_denied'}); };
  if (!dataObject(request) || !Object.hasOwn(request,'kind') || !Object.hasOwn(request,'calendarId')
    || typeof request.calendarId !== 'string'
    || !CALENDAR_ID.test(request.calendarId) || !approved(approvedCalendarIds, request.calendarId)) deny();
  const allowed = request.kind === 'metadata' ? ['kind','calendarId']
    : request.kind === 'anchor_page' ? ['kind','calendarId','anchorSeconds','pageSize','pageToken'] : [];
  if (!allowed.length || Reflect.ownKeys(request).some(key => !allowed.includes(key))) deny();
  const url = new URL(`https://open.feishu.cn/open-apis/calendar/v4/calendars/${encodeURIComponent(request.calendarId)}`);
  if (request.kind === 'metadata') return url.href;
  if (!seconds(request.anchorSeconds)) deny();
  const pageSize = Object.hasOwn(request,'pageSize') ? request.pageSize : 500;
  const pageToken = Object.hasOwn(request,'pageToken') ? request.pageToken : '';
  if (!Number.isSafeInteger(pageSize) || pageSize < 50 || pageSize > 1000 || !token(pageToken)) deny();
  url.pathname += '/events';
  url.searchParams.set('anchor_time', request.anchorSeconds);
  url.searchParams.set('page_size', String(pageSize));
  url.searchParams.set('user_id_type', 'open_id');
  if (pageToken !== '') url.searchParams.set('page_token', pageToken);
  return url.href;
}

/** Reject ambiguous JSON before JSON.parse can take the last duplicate key. */
export function decodeNativeCalendarEnvelope(raw) {
  const pending = reasonCode => ({ok:false, reasonCode});
  if (typeof raw !== 'string' || raw.length === 0 || Buffer.byteLength(raw,'utf8') > MAX_RAW_BYTES)
    return pending('native_raw_size_unverified');
  try {
    let offset = 0;
    const white = () => { while (offset < raw.length && /[\x20\t\r\n]/u.test(raw[offset])) offset++; };
    const string = () => {
      if (raw[offset] !== '"') throw new Error('native_json_invalid');
      const start = offset++;
      while (offset < raw.length) {
        const char = raw[offset++];
        if (char === '\\') { offset++; continue; }
        if (char === '"') return JSON.parse(raw.slice(start, offset));
      }
      throw new Error('native_json_invalid');
    };
    function scan(depth = 0) {
      if (depth > 64) throw new Error('native_json_depth_unverified');
      white(); const char = raw[offset];
      if (char === '"') { string(); return; }
      if (char === '{') {
        offset++; white(); const keys = new Set();
        if (raw[offset] === '}') { offset++; return; }
        for (;;) {
          white(); const key = string();
          if (keys.has(key)) throw new Error('native_json_duplicate_key');
          keys.add(key); white(); if (raw[offset++] !== ':') throw new Error('native_json_invalid');
          scan(depth + 1); white(); const next = raw[offset++];
          if (next === '}') return;
          if (next !== ',') throw new Error('native_json_invalid');
        }
      }
      if (char === '[') {
        offset++; white(); if (raw[offset] === ']') { offset++; return; }
        for (;;) {
          scan(depth + 1); white(); const next = raw[offset++];
          if (next === ']') return;
          if (next !== ',') throw new Error('native_json_invalid');
        }
      }
      const match = raw.slice(offset).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u);
      if (!match) throw new Error('native_json_invalid');
      if (/^[-0-9]/u.test(match[0])) {
        const number = Number(match[0]);
        if (!Number.isFinite(number)) throw new Error('native_value_unverified');
        // JSON.parse silently rounds large integers and long fractional values.
        // Unknown native fields cannot be CAS evidence after lossy decoding.
        // Do not guess decimal precision or silently normalize such values.
        if (!/^-?(?:0|[1-9]\d*)$/u.test(match[0]) || !Number.isSafeInteger(number) || Object.is(number,-0))
          throw new Error('native_numeric_precision_unverified');
      }
      offset += match[0].length;
    }
    scan(); white(); if (offset !== raw.length) throw new Error('native_json_invalid');
    const envelope = JSON.parse(raw);
    if (!object(envelope) || envelope.code !== 0 || !object(envelope.data))
      return pending('native_response_unverified');
    // Canonicalization also rejects non-finite JSON numbers (for example 1e999).
    const nativeDataHash = sha(canonical(envelope.data));
    return {ok:true, data:envelope.data, rawHash:sha(raw), nativeDataHash};
  } catch (cause) {
    const safe = ['native_json_depth_unverified','native_json_duplicate_key','native_json_invalid','native_value_unverified','native_numeric_precision_unverified'];
    return pending(safe.includes(cause?.message) ? cause.message : 'native_json_invalid');
  }
}

function sourcePending(reasonCode, observedPages = 0, observedEvents = 0) {
  return {contractVersion:nativeCalendarSourceVersion, status:'pending', reasonCode,
    readyForReminder:false, formalScheduleBindingStatus:'pending', reviewOutcome:null,
    businessPassed:null, ownerOpenId:null, ownerIdentityStatus:'not_exposed_by_calendar_get',
    observedPages, observedEvents};
}
function inspectMetadata(decoded, calendarId) {
  if (!decoded.ok) return decoded.reasonCode;
  const data = decoded.data;
  if (data.calendar_id !== calendarId) return 'native_calendar_id_mismatch';
  if (!['primary','shared','resource'].includes(data.type)) return 'native_calendar_type_unverified';
  if (!['reader','writer','owner'].includes(data.role)) return 'native_calendar_details_unavailable';
  if (data.is_deleted !== false || data.is_third_party !== false) return 'native_calendar_liveness_unverified';
  return null;
}

/**
 * readNative(request) must be a private approved reader returning the original
 * API JSON STRING, not an HTTP request body or a historical snapshot. This
 * function cannot authenticate that dependency; even read_complete is NOT a
 * permission or reminder/business decision. It reads every page after anchor,
 * including cancelled/recurring/out-of-window events, with no time early-stop.
 */
export async function collectNativeCalendarSource({calendarId, approvedCalendarIds, readerOpenId,
  anchorSeconds, readNative, now = Date.now, pageSize = 500, maxPages = MAX_PAGES,
  maxEvents = MAX_EVENTS, maxDurationMs = MAX_DURATION}) {
  let pageCount = 0, eventCount = 0, totalBytes = 0;
  const fail = code => sourcePending(code, pageCount, eventCount);
  if (typeof readNative !== 'function' || typeof now !== 'function' || typeof readerOpenId !== 'string' || !OPEN_ID.test(readerOpenId)
    || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES
    || !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_EVENTS
    || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > MAX_DURATION)
    return fail('native_collector_context_unverified');
  let startedAt, lastAt;
  function clock() {
    const value = now();
    if (!Number.isSafeInteger(value) || value <= 0 || value >= 4102444800000)
      throw new Error('native_clock_unverified');
    if (lastAt !== undefined && value < lastAt) throw new Error('native_clock_regressed');
    if (startedAt !== undefined && value - startedAt > maxDurationMs) throw new Error('native_read_timeout');
    lastAt = value;
    return value;
  }
  async function observe(request) {
    buildNativeCalendarRequest(request, approvedCalendarIds);
    clock();
    const remaining = maxDurationMs - (lastAt - startedAt);
    if (remaining <= 0) throw new Error('native_read_timeout');
    const controller = new AbortController();
    let timer;
    const expiration = new Promise((_,reject) => {
      timer = setTimeout(() => {
        controller.abort(); reject(new Error('native_read_timeout'));
      }, remaining);
    });
    let raw;
    try {
      raw = await Promise.race([Promise.resolve().then(() => readNative(Object.freeze({...request}),
        {signal:controller.signal})),expiration]);
    } finally { clearTimeout(timer); }
    clock();
    if (typeof raw === 'string') totalBytes += Buffer.byteLength(raw,'utf8');
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('native_total_bytes_exceeded');
    return decodeNativeCalendarEnvelope(raw);
  }
  try {
    buildNativeCalendarRequest({kind:'anchor_page',calendarId,anchorSeconds,pageSize}, approvedCalendarIds);
    startedAt = clock();
    const before = await observe({kind:'metadata',calendarId});
    const metadataProblem = inspectMetadata(before, calendarId);
    if (metadataProblem) return fail(metadataProblem);
    const pages = [], events = [], seenTokens = new Set(), seenEvents = new Set();
    let requestToken = '';
    for (;;) {
      if (pageCount >= maxPages) return fail('native_page_cap_exceeded');
      const request = {kind:'anchor_page', calendarId, anchorSeconds, pageSize, pageToken:requestToken};
      const response = await observe(request);
      pageCount++;
      if (!response.ok) return fail(response.reasonCode);
      const data = response.data;
      if (typeof data.has_more !== 'boolean' || !Array.isArray(data.items))
        return fail('native_page_schema_unverified');
      if (data.items.length > pageSize) return fail('native_page_size_exceeded');
      if (Object.hasOwn(data,'sync_token') && !token(data.sync_token)) return fail('native_sync_token_unverified');
      const hasNextToken = Object.hasOwn(data,'page_token');
      const nextToken = hasNextToken ? data.page_token : undefined;
      if (data.has_more) {
        if (!token(nextToken) || nextToken === '' || nextToken === requestToken || seenTokens.has(nextToken))
          return fail('native_cursor_unverified');
      } else if (hasNextToken && (!token(nextToken) || nextToken !== '')) {
        // Official field text and example disagree on this shape. Do not use
        // that conflict as proof of complete source; leave the lane pending.
        return fail('native_terminal_cursor_conflict');
      }
      for (const event of data.items) {
        if (!object(event) || typeof event.event_id !== 'string' || !EVENT_ID.test(event.event_id))
          return fail('native_event_identity_unverified');
        if (seenEvents.has(event.event_id)) return fail('native_event_id_duplicate');
        seenEvents.add(event.event_id); eventCount++;
        if (eventCount > maxEvents) return fail('native_event_cap_exceeded');
        events.push(event); // No summary truncation, status filter, or dedupe.
      }
      pages.push({request:{...request}, nativeData:data, nativeDataHash:response.nativeDataHash,
        rawHash:response.rawHash});
      if (!data.has_more) break;
      seenTokens.add(nextToken); requestToken = nextToken;
    }
    const after = await observe({kind:'metadata', calendarId});
    const finalProblem = inspectMetadata(after, calendarId);
    if (finalProblem) return fail(finalProblem);
    if (before.nativeDataHash !== after.nativeDataHash) return fail('native_calendar_metadata_drift');
    const completedAt = clock();
    const semantic = {contractVersion:nativeCalendarSourceVersion,calendarId,readerOpenId,anchorSeconds,
      metadata:before.data,events:[...events].sort((a,b) => lexical(a.event_id,b.event_id))};
    const transport = {metadataBefore:before.data,metadataAfter:after.data,
      pages:pages.map(page => ({request:page.request,nativeData:page.nativeData}))};
    return {contractVersion:nativeCalendarSourceVersion,status:'read_complete',reasonCode:null,
      readyForReminder:false,formalScheduleBindingStatus:'pending',reviewOutcome:null,businessPassed:null,
      ownerOpenId:null,ownerIdentityStatus:'not_exposed_by_calendar_get',readerIdentityStatus:'dependency_not_authenticated_by_collector',
      sourceFingerprint:sha(canonical(semantic)),transportFingerprint:sha(canonical(transport)),
      metadataRawHashes:{before:before.rawHash,after:after.rawHash},metadata:before.data,pages,events,
      observedPages:pageCount,observedEvents:eventCount,observedBytes:totalBytes,
      readStartedAt:new Date(startedAt).toISOString(),readCompletedAt:new Date(completedAt).toISOString(),
      fieldEvidence:{ownerOpenId:'not_exposed',eventUpdateTime:'not_exposed',eventDeleted:'not_exposed'}};
  } catch (cause) {
    const safe = ['native_clock_unverified','native_clock_regressed','native_read_timeout','native_total_bytes_exceeded'];
    return fail(cause?.code === 'calendar_native_query_denied' ? 'native_query_denied'
      : safe.includes(cause?.message) ? cause.message : 'native_read_failed');
  }
}
