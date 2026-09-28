import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Local source bytes only. No source-module imports, store, browser or real network.
globalThis.fetch = () => { throw Error('Real network forbidden in private-page QA'); };
const pageSha = '5f720fd696d26f961051a90e28cca1240a1b6ccf36521316a1901b13a1da30b8';
const referenceSha = 'f8f41ee468057d6e625948282058b8163abbb33e22a1b5f437073a42e9ededaf';
const selectorKeys = ['WIS_PRIVATE_PAGE_TARGET', 'WIS_PRIVATE_PAGE_SHA', 'WIS_PRIVATE_PAGE_ORIGINAL', 'WIS_PRIVATE_PAGE_ORIGINAL_SHA'];
const supplied = selectorKeys.filter(key => process.env[key] !== undefined);
assert.ok(supplied.length === 0 || supplied.length === selectorKeys.length, 'all four exact source selectors or none must be provided');
if (supplied.length) for (const key of selectorKeys) assert.ok(process.env[key].length > 0, `${key} must be nonempty`);
const pagePath = supplied.length ? process.env.WIS_PRIVATE_PAGE_TARGET : fileURLToPath(new URL('./private-chat.html', import.meta.url));
const referencePath = supplied.length ? process.env.WIS_PRIVATE_PAGE_ORIGINAL : fileURLToPath(new URL('./private-chat-original.html', import.meta.url));
const expectedPageSha = supplied.length ? process.env.WIS_PRIVATE_PAGE_SHA : pageSha;
const expectedReferenceSha = supplied.length ? process.env.WIS_PRIVATE_PAGE_ORIGINAL_SHA : referenceSha;
assert.equal(expectedPageSha, pageSha, 'selector cannot widen the frozen candidate pin');
assert.equal(expectedReferenceSha, referenceSha, 'selector cannot widen the exact original pin');
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const page = readFileSync(pagePath), reference = readFileSync(referencePath);
assert.equal(digest(page), expectedPageSha, 'candidate raw SHA must match explicitly selected source');
assert.equal(digest(reference), expectedReferenceSha, 'exact source reference raw SHA');
function parts(buffer) {
  const open = Buffer.from('<script>'), close = Buffer.from('</script>');
  const start = buffer.indexOf(open), end = buffer.indexOf(close);
  assert.ok(start >= 0 && end > start);
  assert.equal(buffer.indexOf(open, start + open.length), -1, 'single exact script opener');
  assert.equal(buffer.indexOf(close, end + close.length), -1, 'single exact script closer');
  return { prefix: buffer.subarray(0, start + open.length), script: buffer.subarray(start + open.length, end).toString('utf8'), suffix: buffer.subarray(end) };
}
const original = parts(reference), candidate = parts(page);
assert.deepEqual(candidate.prefix, original.prefix, 'all HTML/CSS before script unchanged as complete Buffer');
assert.deepEqual(candidate.suffix, original.suffix, 'all HTML after script unchanged as complete Buffer');
assert.equal(candidate.script.includes('innerHTML'), false, 'textContent-only safe status rendering');
const safeUrl = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=synthetic&state=synthetic&code_challenge=synthetic';
const secret = 'synthetic-RAW-token-code-error-never-rendered';
const tuples = {
  unconfigured: [false, false, false, false], unauthorized: [true, false, false, true],
  authorized: [true, true, false, true], recovery_required: [true, false, true, false], busy: [true, false, false, false],
};
function auth(status = 'unauthorized', overrides = {}) {
  const [configured, authorized, recoveryRequired, retryAllowed] = tuples[status];
  return { configured, authorized, status, recoveryRequired, retryAllowed, ...overrides };
}
function status(state = 'unauthorized', overrides = {}) {
  return { ok: true, eligible: true, enabled: true, name: '倪梦萍', authorization: auth(state), ...overrides };
}
function deferred() {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
function harness() {
  const nodes = Object.fromEntries(['statusTitle', 'statusText', 'authorize', 'verify', 'refresh'].map(id => {
    const tag = new RegExp(`<button id="${id}"[^>]*>`, 'u').exec(candidate.prefix.toString('utf8'));
    return [id, { textContent: '', disabled: tag ? /\bdisabled\b/u.test(tag[0]) : false }];
  }));
  const calls = [], navigations = [], timers = new Map(); let timerId = 0;
  const context = vm.createContext({
    document: { getElementById: id => { assert.ok(Object.hasOwn(nodes, id)); return nodes[id]; } },
    location: { pathname: '/synthetic/private-chat.html' }, URL, AbortController,
    window: { top: { location: { assign: value => { navigations.push(value); } } } },
    fetch: (url, options) => {
      assert.ok(url.startsWith('/synthetic/api/lifecycle/private-chat-auth/'), 'only expected local relative API');
      assert.ok(['status', 'start', 'verify'].includes(url.split('/').at(-1)), 'only scoped actions');
      const response = deferred(); calls.push({ url, options, response }); return response.promise;
    },
    setTimeout: (callback, ms) => { assert.equal(ms, 15000); const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(candidate.script, context, { timeout: 1000, filename: 'synthetic-private-page-script.js' });
  const respond = (index, data, ok = true) => { calls[index].response.resolve({ ok, json: async () => data }); };
  const fail = index => calls[index].response.reject(Error(secret));
  const fireTimeouts = () => { for (const callback of [...timers.values()]) callback(); };
  const disabled = () => { assert.equal(nodes.authorize.disabled, true); assert.equal(nodes.verify.disabled, true); };
  const safe = () => { assert.equal(`${nodes.statusTitle.textContent} ${nodes.statusText.textContent}`.includes(secret), false); };
  const boot = async data => { respond(0, data); await settle(); };
  return { nodes, context, calls, navigations, timers, respond, fail, fireTimeouts, disabled, safe, boot };
}
async function ready(state = 'unauthorized', overrides = {}) { const h = harness(); await h.boot(status(state, overrides)); return h; }
async function startCase(data, ok = true) {
  const h = await ready(); const work = h.nodes.authorize.onclick(); h.respond(1, data, ok); await work; await settle(); return h;
}
async function verifyCase(data, ok = true) {
  const h = await ready('authorized'); const work = h.nodes.verify.onclick(); h.respond(1, data, ok); await work; await settle(); return h;
}

test('exact raw pins, complete script-exterior Buffers and original initial disabled controls', () => {
  assert.equal(digest(page), expectedPageSha); assert.equal(digest(reference), referenceSha);
  assert.deepEqual(candidate.prefix, original.prefix); assert.deepEqual(candidate.suffix, original.suffix);
  assert.match(candidate.prefix.toString('utf8'), /<button id="authorize" disabled>/u);
  assert.match(candidate.prefix.toString('utf8'), /<button id="verify" class="secondary" disabled>/u);
  const h = harness(); h.disabled(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.method, 'GET');
  assert.equal(h.calls[0].options.credentials, 'same-origin'); assert.equal(h.calls[0].options.cache, 'no-store');
});

for (const state of Object.keys(tuples)) test(`five-state contract: ${state}`, async () => {
  const h = await ready(state); h.safe();
  assert.equal(h.nodes.authorize.disabled, !['unauthorized', 'authorized'].includes(state));
  assert.equal(h.nodes.verify.disabled, state !== 'authorized');
  if (state === 'authorized') assert.equal(h.nodes.authorize.textContent, '重新授权');
  if (state === 'recovery_required' || state === 'busy') assert.match(h.nodes.statusText.textContent, /请勿重复/u);
});
test('second fixed identity accepted without public identity expansion', async () => {
  const h = await ready('unauthorized', { name: '刘慧迅' }); assert.equal(h.nodes.authorize.disabled, false); assert.match(h.nodes.statusText.textContent, /^刘慧迅：/u);
});
test('ineligible native status has no authorization requirement and stays disabled', async () => {
  const h = harness(); await h.boot({ ok: true, eligible: false, enabled: true, reason: secret }); h.disabled(); h.safe(); assert.match(h.nodes.statusTitle.textContent, /本人账号/u);
});
test('configured but globally disabled shows fixed closed-entry notice', async () => {
  const h = await ready('authorized', { enabled: false }); h.disabled(); assert.match(h.nodes.statusText.textContent, /授权入口暂未开放/u);
});
const malformedStatus = [
  ['string ok', { ok: 'true' }], ['string eligible', { eligible: 'true' }], ['string enabled', { enabled: 'false' }],
  ['unknown identity', { name: secret }], ['prototype identity', { name: '__proto__' }], ['object identity', { name: new String('倪梦萍') }],
  ['missing authorization', { authorization: undefined }], ['array authorization', { authorization: [] }],
  ['missing enum', { authorization: { configured: true, authorized: false, recoveryRequired: false, retryAllowed: true } }],
  ['unknown enum', { authorization: auth('unauthorized', { status: 'pending' }) }],
  ['missing recovery flag', { authorization: auth('unauthorized', { recoveryRequired: undefined }) }],
  ['missing retry flag', { authorization: auth('unauthorized', { retryAllowed: undefined }) }],
  ['string configured', { authorization: auth('unauthorized', { configured: 'true' }) }],
  ['string authorized', { authorization: auth('unauthorized', { authorized: 'false' }) }],
  ['string recovery', { authorization: auth('unauthorized', { recoveryRequired: 'false' }) }],
  ['string retry', { authorization: auth('unauthorized', { retryAllowed: 'true' }) }],
  ['contradictory held true authorized', { authorization: auth('recovery_required', { authorized: true }) }],
  ['contradictory unauthorized no retry', { authorization: auth('unauthorized', { retryAllowed: false }) }],
  ['top malformed retry', { retryAllowed: 'true' }], ['top malformed recovery', { recoveryRequired: 'false' }],
  ['top unknown enum', { status: 'fake' }], ['top recovery true', { recoveryRequired: true }], ['top retry false', { retryAllowed: false }],
];
for (const [label, overrides] of malformedStatus) test(`status rejects ${label}`, async () => {
  const h = await ready('unauthorized', { reason: secret, error: secret, ...overrides }); h.disabled(); h.safe();
});
test('status accessor is rejected without executing its getter', async () => {
  let touched = false; const data = status(); Object.defineProperty(data, 'name', { get() { touched = true; throw Error(secret); } });
  const h = harness(); await h.boot(data); h.disabled(); h.safe(); assert.equal(touched, false);
});
test('authorization accessor rejected without executing it', async () => {
  let touched = false; const data = status(); Object.defineProperty(data.authorization, 'authorized', { get() { touched = true; return true; } });
  const h = harness(); await h.boot(data); h.disabled(); assert.equal(touched, false);
});
test('inherited authorization fields rejected', async () => {
  const h = await ready('unauthorized', { authorization: Object.create(auth('unauthorized')) }); h.disabled();
});
test('non-object status response rejected', async () => {
  for (const data of [null, [], true, secret]) { const h = harness(); await h.boot(data); h.disabled(); h.safe(); }
});
test('status network and JSON failures show fixed safe text only', async () => {
  const network = harness(); network.fail(0); await settle(); network.disabled(); network.safe();
  const json = harness(); json.calls[0].response.resolve({ ok: true, json: async () => { throw Error(secret); } }); await settle(); json.disabled(); json.safe();
});
test('error status held code preserves fixed hold instructions', async () => {
  const h = harness(); h.respond(0, { ok: false, code: 'private_chat_authorization_held', reason: secret, retryAllowed: false }, false);
  await settle(); h.disabled(); h.safe(); assert.match(h.nodes.statusText.textContent, /管理员独立核验/u);
});
test('status HTTP success flag must be a primitive boolean', async () => {
  const h = harness(); h.respond(0, status(), 'true'); await settle(); h.disabled();
});
test('newer hold response dominates older authorized status', async () => {
  const h = harness(); const refresh = h.nodes.refresh.onclick(); assert.equal(h.calls.length, 2);
  h.respond(1, status('recovery_required')); await refresh; h.respond(0, status('authorized')); await settle(); h.disabled(); assert.match(h.nodes.statusText.textContent, /管理员独立核验/u);
});
test('late older network error cannot overwrite newer good state', async () => {
  const h = harness(); const refresh = h.nodes.refresh.onclick(); h.respond(1, status('authorized')); await refresh;
  h.fail(0); await settle(); assert.equal(h.nodes.authorize.disabled, false); assert.equal(h.nodes.verify.disabled, false);
});
test('status timeout aborts and ignores late authorized payload until explicit refresh', async () => {
  const h = harness(); h.fireTimeouts(); await settle(); h.disabled(); assert.equal(h.calls[0].options.signal.aborted, true);
  h.respond(0, status('authorized')); await settle(); h.disabled();
  const refresh = h.nodes.refresh.onclick(); h.respond(1, status('unauthorized')); await refresh; assert.equal(h.nodes.authorize.disabled, false);
});
test('JSON-body timeout also aborts and ignores late JSON', async () => {
  const h = harness(), body = deferred(); h.calls[0].response.resolve({ ok: true, json: () => body.promise }); await settle();
  h.fireTimeouts(); await settle(); h.disabled(); body.resolve(status('authorized')); await settle(); h.disabled();
});
test('one start POST despite double clicks, cross verify and refresh while active', async () => {
  const h = await ready('authorized'); const start = h.nodes.authorize.onclick(); h.nodes.authorize.onclick(); h.nodes.verify.onclick(); await h.nodes.refresh.onclick();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].options.method, 'POST'); assert.equal(h.calls[1].options.headers['X-Requested-With'], 'XMLHttpRequest');
  h.respond(1, { ok: true, authorizeUrl: safeUrl }); await start; assert.deepEqual(h.navigations, [safeUrl]); h.disabled(); assert.equal(h.nodes.refresh.disabled, false);
});
test('start failure cannot be reopened by finally or older status response', async () => {
  const h = await ready('authorized'); const old = h.nodes.refresh.onclick(), fresh = h.nodes.refresh.onclick(); h.respond(2, status('authorized')); await fresh;
  const start = h.nodes.authorize.onclick(); h.fail(3); await start; h.respond(1, status('authorized')); await old;
  h.disabled(); h.safe(); assert.equal(h.navigations.length, 0);
  const refresh = h.nodes.refresh.onclick(); h.respond(4, status('unauthorized')); await refresh; assert.equal(h.nodes.authorize.disabled, false);
});
test('start timeout does not navigate after late fetch completion', async () => {
  const h = await ready(); const start = h.nodes.authorize.onclick(); h.fireTimeouts(); await start; h.disabled();
  h.respond(1, { ok: true, authorizeUrl: safeUrl }); await settle(); h.disabled(); assert.equal(h.navigations.length, 0);
});
test('valid fixed Feishu endpoint navigates exactly once and remains disabled', async () => {
  const h = await startCase({ ok: true, authorizeUrl: safeUrl }); assert.deepEqual(h.navigations, [safeUrl]); h.disabled();
});
const badUrls = [
  ['other origin', 'https://attacker.invalid/open-apis/authen/v1/authorize'],
  ['userinfo', 'https://synthetic@accounts.feishu.cn/open-apis/authen/v1/authorize'],
  ['explicit default port', 'https://accounts.feishu.cn:443/open-apis/authen/v1/authorize'],
  ['port', 'https://accounts.feishu.cn:8443/open-apis/authen/v1/authorize'],
  ['fragment', `${safeUrl}#${secret}`], ['empty fragment', `${safeUrl}#`],
  ['wrong path', 'https://accounts.feishu.cn/open-apis/authen/v1/token'],
  ['path traversal', 'https://accounts.feishu.cn/open-apis/authen/v1/authorize/../token'],
  ['encoded path', 'https://accounts.feishu.cn/open-apis/authen/v1/%61uthorize'],
  ['extra trailing path', 'https://accounts.feishu.cn/open-apis/authen/v1/authorize/'],
  ['relative URL', '/open-apis/authen/v1/authorize'], ['http URL', safeUrl.replace('https:', 'http:')],
  ['lookalike suffix', safeUrl.replace('accounts.feishu.cn', 'accounts.feishu.cn.attacker.invalid')],
  ['backslash', `${safeUrl}\\${secret}`], ['leading whitespace', ` ${safeUrl}`],
  ['query newline', `${safeUrl}\n${secret}`], ['query NUL', `${safeUrl}\u0000${secret}`],
  ['boxed string', new String(safeUrl)], ['array', [safeUrl]], ['too long', `${safeUrl}&state=${'x'.repeat(8192)}`],
];
for (const [label, authorizeUrl] of badUrls) test(`start rejects ${label}`, async () => {
  const h = await startCase({ ok: true, authorizeUrl, error: secret }); h.disabled(); h.safe(); assert.equal(h.navigations.length, 0);
});
for (const [label, extra] of [
  ['top held', { status: 'recovery_required', recoveryRequired: true, retryAllowed: false }],
  ['top busy', { code: 'private_chat_authorization_busy', retryAllowed: false }],
  ['top retry blocked', { retryAllowed: false }], ['nested held', { authorization: auth('recovery_required') }],
  ['nested bad configured', { authorization: auth('unauthorized', { configured: 'true' }) }],
  ['malformed ok', { ok: 'true' }], ['malformed enabled', { enabled: 'true' }], ['ineligible', { eligible: false }],
]) test(`start rejects success-shaped ${label}`, async () => {
  const h = await startCase({ ok: true, authorizeUrl: safeUrl, ...extra }); h.disabled(); assert.equal(h.navigations.length, 0);
});
test('start URL accessor is never executed or reflected', async () => {
  let touched = false; const data = { ok: true }; Object.defineProperty(data, 'authorizeUrl', { get() { touched = true; return safeUrl; } });
  const h = await startCase(data); h.disabled(); h.safe(); assert.equal(touched, false); assert.equal(h.navigations.length, 0);
});
test('verification succeeds only with true verified and boolean sampleAvailable', async () => {
  for (const sampleAvailable of [true, false]) {
    const h = await verifyCase({ ok: true, verification: { verified: true, sampleAvailable, error: secret } });
    assert.equal(h.nodes.statusTitle.textContent, '指定私聊读取核验成功'); h.disabled(); h.safe(); assert.equal(h.navigations.length, 0);
  }
});
for (const [label, verification] of [
  ['false verified', { verified: false, sampleAvailable: true }], ['string verified', { verified: 'true', sampleAvailable: true }],
  ['missing verified', { sampleAvailable: true }], ['missing sampleAvailable', { verified: true }],
  ['string sampleAvailable', { verified: true, sampleAvailable: 'false' }], ['null sampleAvailable', { verified: true, sampleAvailable: null }],
  ['array verification', []], ['missing verification', undefined],
]) test(`verification rejects ${label}`, async () => {
  const h = await verifyCase({ ok: true, verification, error: secret }); h.disabled(); h.safe(); assert.notEqual(h.nodes.statusTitle.textContent, '指定私聊读取核验成功');
});
test('verification accessor is rejected without invoking getter', async () => {
  let touched = false; const verification = { sampleAvailable: true }; Object.defineProperty(verification, 'verified', { get() { touched = true; return true; } });
  const h = await verifyCase({ ok: true, verification }); h.disabled(); assert.equal(touched, false); assert.notEqual(h.nodes.statusTitle.textContent, '指定私聊读取核验成功');
});
test('one verify POST despite duplicate verify/start/refresh attempts', async () => {
  const h = await ready('authorized'); const verify = h.nodes.verify.onclick(); h.nodes.verify.onclick(); h.nodes.authorize.onclick(); await h.nodes.refresh.onclick();
  assert.equal(h.calls.length, 2); h.respond(1, { ok: true, verification: { verified: true, sampleAvailable: false } }); await verify; h.disabled();
  h.nodes.verify.onclick(); h.nodes.authorize.onclick(); assert.equal(h.calls.length, 2);
});
test('verification failure remains closed until explicit readonly refresh', async () => {
  const h = await ready('authorized'); const verify = h.nodes.verify.onclick(); h.respond(1, { ok: false, reason: secret }, false); await verify;
  h.disabled(); h.safe(); const fresh = h.nodes.refresh.onclick(); h.respond(2, status('authorized')); await fresh;
  assert.equal(h.nodes.authorize.disabled, false); assert.equal(h.nodes.verify.disabled, false);
});
test('held success-shaped verification cannot display success', async () => {
  const h = await verifyCase({ ok: true, status: 'busy', retryAllowed: false, verification: { verified: true, sampleAvailable: true } });
  h.disabled(); assert.match(h.nodes.statusText.textContent, /管理员独立核验/u); assert.notEqual(h.nodes.statusTitle.textContent, '指定私聊读取核验成功');
});
test('verify timeout ignores late success and aborts synthetic request', async () => {
  const h = await ready('authorized'); const verify = h.nodes.verify.onclick(); h.fireTimeouts(); await verify;
  assert.equal(h.calls[1].options.signal.aborted, true); h.respond(1, { ok: true, verification: { verified: true, sampleAvailable: true } }); await settle();
  h.disabled(); assert.notEqual(h.nodes.statusTitle.textContent, '指定私聊读取核验成功');
});
test('older status cannot reopen after verification result or timeout', async () => {
  const h = await ready('authorized'); const old = h.nodes.refresh.onclick(), fresh = h.nodes.refresh.onclick(); h.respond(2, status('authorized')); await fresh;
  const verify = h.nodes.verify.onclick(); h.respond(3, { ok: true, verification: { verified: true, sampleAvailable: false } }); await verify;
  h.respond(1, status('authorized')); await old; h.disabled(); assert.equal(h.nodes.statusTitle.textContent, '指定私聊读取核验成功');
});
