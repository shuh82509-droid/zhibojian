// Independent read-only whole-source delta proof. Does not import any reader.
// Explicit candidate root and both new SHA pins are mandatory; there is no
// Windows fallback, latest-file acceptance, production IO, or grant execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const [root,newBaseSha,newNativeSha]=process.argv.slice(2);
assert.equal(process.argv.length,5,'explicit root/base/native pins required');
assert.ok(typeof root==='string'&&root.length>0);
for(const pin of [newBaseSha,newNativeSha])assert.match(pin,/^[a-f0-9]{64}$/u);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const oldBaseSha='173e639ee6719c00871b2606fe9661b9587a4a2a25222981882c3d3f4b1fd257';
const oldNativeSha='61bb609a713da635eab0e03c60b2f862f3846131c0176c11cebef423061947aa';
const collectorSha='ef2bf28096e2bc503c7aa07776c19e8734904839ad84a804872abb1f571a57cd';
function read(relative,pin){
  const bytes=readFileSync(join(root,relative));
  assert.equal(sha(bytes),pin,relative+' raw SHA');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  assert.deepEqual(Buffer.from(text,'utf8'),bytes,relative+' UTF-8 exact roundtrip');
  assert.equal(text.includes('\u0000'),false);
  return text;
}
function unique(text,needle){
  const at=text.indexOf(needle);
  assert.ok(at>=0,'missing anchor: '+needle);
  assert.equal(text.indexOf(needle,at+needle.length),-1,'ambiguous anchor: '+needle);
  return at;
}
function span(text,start,end){
  const at=unique(text,start),next=unique(text,end);
  assert.ok(next>at,'reversed anchors');
  return text.slice(at,next);
}
function replaceExact(text,from,to){const at=unique(text,from);return text.slice(0,at)+to+text.slice(at+from.length);}
const oldBase=read('base/calendar-user-reader.previous.mjs',oldBaseSha);
const oldNative=read('native-reader/calendar-user-reader.previous.mjs',oldNativeSha);
const newBase=read('base/calendar-user-reader.mjs',newBaseSha);
const newNative=read('native-reader/calendar-user-reader.mjs',newNativeSha);

function stripNative(text){
  text=replaceExact(text,"import {buildNativeCalendarRequest} from './native-calendar-source.mjs';\n",'');
  text=replaceExact(text,'allowInstanceView = false, allowNativeSource = false, redirectUri','allowInstanceView = false, redirectUri');
  text=replaceExact(text,span(text,'  // Private, opt-in native source reads.','  async function verifyCalendar(targetCalendarId)'), '');
  return replaceExact(text,'  return {calendarId, status, begin, complete, get, verifyCalendar,\n    ...(allowNativeSource === true ? {getNative} : {})};','  return {calendarId, status, begin, complete, get, verifyCalendar};');
}
assert.equal(stripNative(oldNative),oldBase,'previous native reverse whole-file equality');
assert.equal(stripNative(newNative),newBase,'new native reverse whole-file equality');
assert.equal(span(newNative,'  // Private, opt-in native source reads.','  async function verifyCalendar(targetCalendarId)'),
  span(oldNative,'  // Private, opt-in native source reads.','  async function verifyCalendar(targetCalendarId)'), 'native GET byte-for-byte unchanged');

