// Read-only scope proof; no server imports or file writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir=process.env.WIS_REVIEWTEXT_CANDIDATE || 'H:/codex输出/直播五环节工作流-20260923/calendar-reviewtext-exact-20260928/candidate-2042';
const read=name=>readFileSync(`${dir}/${name}`,'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
const replaceInterval=(text,start,end)=>{
  const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,`explicit scope ${start} -> ${end}`);
  return text.slice(0,a)+`/* permitted: ${start} */\n`+text.slice(b);
};
const stripEngine=text=>{
  let value=text.replace(/^import \{inspectRecruitmentContent,inspectReviewText,inspectSubmissionSlots\} from '\.\/recruitment-content\.mjs';\r?\n/mu,'');
  value=replaceInterval(value,'function recruitmentSubmissionIdentity(','function offerEvent(');
  return replaceInterval(value,'export function parseRecruitmentMessages(','function calendarTitleNamesPerson(');
};
const stripServer=text=>{
  let value=text.replace(/^import \{projectRecruitmentMessageContent\} from '\.\/recruitment-content\.mjs';\r?\n/mu,'');
  // Exactly four narrow readback/calendar-stage guards; do not mask whole lifecycle handlers.
  const marker='parsed.reviewBindingVerified===true && ';
  const count=value.split(marker).length-1;
  assert.ok(count===0||count===4,'only four named group-A unbound-review readback guards');
  value=value.split(marker).join('');
  return replaceInterval(value,'async function getChatMessages(','async function findChatByName(');
};
const engine=read('lifecycle-engine.mjs'),engineBase=read('lifecycle-engine.base.mjs');
const server=read('server.js'),serverBase=read('server.base.js');
assert.equal(hash(stripEngine(engine)),hash(stripEngine(engineBase)),'engine bytes outside named group-A intervals unchanged');
const scopedServer=stripServer(server),scopedServerBase=stripServer(serverBase);
if(scopedServer!==scopedServerBase){
  let first=0;while(scopedServer[first]===scopedServerBase[first]&&first<Math.min(scopedServer.length,scopedServerBase.length))first+=1;
  console.log(JSON.stringify({scopeMismatch:'server',scopedLine:scopedServer.slice(0,first).split('\n').length,scopedBaseLine:scopedServerBase.slice(0,first).split('\n').length,scopedLength:scopedServer.length,scopedBaseLength:scopedServerBase.length}));
}
assert.equal(hash(scopedServer),hash(scopedServerBase),'server bytes outside import/getChatMessages interval unchanged');
console.log(JSON.stringify({status:'scope_pass',engineSha:hash(engine),engineBaseSha:hash(engineBase),serverSha:hash(server),serverBaseSha:hash(serverBase)},null,2));
