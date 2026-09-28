import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const base=readFileSync(new URL('./lifecycle-engine.base.mjs',import.meta.url),'utf8');
const draft=readFileSync(new URL('./lifecycle-engine.mjs',import.meta.url),'utf8');
const addedImport="import {inspectRecruitmentContent,inspectReviewText,inspectSubmissionSlots} from './recruitment-content.mjs';\n";
const ranges=[['function recruitmentSubmissionIdentity(','function offerEvent('],
  ['export function parseRecruitmentMessages(','function calendarTitleNamesPerson(']];
function range(text,start,end){const from=text.indexOf(start),to=text.indexOf(end,from);
  assert.ok(from>=0&&to>from);assert.equal(text.indexOf(start,from+start.length),-1);return {from,to};}
let result=base;
for(const [start,end] of ranges){const a=range(result,start,end),b=range(draft,start,end);
  result=result.slice(0,a.from)+draft.slice(b.from,b.to)+result.slice(a.to);}
assert.ok(draft.includes(addedImport.trim()));
const firstBreak=result.indexOf('\n');assert.ok(firstBreak>0);
assert.equal(result.slice(0,firstBreak).trim(),"import {createHash} from 'node:crypto';");
result=result.slice(0,firstBreak+1)+addedImport+result.slice(firstBreak+1);
assert.ok(result.includes(addedImport));
function outside(text){text=text.replace(addedImport,'');for(const [start,end] of ranges){const {from,to}=range(text,start,end);text=text.slice(0,from)+text.slice(to);}return text;}
assert.equal(outside(result),outside(base));
writeFileSync(new URL('./lifecycle-engine.mjs',import.meta.url),result);
console.log('Approved engine import and two ranges only; all other original mixed-newline bytes preserved.');
