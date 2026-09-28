// Independent synthetic attacks; no production credential, API, or user action.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {createCipheriv, createHash} from 'node:crypto';
import {join, resolve, dirname, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

globalThis.fetch = async () => { throw new Error('independent synthetic test refuses network'); };
const modulePath = process.env.WIS_NATIVE_READER_MODULE || 'H:/codex输出/直播五环节工作流-20260923/calendar-native-reader-exact-20260928/candidate-2235/calendar-user-reader.mjs';
const expectedReader = process.env.WIS_NATIVE_READER_SHA || '6d287f278f0154c56c0da36aa08f93799c948acd2578cbb6e8aa1103cdc23255';
const nativePath = join(dirname(modulePath), 'native-calendar-source.mjs');
const expectedNative = process.env.WIS_NATIVE_SOURCE_SHA || 'ef2bf28096e2bc503c7aa07776c19e8734904839ad84a804872abb1f571a57cd';
const sha = value => createHash('sha256').update(value).digest('hex');
const source = await fs.readFile(modulePath, 'utf8');
assert.equal(sha(source), expectedReader, 'selected reader source must match exact pin before import');
assert.equal(sha(await fs.readFile(nativePath)), expectedNative, 'native module must match exact pin before import');
const {createCalendarUserReader} = await import(pathToFileURL(modulePath));
const {buildNativeCalendarRequest, collectNativeCalendarSource, decodeNativeCalendarEnvelope} = await import(pathToFileURL(nativePath));

const NOW = Date.UTC(2026, 8, 28, 13, 20), OWNER = 'ou_independent_native_owner', CAL = 'synthetic-calendar-independent';
const SECOND = 'synthetic-secondary-independent', APP = 'synthetic-reader-app';
const KEY = Buffer.alloc(32, 73), ACCESS = 'SYNTHETIC_ACCESS_PRIVATE', REFRESH = 'SYNTHETIC_REFRESH_PRIVATE';
const SCOPE = 'calendar:calendar:read calendar:calendar.event:read offline_access';
const metadata = () => ({calendar_id:CAL, type:'shared', role:'reader', is_deleted:false, is_third_party:false});
const rawEnvelope = data => JSON.stringify({code:0, data});
const stored = extra => ({openId:OWNER, accessToken:ACCESS, refreshToken:REFRESH,
  accessExpiresAt:NOW + 3_600_000, refreshExpiresAt:NOW + 86_400_000, scopes:SCOPE, ...extra});
function encrypted(record) {
  const iv = Buffer.alloc(12, 53), cipher = createCipheriv('aes-256-gcm', KEY, iv);
  cipher.setAAD(Buffer.from(JSON.stringify([APP, CAL, OWNER])));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record),'utf8'), cipher.final()]);
  return JSON.stringify({version:2, iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), ciphertext:ciphertext.toString('base64')});
}
const textResponse = (text, status = 200) => ({ok:status >= 200 && status < 300, status, text:async () => text});
const streamed = chunks => ({ok:true, body:new ReadableStream({start(c) {for (const chunk of chunks) c.enqueue(chunk); c.close();}})});
const refreshGrant = () => ({code:0, access_token:'SYNTHETIC_ROTATED_ACCESS', refresh_token:'SYNTHETIC_ROTATED_REFRESH',
  expires_in:3600, refresh_token_expires_in:86400, scope:SCOPE});
