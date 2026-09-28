// Narrow source proof, not production/authorization proof. Read only exact two public source files.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hasOriginal=Object.hasOwn(process.env,'WIS_PRIVATE_ORIGINAL_READER_MODULE');
const hasCandidate=Object.hasOwn(process.env,'WIS_PRIVATE_READER_MODULE');
assert.equal(hasOriginal,hasCandidate,'original and candidate source selectors must both be explicit or both absent');
const originalPath=hasOriginal?process.env.WIS_PRIVATE_ORIGINAL_READER_MODULE:new URL('./private-chat-reader-original.mjs',import.meta.url);
const candidatePath=hasCandidate?process.env.WIS_PRIVATE_READER_MODULE:new URL('./private-chat-reader.mjs',import.meta.url);
if(hasOriginal){assert.equal(typeof originalPath,'string');assert(originalPath.length>0);assert.equal(typeof candidatePath,'string');assert(candidatePath.length>0);}
const pinOld='8eff752b765aed9ac10db7ca0493ee5a8b6f54dd619cc20bcc6239b8e419bf69';
const pinNew='9b74ac9356e3679255a25c815c624de88778b999666553a3b109bad9c1cae5fd';
const oldRaw=readFileSync(originalPath),newRaw=readFileSync(candidatePath);
const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(oldRaw),pinOld);assert.equal(hash(newRaw),pinNew);
const decode=b=>new TextDecoder('utf-8',{fatal:true}).decode(b).replace(/\r\n/gu,'\n');
const old=decode(oldRaw),next=decode(newRaw);
const section=(text,a,b)=>{const begin=text.indexOf(a),end=text.indexOf(b,begin+a.length);assert(begin>=0&&end>begin);return text.slice(begin,end);};
const line=(text,part)=>{const lines=text.split('\n').filter(l=>l.includes(part));assert.equal(lines.length,1);return lines[0];};
assert.equal(line(next,'export function createPrivateChatReader('),line(old,'export function createPrivateChatReader('),'factory parameters unchanged');
assert.equal(line(next,'return {status, begin, complete, verify, readMessages}'),line(old,'return {status, begin, complete, verify, readMessages}'));
assert.equal(line(next,'export const requiredScopes').replace('Object.freeze(','').replace(']);','];'),line(old,'export const requiredScopes'),'scope values unchanged, only frozen');
for(const part of ['import {createCipheriv','import {dirname}','const tokenEndpoint =','const userInfoEndpoint =','const context = Buffer.from'])assert.equal(line(next,part),line(old,part));
assert.equal(section(next,'  const encrypt = value => {','  function validStoredGrant(').trimEnd(),section(old,'  const encrypt = value => {','  async function load(').trimEnd(),'AEAD v2 crypto full block unchanged');
assert.equal(section(next,'  async function verifyPair(accessToken) {','  function recordFrom('),section(old,'  async function verifyPair(accessToken) {','  function recordFrom('),'fixed pair/person/sample read whole block unchanged');
const readOld=section(old,'  async function readMessages({startTime,endTime}) {','  return {status, begin, complete, verify, readMessages}');
const readNew=section(next,'  async function readMessages({startTime,endTime}) {','  return {status, begin, complete, verify, readMessages}')
 .replace('    return exclusive(async control => {\n','').replace('const token=await accessToken(control);','const token=await accessToken();').replace('    });\n  }\n','  }\n');
assert.equal(readNew,readOld,'all original read range/pair/person/page/dedup logic remains, only lock/control wrapper added');
const apiOld=section(old,'  async function api(accessToken, path, body) {','  async function verifyPair(');
const apiNew=section(next,'  async function api(accessToken, path, body) {','  async function verifyPair(')
 .replace('if (response.ok !== true || !plainObject(data) || data.code !== 0)', 'if (!response.ok || data.code !== 0)');
assert.equal(apiNew,apiOld,'fixed private API URLs/methods/headers/errors unchanged except strict JSON success');
for(const part of ["const state = 'pchat_'",'const verifier = randomBytes(48)','const challenge = createHash',"pending.set(state, {verifier, challenge, createdAt})",'for (const [name, value] of Object.entries({client_id:',"if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(attempt.verifier)","const data = await tokenRequest({grant_type:'authorization_code'",'const requestBody = {client_id:appId,client_secret:appSecret,...body}',"const response = await fetchImpl(tokenEndpoint, {method:'POST'"])assert.equal(line(next,part),line(old,part),'S256/v2 JSON approved path unchanged '+part);
assert.equal(line(next,"const data = await tokenRequest({grant_type:'refresh_token'").trim().replace('record.refreshToken','latest.refreshToken'),line(old,"const data = await tokenRequest({grant_type:'refresh_token'").trim());
assert.deepEqual(Array.from(next.matchAll(/from '([^']+)'/gu),m=>m[1]),['node:crypto','node:fs/promises','node:path']);
assert.equal(line(next,"from 'node:fs/promises'"),"import {mkdir, readFile, rename, open, unlink, rmdir, lstat} from 'node:fs/promises';");
console.log(JSON.stringify({proof:'narrow-original-contract-source-unchanged',oldRawSha256:pinOld,newRawSha256:pinNew,contractGroups:8,notes:'Pinned exact bytes plus whole original crypto/pair/read/api comparisons; not original message-shape safety, real crash durability, HTTP, deployment or business acceptance.'}));
