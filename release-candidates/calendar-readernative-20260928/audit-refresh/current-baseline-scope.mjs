// Read-only, exact whole-source baseline proof. Never imports the reader.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const actual=readFileSync(new URL('../base/calendar-user-reader.formal.mjs',import.meta.url));
const previous=readFileSync(new URL('../base/calendar-user-reader.original.mjs',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(actual),'75067a7fd85d827d43d6f439a6c5a81f156f1358a64defec13a75d45b68be630');
assert.equal(sha(previous),'a2dc5930d00b37113c98c515dbe9e43682e0ec49b0280f8dc76095720f5e7f97');
assert.equal(actual.length,16252);
assert.equal(previous.length,16058);
const text=new TextDecoder('utf-8',{fatal:true}).decode(actual);
assert.deepEqual(Buffer.from(text,'utf8'),actual,'UTF-8 decoding must round-trip without BOM removal');
assert.equal(text.includes('\u0000'),false);
assert.equal(/\r(?!\n)/u.test(text),false,'bare CR is not a permitted baseline difference');
assert.equal((text.match(/\r\n/gu)||[]).length,195);
assert.equal((text.match(/\n/gu)||[]).length,206);
assert.equal(text.endsWith('}\r\n'),true);
// The only allowed transformation is these 195 CRLFs and one appended EOF LF.
// Compare the entire file, not selected sections or ignored whitespace.
assert.deepEqual(Buffer.from(text.replace(/\r\n/gu,'\n')+'\n','utf8'),previous);
process.stdout.write(JSON.stringify({scope:'exact_baseline_equivalence_passed',actualSha:sha(actual),previousSha:sha(previous),crlfReplacements:195,appendedEofLf:1,wholeSourceEquivalent:true,productionApproved:false})+'\n');