async function fixture(t, {record = stored(), settings = {}, fetcher = async () => textResponse(rawEnvelope(metadata()))} = {}) {
  const root = resolve(await fs.mkdtemp(join(tmpdir(),'wis-native-independent-'))), storePath = join(root,'grant.enc');
  t.after(async () => {
    assert.ok(root.startsWith(resolve(tmpdir()) + sep + 'wis-native-independent-'), 'only own fixture temp tree may be removed');
    await fs.rm(root, {recursive:true, force:true});
  });
  await fs.writeFile(storePath, encrypted(record), {mode:0o600});
  const calls = [], diagnostics = [];
  const config = {appId:APP, appSecret:'SYNTHETIC_APP_SECRET_PRIVATE', calendarId:CAL, expectedOpenId:OWNER,
    storePath, encryptionKey:KEY.toString('base64'), redirectUri:'https://synthetic.invalid/oauth-callback',
    allowNativeSource:true, now:() => NOW, diagnostic:item => diagnostics.push(item), ...settings,
    fetchImpl:async (url, options = {}) => {
      calls.push({url:String(url), options});
      return fetcher(String(url), options, {root, storePath, calls, diagnostics});
    }};
  return {root, storePath, calls, diagnostics, reader:createCalendarUserReader(config), restart:() => createCalendarUserReader(config)};
}
const request = () => ({kind:'metadata', calendarId:CAL});
const absent = async path => assert.rejects(fs.stat(path), {code:'ENOENT'});
async function rejected(promise, codes) {
  let cause;
  try { await promise; } catch (error) { cause = error; }
  assert.ok(cause, 'unsafe synthetic input must be rejected');
  if (codes) assert.ok(codes.includes(cause.code), `unexpected sanitized code ${cause.code}`);
  assert.doesNotMatch(JSON.stringify({code:cause.code,message:cause.message}), /SYNTHETIC_(?:APP_SECRET|ACCESS|REFRESH|ROTATED)|PRIVATE_BODY/);
  return cause;
}