function reverseCodeDelta(text,previous){
  text=replaceExact(text,'  const codeHoldPath = `${storePath}.code-hold.json`;\n','');
  const newErrors=span(text,'  let locallyBlocked = false;','  const same =');
  assert.equal(newErrors,'  let locallyBlocked = false;\n  let locallyCodeBlocked = false;\n  const safePublicErrors = new WeakMap();\n  const error = (code, message) => {\n    const failure = Object.assign(new Error(message), {code});\n    safePublicErrors.set(failure,Object.freeze({code,message}));\n    return failure;\n  };\n');
  text=replaceExact(text,newErrors,span(previous,'  let locallyBlocked = false;','  const same ='));
  text=replaceExact(text,"  // Preserve the existing recovery-required public code for old callers/cards.\n  // The distinct durable marker and stage-specific message describe code intent.\n  const codeRecoveryRequired = () => error('calendar_refresh_recovery_required', '日历授权交换意图或结果待核验，已停止访问与自动重试；请勿刷新回调或重复授权，需独立恢复核验。');\n",'');
  text=replaceExact(text,'    if (locallyCodeBlocked || await exists(codeHoldPath)) throw codeRecoveryRequired();\n','');
  const helpers=span(text,'  function validCodeIntent(item) {','  async function load() {');
  assert.ok(helpers.includes("const keys = ['schemaVersion','kind','contextSha256','attemptId','createdAt'];"));
  assert.ok(helpers.includes("item.kind === 'calendar_code_exchange_intent'"));
  for(const step of ['await file.sync();','await rename(temp,codeHoldPath);','await syncDirectory(dirname(storePath));','await readOwnCodeIntent(intent);'])assert.ok(helpers.includes(step));
  assert.ok(helpers.includes('raw !== JSON.stringify(expected)'));
  text=replaceExact(text,helpers,'');
  text=replaceExact(text,'const control = {refreshRisk:false,refreshIntent:null,codeIntent:null};','const control = {refreshRisk:false,refreshIntent:null};');
  const cleanup=span(text,'          if (control.codeIntent) {','          // If removal took effect before reporting an error, restore the');
  assert.ok(cleanup.includes('locallyCodeBlocked = true;'));
  assert.ok(cleanup.includes('await writeCodeIntent(control.codeIntent);'));
  text=replaceExact(text,cleanup,'');
  const complete=span(text,'  async function complete({code, state, cookieState}) {','  async function accessTokenWithinLock(control) {');
  const oldComplete=span(previous,'  async function complete({code, state, cookieState}) {','  async function accessTokenWithinLock(control) {');
  assert.equal(span(complete,'  async function complete({code, state, cookieState}) {','    return exclusive(async control => {'),
    span(oldComplete,'  async function complete({code, state, cookieState}) {','    return exclusive(async control => {'), 'existing synchronous state claim/PKCE bytes unchanged');
  const tokenLine="    const data = await tokenRequest({grant_type:'authorization_code',code,redirect_uri:redirectUri,code_verifier:attempt.verifier,scope:requiredScopes.join(' ')});";
  unique(complete,tokenLine);unique(oldComplete,tokenLine);
  for(const gate of ['const grant = refreshedRecord(data, expectedOpenId);',
    'const openId = await getUserInfo(grant.accessToken);',
    "typeof openId !== 'string' || !same(openId, expectedOpenId)",
    'await verifyCalendarAccess(grant.accessToken);','const record = {...grant,openId};',
    'await save(record);','sameStoredGrant(readback,record)','if (!result.authorized)',
    'await clearCodeIntent(intent);','safePublicErrors.get(cause)'])assert.ok(complete.includes(gate));
  const order=['control.refreshRisk = true;','await persistCodeIntent();','await readOwnCodeIntent(intent);','const requestTimestamp = now();',tokenLine,
    'const grant = refreshedRecord','const openId = await getUserInfo','await verifyCalendarAccess','await save(record);',
    'const readback = await load();','if (!result.authorized)','await clearCodeIntent(intent);','control.refreshRisk = false;'];
  for(let i=1;i<order.length;i++)assert.ok(unique(complete,order[i-1])<unique(complete,order[i]),'code boundary order: '+order[i]);
  assert.ok(complete.includes('timestamp < attempt.createdAt'));
  assert.ok(complete.includes('timestamp - attempt.createdAt > 600_000'));
  text=replaceExact(text,complete,oldComplete);
  assert.equal(text,previous,'entire file differs only in the explicitly reviewed code-exchange delta');
  return sha(text);
}
assert.equal(reverseCodeDelta(newBase,oldBase),oldBaseSha);
assert.equal(reverseCodeDelta(newNative,oldNative),oldNativeSha);
for(const text of [newBase,newNative]){
  assert.deepEqual([...text.matchAll(/^export function (\w+)\(/gmu)].map(item=>item[1]),['createCalendarUserReader'],'no recovery/reset/export API added');
}
read('pure/native-calendar-source.mjs',collectorSha);
read('native-reader/native-calendar-source.mjs',collectorSha);

// Only the exact whole-source base SHA and the explicitly enumerated label
// correction may change. Reverse both and require the original frozen file SHA.
const adaptation=[];
for(const [path,oldSha,newLabel,oldLabel] of [
  ['native-reader/native-reader.test.mjs','c29c50d1111f1b160d2d02f1c2547ffe839c3abc0f9d9262ac41a2568c70a759',
    "test('native opt-in changes only import/signature/new method/API relative to the exact code-intent base',()=>{",
    "test('integration changes only opt-in import/signature/new method/API; original safe reader bytes are preserved',()=>{"],
  ['audit-native-reader/native-independent.test.mjs','f64290b2ba968962b4397c0c72ad13b5d191f6e32b0e59a5c2df3a1aeb314d38',
    "test('only four scoped native changes relative to the exact shared code-intent base', () => {",
    "test('only four scoped native changes; existing refresh/PKCE/scopes/API bytes stay frozen', () => {"]]){
  const raw=readFileSync(join(root,path));
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  assert.deepEqual(Buffer.from(text,'utf8'),raw);
  const restored=replaceExact(replaceExact(text,newBaseSha,oldBaseSha),newLabel,oldLabel);
  assert.equal(sha(restored),oldSha,path+' no legacy assertion/function/case changes');
  adaptation.push({path,sha256:sha(raw),legacyRestoredSha256:oldSha,changedOnlyBasePinAndExactLabel:true});
}
for(const [path,pin] of [
  ['base/refresh-safe.test.mjs','e4e97d19661777b30afa018f6924d5253a134c13f230ae137208b42f9c6a8c1f'],
  ['pure/native-calendar-source.test.mjs','00421f9af36808fe125cd6196359daeddfca3f2085fab7380addbda4cfbc50d0'],
  ['audit-refresh/refresh-independent.test.mjs','2902680e011efda9af1da309eb2e05da3f2be023f6770a7e7c58a3524a9bb499'],
  ['audit-refresh/crash-worker.mjs','11fc7d1973d22741b87477612f9708d8823ae36ebea2371eb2f50ce02fc01599'],
  ['audit-refresh/source-scope.mjs','2b9084c1173bd156530eb8019492f838f7413d1a872fd01a374fba766808317c'],
  ['audit-native-source/native-independent.test.mjs','33615b7868e2e60378c767ef5ff32c8381b2be5213d61096d4b3f33c5f18b886'],
  ['base/calendar-user-reader.original.mjs','a2dc5930d00b37113c98c515dbe9e43682e0ec49b0280f8dc76095720f5e7f97'],
  ['base/calendar-user-reader.formal.mjs','75067a7fd85d827d43d6f439a6c5a81f156f1358a64defec13a75d45b68be630'],
  ['audit-refresh/current-baseline-scope.mjs','60e37bebc603665e9016fadc6bb017befb1e820f9ea53ff0cfcb1410de8f028b']])read(path,pin);

process.stdout.write(JSON.stringify({scope:'independent_codeexchange_delta_passed',newBaseSha,newNativeSha,
  previousBaseSha:oldBaseSha,previousNativeSha:oldNativeSha,wholeFileReverseEquality:true,
  nativeToNewBaseWholeFileEquality:true,nativeGetUnchanged:true,collectorUnchanged:true,
  legacyTestAdaptation:adaptation,sourceOnly:true,productionApproved:false})+'\n');
