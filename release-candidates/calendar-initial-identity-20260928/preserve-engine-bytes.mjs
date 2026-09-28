import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const base=readFileSync(new URL('./lifecycle-engine.base.mjs',import.meta.url),'utf8');
const draft=readFileSync(new URL('./lifecycle-engine.mjs',import.meta.url),'utf8');
const ranges=[['function reviewerReaction(','function interviewEvaluation('],
  ['export function parseRecruitmentMessages(','function calendarTitleNamesPerson(']];
function range(text,start,end){const from=text.indexOf(start),to=text.indexOf(end,from);
  assert.ok(from>=0&&to>from);assert.equal(text.indexOf(start,from+start.length),-1);return {from,to};}
let result=base;
for(const [start,end] of ranges){const a=range(result,start,end),b=range(draft,start,end);
  // Mechanical byte-preserving reconstruction of the two explicitly patched
  // ranges: all other mixed CRLF/LF bytes come from the frozen base unchanged.
  result=result.slice(0,a.from)+draft.slice(b.from,b.to)+result.slice(a.to);}
function outside(text){for(const [start,end] of ranges){const {from,to}=range(text,start,end);text=text.slice(0,from)+text.slice(to);}return text;}
assert.equal(outside(result),outside(base));
writeFileSync(new URL('./lifecycle-engine.mjs',import.meta.url),result);
console.log('Two target ranges reconstructed; every outside byte matches the frozen prior candidate.');