test('exact variant and native contract are pinned before module import', () => {
  assert.equal(sha(source), expectedReader);
  assert.equal(Object.hasOwn(createCalendarUserReader,'getNative'), false);
});
test('only four scoped native changes; existing refresh/PKCE/scopes/API bytes stay frozen', () => {
  let normalized = source.replace("import {buildNativeCalendarRequest} from './native-calendar-source.mjs';\n", '');
  normalized = normalized.replace('allowInstanceView = false, allowNativeSource = false, redirectUri', 'allowInstanceView = false, redirectUri');
  const start = normalized.indexOf('  // Private, opt-in native source reads.');
  const end = normalized.indexOf('  async function verifyCalendar(targetCalendarId)', start);
  assert.ok(start > 0 && end > start);
  normalized = normalized.slice(0,start) + normalized.slice(end);
  normalized = normalized.replace('  return {calendarId, status, begin, complete, get, verifyCalendar,\n    ...(allowNativeSource === true ? {getNative} : {})};',
    '  return {calendarId, status, begin, complete, get, verifyCalendar};');
  assert.equal(sha(normalized), '173e639ee6719c00871b2606fe9661b9587a4a2a25222981882c3d3f4b1fd257');
});
for (const optIn of [undefined, false, 'true', 1, {}]) test('default API never grows for non-boolean opt-in ' + String(optIn), async t => {
  const f = await fixture(t, {settings:{allowNativeSource:optIn}});
  assert.deepEqual(Object.keys(f.reader), ['calendarId','status','begin','complete','get','verifyCalendar']);
  assert.equal(f.calls.length, 0);
});
test('structured approved metadata uses fixed GET, fixed host, bearer, and live exclusive lock', async t => {
  const raw = ' { "code":0, "data":' + JSON.stringify(metadata()) + ' } ';
  const f = await fixture(t, {fetcher:async (url, options, context) => {
    assert.equal(url, 'https://open.feishu.cn/open-apis/calendar/v4/calendars/' + CAL);
    assert.equal(options.method,'GET'); assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + ACCESS);
    assert.equal((await fs.stat(context.storePath + '.lock')).isDirectory(),true);
    assert.equal(options.signal.aborted,false); return textResponse(raw);
  }});
  assert.equal(await f.reader.getNative(request()), raw);
  await absent(f.storePath + '.lock');
});
for (const alteration of [
  {calendarId:'https://example.invalid'}, {calendarId:SECOND}, {kind:'instance_view'},
  {kind:'primary'}, {path:'/im/v1/messages'}, {method:'POST'}, {host:'https://example.invalid'},
  {expectedOpenId:'ou_unapproved'}, {allowlist:[SECOND]}, {pageToken:'opaque'},
  {start_time:'123'}, {end_time:'456'}, {token:'PRIVATE_BODY'}
]) test('native structured request cannot provide another source/operation ' + JSON.stringify(alteration), async t => {
  const f = await fixture(t, {record:stored({accessExpiresAt:NOW-1})});
  await rejected(f.reader.getNative({...request(), ...alteration}), ['calendar_native_query_denied']);
  assert.equal(f.calls.length,0); await absent(f.storePath + '.lock');
});
test('non-plain data, accessors, and hidden source fields are rejected before I/O', async t => {
  const f = await fixture(t); let reads = 0;
  const accessor = {kind:'metadata', get calendarId() { reads++; return CAL; }};
  const hidden = request(); Object.defineProperty(hidden, Symbol('host'), {value:'https://example.invalid'});
  for (const value of [null, [], Object.create(request()), accessor, hidden])
    await rejected(f.reader.getNative(value), ['calendar_native_query_denied']);
  assert.equal(reads,0); assert.equal(f.calls.length,0);
});
test('anchor pagination token is escaped as an opaque query; old get cannot borrow native params', async t => {
  const pageToken = 'opaque/&=?+#中文', f = await fixture(t);
  await f.reader.getNative({kind:'anchor_page',calendarId:CAL,anchorSeconds:String(NOW/1000),pageSize:73,pageToken});
  const url = new URL(f.calls[0].url);
  assert.equal(url.origin,'https://open.feishu.cn'); assert.equal(url.searchParams.get('page_token'), pageToken);
  assert.equal(url.searchParams.get('user_id_type'),'open_id'); assert.equal(url.searchParams.get('start_time'),null);
  await rejected(f.reader.get('/calendar/v4/calendars/' + CAL + '/events?anchor_time=1'), ['calendar_path_denied']);
  assert.equal(f.calls.length,1);
});
test('approved secondary calendar is allowed only in shared mode, never own-primary mode', async t => {
  const shared = await fixture(t, {settings:{additionalCalendarIds:[SECOND]}});
  await shared.reader.getNative({kind:'metadata',calendarId:SECOND});
  assert.equal(new URL(shared.calls[0].url).pathname.endsWith('/'+SECOND),true);
  const own = await fixture(t, {settings:{additionalCalendarIds:[SECOND],requireOwnPrimaryCalendar:true}});
  await rejected(own.reader.getNative({kind:'metadata',calendarId:SECOND}),['calendar_native_query_denied']);
  assert.equal(own.calls.length,0);
});
test('aborted or malformed options cannot begin token refresh', async t => {
  const f = await fixture(t, {record:stored({accessExpiresAt:NOW-1})});
  const controller = new AbortController(); controller.abort();
  for (const options of [null, [], {signal:{}}, {signal:controller.signal}, {method:'POST'}])
    await rejected(f.reader.getNative(request(),options));
  assert.equal(f.calls.length,0);
});
test('durable hold and orphan lock block native, legacy, verify and cached fastpaths across instances', async t => {
  for (const anchor of ['hold','lock']) {
    const f = await fixture(t);
    if (anchor === 'hold') await fs.writeFile(f.storePath+'.refresh-hold.json','{"malformed":true}');
    else await fs.mkdir(f.storePath+'.lock');
    for (const reader of [f.reader, f.restart()]) {
      await rejected(reader.getNative(request()));
      await rejected(reader.get('/calendar/v4/calendars/'+CAL+'/events'));
      await rejected(reader.verifyCalendar(CAL)); assert.equal((await reader.status()).authorized,false);
    }
    assert.equal(f.calls.length,0);
  }
});
test('one-use unknown native refresh keeps quarantine; native is not an alternate token path', async t => {
  let rotations = 0;
  const f = await fixture(t, {record:stored({accessExpiresAt:NOW-1}), fetcher:async (url) => {
    assert.equal(url,'https://accounts.feishu.cn/oauth/v3/token'); rotations++; throw Error('PRIVATE_BODY');
  }});
  await rejected(f.reader.getNative(request()), ['calendar_refresh_recovery_required']);
  for (const reader of [f.reader,f.restart()]) await rejected(reader.getNative(request()));
  assert.equal(rotations,1); assert.equal(f.calls.length,1);
});
test('ordinary native read failure never consumes or permanently quarantines a healthy grant', async t => {
  let fail = true;
  const f = await fixture(t, {fetcher:async () => {
    if (fail) throw Error('PRIVATE_BODY'); return textResponse(rawEnvelope(metadata()));
  }});
  await rejected(f.reader.getNative(request()), ['calendar_native_read_failed']);
  assert.equal((await f.reader.status()).authorized,true);
  await absent(f.storePath+'.refresh-hold.json'); await absent(f.storePath+'.lock');
  fail = false; assert.equal(await f.reader.getNative(request()),rawEnvelope(metadata()));
});
test('native and legacy concurrent readers share one lock and at most one rotation', async t => {
  let release, enteredResolve, posts = 0;
  const entered = new Promise(resolve => {enteredResolve = resolve;});
  const f = await fixture(t, {record:stored({accessExpiresAt:NOW-1}),fetcher:async (url) => {
    if (url === 'https://accounts.feishu.cn/oauth/v3/token') {posts++; return {ok:true,json:async () => refreshGrant()};}
    enteredResolve(); await new Promise(resolve => {release=resolve;}); return textResponse(rawEnvelope(metadata()));
  }});
  const active = f.reader.getNative(request()); await entered;
  await rejected(f.restart().getNative(request()), ['calendar_authorization_busy']);
  await rejected(f.reader.get('/calendar/v4/calendars/'+CAL+'/events'), ['calendar_authorization_busy']);
  assert.equal((await f.reader.status()).authorized,false); assert.equal(posts,1);
  release(); await active; assert.equal((await f.reader.status()).authorized,true);
});
test('streamed UTF-8 split in the middle of Han bytes preserves complete raw body', async t => {
  const raw = rawEnvelope({...metadata(),summary:'合成边界🙂'}), bytes = Buffer.from(raw);
  const split = bytes.indexOf(Buffer.from('合')) + 1;
  const f = await fixture(t, {fetcher:async () => streamed([bytes.subarray(0,split),bytes.subarray(split)])});
  assert.equal(await f.reader.getNative(request()),raw);
});
for (const bytes of [[0xff],[0xe4,0xb8],[0xc0,0xaf],[0xed,0xa0,0x80]])
test('invalid UTF-8 is never substituted into a ready native raw body '+bytes.join(','), async t => {
  const f = await fixture(t, {fetcher:async () => streamed([new Uint8Array(bytes)])});
  await rejected(f.reader.getNative(request()),['calendar_native_read_failed']);
  assert.equal((await f.reader.status()).authorized,true); await absent(f.storePath+'.lock');
});
for (const invalid of ['', 'x'.repeat(8*1024*1024+1), '汉'.repeat(3*1024*1024)])
test('fallback response is bounded in bytes and never truncated '+Buffer.byteLength(invalid), async t => {
  const f = await fixture(t, {fetcher:async () => textResponse(invalid)});
  await rejected(f.reader.getNative(request()),['calendar_native_read_failed']);
  assert.equal((await f.reader.status()).authorized,true);
});
test('oversized stream is cancelled, released and never leaves a refresh hold', async t => {
  let cancelled = 0;
  const f = await fixture(t, {fetcher:async () => ({ok:true,body:new ReadableStream({
    start(controller) {controller.enqueue(new Uint8Array(8*1024*1024+1));}, cancel() {cancelled++;}
  })})});
  await rejected(f.reader.getNative(request()),['calendar_native_read_failed']);
  assert.equal(cancelled,1); assert.equal((await f.reader.status()).authorized,true);
});
test('caller cancellation actively cancels a stalled acquired body before releasing ordinary lock', async t => {
  let cancelled = 0, openedResolve, bodyController;
  const opened = new Promise(resolve => {openedResolve=resolve;});
  const body = new ReadableStream({start(controller) {bodyController=controller; openedResolve();}, cancel() {cancelled++;}});
  const f = await fixture(t, {fetcher:async () => ({ok:true,body})});
  const controller = new AbortController(), promise = f.reader.getNative(request(),{signal:controller.signal});
  await opened;
  // Allow the actual reader to acquire the stream before cancellation.
  while (!body.locked) await new Promise(resolve => setTimeout(resolve,1));
  try {
    controller.abort(); await rejected(promise,['calendar_native_read_aborted']);
    assert.equal(cancelled,1,'a stalled body must be explicitly cancelled on caller abort');
    assert.equal(body.locked,false,'a cancelled body must not retain a reader');
    assert.equal((await f.reader.status()).authorized,true);
  } finally {
    // End our synthetic stalled read even when the implementation violates the
    // cancellation assertion; never leave an unbounded fixture behind.
    if (body.locked) {try {bodyController.close();} catch {}}
  }
});
test('abort before ordinary fetch result cannot permit a successful body into collector', async t => {
  let resolveResponse, requestStarted;
  const started = new Promise(resolve => {requestStarted=resolve;});
  const f = await fixture(t, {fetcher:async () => {
    requestStarted(); return new Promise(resolve => {resolveResponse=resolve;});
  }});
  const controller = new AbortController(), read = f.reader.getNative(request(), {signal:controller.signal});
  await started; controller.abort(); await rejected(read,['calendar_native_read_aborted']);
  resolveResponse(textResponse(rawEnvelope(metadata())));
  assert.equal((await f.reader.status()).authorized,true); await absent(f.storePath+'.lock');
});
test('a byte stream arriving after cancellation is cancelled instead of read outside the lock', async t => {
  let resolveResponse, requestStarted, cancelled = 0, bodyController;
  const started = new Promise(resolve => {requestStarted=resolve;});
  const lateBody = new ReadableStream({start(controller) {bodyController=controller;}, cancel() {cancelled++;}});
  const f = await fixture(t, {fetcher:async () => {
    requestStarted(); return new Promise(resolve => {resolveResponse=resolve;});
  }});
  const controller = new AbortController(), read = f.reader.getNative(request(), {signal:controller.signal});
  await started; controller.abort(); await rejected(read,['calendar_native_read_aborted']);
  resolveResponse({ok:true,body:lateBody});
  try {
    await new Promise(resolve => setTimeout(resolve,5));
    assert.equal(cancelled,1,'already-aborted signal must cancel a late returned byte body');
    assert.equal(lateBody.locked,false,'late cancelled response must not leave a lockless body reader');
    await absent(f.storePath+'.lock');
  } finally {
    if (lateBody.locked) {try {bodyController.close();} catch {}}
  }
});

