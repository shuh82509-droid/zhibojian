// Source-only synthetic QA entry. Never launches the app or default server.
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root=dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(readFileSync(join(root,'SOURCE-PINS.json'),'utf8'));
assert.equal(manifest.schemaVersion,1);
assert.equal(manifest.productionApproved,false);
assert.equal(manifest.expectedTests,415);
assert.equal(manifest.files.length,16);
for(const item of manifest.files){
  assert.match(item.path,/^[A-Za-z0-9][A-Za-z0-9._/-]+$/u);
  assert.ok(!item.path.split('/').includes('..'));
  assert.match(item.sha256,/^[a-f0-9]{64}$/u);
  const path=resolve(root,item.path),stat=lstatSync(path);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink());
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),item.sha256,item.path);
}
assert.equal(new Set(manifest.files.map(item=>item.path)).size,manifest.files.length);
// Do not pass ambient app credentials or NODE_OPTIONS into a child/worker.
const runtimeEnv={};
for(const name of ['PATH','HOME','TMPDIR','TMP','TEMP','SystemRoot','SYSTEMROOT','ComSpec']){
  if(typeof process.env[name]==='string')runtimeEnv[name]=process.env[name];
}
const run=(args,env)=>{
  const result=spawnSync(process.execPath,args,{cwd:root,env:{...runtimeEnv,...env},encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  assert.equal(result.error,undefined,'QA process failed or exceeded a bound');
  assert.equal(result.signal,null,'QA process was interrupted');
  assert.equal(result.status,0,'Synthetic QA failed; not releasable');
  return result.stdout;
};
const baselineOutput=run(['audit-refresh/current-baseline-scope.mjs'],{});
const baseline=JSON.parse(baselineOutput.trim());
assert.equal(baseline.scope,'exact_baseline_equivalence_passed');
assert.equal(baseline.actualSha,manifest.formalReaderBaseSha256);
assert.equal(baseline.previousSha,manifest.previousReaderBaseSha256);
assert.equal(baseline.wholeSourceEquivalent,true);
assert.equal(baseline.productionApproved,false);
const scopeOutput=run(['audit-refresh/source-scope.mjs'],{
  WIS_READER_REFRESH_MODULE:join(root,'base/calendar-user-reader.mjs'),
  WIS_READER_REFRESH_BASE:join(root,'base/calendar-user-reader.original.mjs'),
  WIS_READER_REFRESH_SHA:manifest.baseReaderSha256
});
assert.equal(JSON.parse(scopeOutput.trim()).unchangedSections,16);
const output=run(['--test','--test-reporter=tap','--test-concurrency=1',
  'base/refresh-safe.test.mjs','pure/native-calendar-source.test.mjs',
  'native-reader/native-reader.test.mjs','audit-refresh/refresh-independent.test.mjs',
  'audit-native-source/native-independent.test.mjs','audit-native-reader/native-independent.test.mjs'],{
  WIS_READER_REFRESH_MODULE:join(root,'native-reader/calendar-user-reader.mjs'),
  WIS_READER_REFRESH_SHA:manifest.nativeReaderSha256,
  WIS_NATIVE_SOURCE_MODULE:join(root,'pure/native-calendar-source.mjs'),
  WIS_NATIVE_SOURCE_SHA:manifest.nativeSourceSha256,
  WIS_NATIVE_READER_MODULE:join(root,'native-reader/calendar-user-reader.mjs'),
  WIS_NATIVE_READER_SHA:manifest.nativeReaderSha256
});
const metric=name=>Number([...output.matchAll(new RegExp('^# '+name+' (\\d+)$','gm'))].at(-1)?.[1]);
assert.equal(metric('tests'),415);
assert.equal(metric('pass'),415);
for(const name of ['fail','cancelled','skipped','todo'])assert.equal(metric(name),0,name);
process.stdout.write('FROZEN_SYNTHETIC_QA=415/415; SCOPE_CHECKS=16; EXACT_CURRENT_BASELINE_EQUIVALENCE=true; PRODUCTION_APPROVED=false\n');
