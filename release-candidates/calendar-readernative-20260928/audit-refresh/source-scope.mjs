// Independent exact-source scope check; no module execution or credential reads.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const modulePath=process.env.WIS_READER_REFRESH_MODULE || 'H:/codex输出/直播五环节工作流-20260923/calendar-reader-safe-exact-20260928/candidate-2205/calendar-user-reader.mjs';
const baselinePath=process.env.WIS_READER_REFRESH_BASE || new URL('./calendar-user-reader.original.mjs',pathToFileURL(modulePath));
const source=readFileSync(modulePath,'utf8'),base=readFileSync(baselinePath,'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
assert.equal(sha(source),'173e639ee6719c00871b2606fe9661b9587a4a2a25222981882c3d3f4b1fd257');
assert.equal(sha(base),'a2dc5930d00b37113c98c515dbe9e43682e0ec49b0280f8dc76095720f5e7f97');
function section(text,start,end){const at=text.indexOf(start);assert.ok(at>=0);const next=text.indexOf(end,at+start.length);assert.ok(next>at);return text.slice(at,next).trim();}
function line(text,begin){const lines=text.split('\n').filter(value=>value.trimStart().startsWith(begin));assert.equal(lines.length,1);return lines[0].trim();}
const lines=['const requiredScopes =','const codeTokenEndpoint =','const refreshTokenEndpoint =','const userInfoEndpoint =',
  'const key =','const configured =','const context =','const permittedCalendars =','return {calendarId, status, begin, complete, get, verifyCalendar};'];
for(const start of lines)assert.equal(line(source,start),line(base,start),start);
const sections=[
  ['const encrypt = value => {','const decrypt = raw => {'],
  ['function begin() {','async function tokenRequest(body) {'],
  ['async function tokenRequest(body) {','async function getUserInfo(accessToken) {'],
  ['async function getUserInfo(accessToken) {','async function verifyCalendarAccess(accessToken, targetCalendarId = calendarId) {'],
];
for(const [start,end] of sections)
  assert.equal(section(source,start,end),section(base,start,end),start);
assert.equal(section(source,'const decrypt = raw => {','const recoveryRequired ='),section(base,'const decrypt = raw => {','async function load() {'),'AES-GCM version/AAD/decryption');
assert.equal(section(source,'async function verifyCalendarAccess(accessToken, targetCalendarId = calendarId) {','function refreshedRecord('),
  section(base,'async function verifyCalendarAccess(accessToken, targetCalendarId = calendarId) {','function recordFrom('),'primary identity and calendar details unchanged');
assert.equal(section(source,'async function get(path) {','return withReadableCredential('),
  section(base,'async function get(path) {','const response = await fetchImpl('),'all approved paths/query/instance range gates unchanged');
const complete=section(source,'async function complete({code, state, cookieState}) {','async function accessTokenWithinLock(');
assert.ok(complete.indexOf('const grant = refreshedRecord(data, expectedOpenId);')<complete.indexOf('const openId = await getUserInfo(grant.accessToken);'),'strict grant before first GET');
assert.match(complete,/typeof openId !== 'string' \|\| !same\(openId, expectedOpenId\)/u);
assert.match(complete,/sameStoredGrant\(readback,record\)/u);
assert.equal(source.includes('function recordFrom('),false);
assert.deepEqual([...source.matchAll(/^export function (\w+)\(/gmu)].map(match=>match[1]),['createCalendarUserReader'],'no exported recovery/reset/clear entrypoint');
process.stdout.write(JSON.stringify({scope:'passed',moduleSha:sha(source),baselineSha:sha(base),unchangedSections:lines.length+sections.length+3})+'\n');