function collectorOptions(readNative, extra = {}) {return {calendarId:CAL,approvedCalendarIds:[CAL],readerOpenId:OWNER,
  anchorSeconds:String(NOW/1000),pageSize:50,now:() => NOW,readNative,...extra};}
test('full native source read retains cancelled, recurrence and unknown-person bodies but grants nothing', async t => {
  const events = [{event_id:'synthetic-a',status:'cancelled',summary:'Alice 与第二个未识别人',recurrence:['RRULE:FREQ=WEEKLY']},
    {event_id:'synthetic-b',summary:'合成未来未核验标题',start_time:{timestamp:String(NOW/1000+999999)}}];
  let page = 0, calls = 0;
  const f = await fixture(t,{fetcher:async (url) => {
    calls++;
    if (!new URL(url).pathname.endsWith('/events')) return textResponse(rawEnvelope(metadata()));
    const next = page++ === 0;
    return textResponse(rawEnvelope({items:[events[next?0:1]],has_more:next,...(next?{page_token:'cursor-next'}:{})}));
  }});
  const result = await collectNativeCalendarSource(collectorOptions(f.reader.getNative));
  assert.equal(result.status,'read_complete'); assert.deepEqual(result.events,events); assert.equal(calls,4);
  assert.equal(result.readyForReminder,false); assert.equal(result.formalScheduleBindingStatus,'pending');
  assert.equal(result.ownerOpenId,null); assert.equal(result.businessPassed,null); assert.equal(result.reviewOutcome,null);
  assert.equal(result.readerIdentityStatus,'dependency_not_authenticated_by_collector');
  assert.equal(result.fieldEvidence.eventUpdateTime,'not_exposed');
});
for (const raw of ['{"code":0,"data":{"items":[],"has_more":true,"h\\u0061s_more":false}}',
  '{"code":0,"data":{"items":[{"event_id":"a","event\\u005fid":"b"}],"has_more":false}}'])
