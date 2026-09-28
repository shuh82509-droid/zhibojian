// Explicit synthetic QA only. Never import a server, scheduler or real store.
import {readFileSync,lstatSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=dirname(fileURLToPath(import.meta.url));
const filenames=['calendar-auth-http.mjs','calendar-auth-http.original.mjs','calendar-auth-http.test.mjs',
  'calendar-user-reader.mjs','reader-http-integration.test.mjs','calendar-http-hold-independent.test.mjs','scope-check.mjs','qa-entry.mjs'];
function bytes(name) {
  assert.ok(filenames.includes(name)||name==='SOURCE-PINS.json');
  const path=resolve(root,name),rel=relative(root,path);assert.ok(rel&&!isAbsolute(rel)&&!rel.startsWith('..'));
  const st=lstatSync(path);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.size<262144);return readFileSync(path);
}
const pins=JSON.parse(bytes('SOURCE-PINS.json').toString('utf8'));
assert.equal(pins.scope,'synthetic_http_durable_hold_consumption');assert.equal(pins.productionApproved,false);
assert.equal(pins.tests,96);assert.equal(pins.formalHttpSha256,'0dfdeee60cce1e553127d889d67e35e5cba14da124771a5e078b0b6bea95c9d4');
assert.equal(pins.candidateHttpSha256,'d8705f422394926bc001351d2f622502cb3df087ac44267c8b974d9b3dbe3d4c');
assert.deepEqual(pins.files.map(item=>item.path).sort(),[...filenames].sort());
for (const item of pins.files) {
  assert.match(item.sha256,/^[a-f0-9]{64}$/u);const raw=bytes(item.path);
  assert.equal(raw.length,item.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),item.sha256,item.path);
}
const env={};
for(const name of ['SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATH','Path','PATHEXT','TEMP','TMP','TMPDIR'])
  if(typeof process.env[name]==='string')env[name]=process.env[name];
env.WIS_CALENDAR_HTTP_MODULE=join(root,'calendar-auth-http.mjs');env.WIS_CALENDAR_HTTP_SHA=pins.candidateHttpSha256;
// No ambient NODE_OPTIONS, arbitrary TARGET_MODULE, grant paths or credentials.
const proof=spawnSync(process.execPath,[join(root,'scope-check.mjs')],{cwd:root,env,encoding:'utf8',timeout:10000,maxBuffer:1048576});
if(proof.error||proof.status!==0){process.stderr.write(proof.stderr||String(proof.error||'scope proof failed'));process.exit(70);}
const value=JSON.parse(proof.stdout);assert.equal(value.proof,'calendar_http_whole_source_reverse_delta');
assert.equal(value.productionApproved,false);assert.equal(value.originalTestsUnchanged,true);assert.equal(value.frozenReaderUnchanged,true);
assert.equal(value.formalSha256,pins.formalHttpSha256);assert.equal(value.candidateSha256,pins.candidateHttpSha256);
process.stdout.write(JSON.stringify(value)+'\n');
const tests=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-timeout=7000',
  join(root,'calendar-auth-http.test.mjs'),join(root,'reader-http-integration.test.mjs'),join(root,'calendar-http-hold-independent.test.mjs')],
  {cwd:root,env,encoding:'utf8',timeout:20000,maxBuffer:2097152});
if(tests.error)throw tests.error;process.stdout.write(tests.stdout||'');process.stderr.write(tests.stderr||'');
const log=tests.stdout||'';assert.equal(tests.status,0);assert.doesNotMatch(log,/^not ok |# (?:SKIP|TODO)/mu);
const ids=[...log.matchAll(/^ok (\d+) -/gmu)].map(item=>Number(item[1]));assert.deepEqual(ids,Array.from({length:96},(_,i)=>i+1));
for (const [name,count] of [['tests',96],['pass',96],['suites',0],['fail',0],['cancelled',0],['skipped',0],['todo',0]])
  assert.equal([...log.matchAll(new RegExp('^# '+name+' (\\d+)$','gmu'))].map(item=>Number(item[1])).join(','),String(count),name);