test('original raw duplicate decoded keys survive reader and remain pending collector', async t => {
  const f = await fixture(t, {fetcher:async (url) => textResponse(new URL(url).pathname.endsWith('/events') ? raw : rawEnvelope(metadata()))});
  const result = await collectNativeCalendarSource(collectorOptions(f.reader.getNative));
  assert.equal(result.status,'pending'); assert.equal(result.reasonCode,'native_json_duplicate_key');
  assert.equal(result.readyForReminder,false);
});
for (const problem of ['same-id','terminal-token','hidden-cursor','schema','cap','metadata-drift'])
test('pagination cannot silently stop or normalize unsafe source '+problem, async t => {
  let page = 0, metadataReads = 0;
  const readNative = async query => {
    if (query.kind === 'metadata') return rawEnvelope({...metadata(),...(metadataReads++ && problem === 'metadata-drift' ? {summary:'edited'}:{})});
    page++;
    if (problem === 'terminal-token') return rawEnvelope({items:[],has_more:false,page_token:'unexpected-terminal'});
    if (problem === 'hidden-cursor') return rawEnvelope({items:[],has_more:true,page_token:'bad\u200bcursor'});
    if (problem === 'schema') return rawEnvelope({items:[],has_more:'false'});
    if (problem === 'metadata-drift') return rawEnvelope({items:[],has_more:false});
    return rawEnvelope({items:problem === 'same-id' ? [{event_id:'repeat'}] : [], has_more:true,page_token:'cursor-'+page});
  };
  const result = await collectNativeCalendarSource(collectorOptions(readNative,{maxPages:2}));
  assert.equal(result.status,'pending'); assert.equal(result.readyForReminder,false);
  assert.equal(result.reasonCode, {'same-id':'native_event_id_duplicate','terminal-token':'native_terminal_cursor_conflict',
    'hidden-cursor':'native_cursor_unverified','schema':'native_page_schema_unverified','cap':'native_page_cap_exceeded',
    'metadata-drift':'native_calendar_metadata_drift'}[problem]);
});
test('bounded collector aborts private read and cannot convert timeout into completeness', async () => {
  let aborted = false;
  const result = await collectNativeCalendarSource(collectorOptions((query,{signal}) => new Promise(() => {
    signal.addEventListener('abort',()=>{aborted=true;},{once:true});
  }),{maxDurationMs:15}));
  assert.equal(result.status,'pending'); assert.equal(result.reasonCode,'native_read_timeout');
  assert.equal(aborted,true); assert.equal(result.readyForReminder,false);
});
test('pure builder/decode are not authorization or schedule qualifications', () => {
  assert.ok(buildNativeCalendarRequest(request(),[CAL]).startsWith('https://open.feishu.cn/'));
  const decoded=decodeNativeCalendarEnvelope(rawEnvelope(metadata())); assert.equal(decoded.ok,true);
  assert.equal(Object.hasOwn(decoded,'readyForReminder'),false); assert.equal(Object.hasOwn(decoded,'ownerOpenId'),false);
});
for (const numberText of ['9007199254740993','-9007199254740992','1.00000000000000001','1e0','0.0','-0'])
test('unknown raw native numeric precision cannot silently collapse into a stable fingerprint '+numberText, () => {
  const result = decodeNativeCalendarEnvelope('{"code":0,"data":{"opaque_numeric":'+numberText+'}}');
  assert.equal(result.ok,false); assert.equal(result.reasonCode,'native_numeric_precision_unverified');
});
test('only raw safe integer native numeric value gets a lossless hash, never a permit', () => {
  const result = decodeNativeCalendarEnvelope('{"code":0,"data":{"opaque_numeric":9007199254740991}}');
  assert.equal(result.ok,true); assert.equal(result.data.opaque_numeric,Number.MAX_SAFE_INTEGER);
  assert.equal(Object.hasOwn(result,'readyForReminder'),false);
});
