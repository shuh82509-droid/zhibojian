// Code-only paired source regression. Never import the production server/store.
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
function bytes(path){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink())throw Error('non-regular source payload');return readFileSync(path);}
const names=['private-chat-reader.mjs','private-source-author.test.mjs','private-source-counterexamples.test.mjs',
  'private-source-independent.test.mjs','qa-entry.mjs','README.md'];
const inventory=[...names,'SOURCE-PINS.json','.gitattributes'];
const actual=readdirSync(root).sort();
if(JSON.stringify(actual)!==JSON.stringify([...inventory].sort()))throw Error('unexpected exact candidate inventory');
const manifest=JSON.parse(bytes(join(root,'SOURCE-PINS.json')));
if(manifest.schemaVersion!==1||manifest.productionDeployable!==false
  ||JSON.stringify(Object.keys(manifest.files).sort())!==JSON.stringify([...names,'.gitattributes'].sort()))throw Error('unexpected manifest');
for(const name of [...names,'.gitattributes']){
 const raw=bytes(join(root,name)),pin=manifest.files[name];
 if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)throw Error('candidate pin mismatch: '+name);
}
const base=process.env.WIS_PRIVATE_BASE_PAYLOAD?resolve(process.env.WIS_PRIVATE_BASE_PAYLOAD)
  :resolve(root,'../private-chat-hold-20260929/payload');
const baseManifest=bytes(join(base,'SOURCE-PINS.json'));
if(hash(baseManifest)!=='0373e6f5227dec5e78bbcda7074ec7653b3f1f8984cfd7f03bfa95d42176a539')throw Error('base manifest pin mismatch');
const previous=JSON.parse(baseManifest),oldNames=Object.keys(previous.files);
const fixedOld=['private-chat-reader.mjs','private-chat-auth.mjs','private-chat.html','private-chat-reader-original.mjs',
 'private-chat-auth-original.mjs','private-chat-original.html','private-reader-risk.test.mjs','private-http-independent.test.mjs',
 'private-page-independent.test.mjs','private-reader-http-native.test.mjs','private-reader-scope.mjs','qa-entry.mjs','README.md'];
if(previous.schemaVersion!==1||previous.productionDeployable!==false
  ||JSON.stringify(oldNames.sort())!==JSON.stringify(fixedOld.sort())
  ||JSON.stringify(readdirSync(base).sort())!==JSON.stringify([...fixedOld,'SOURCE-PINS.json'].sort()))throw Error('base inventory drift');
for(const name of fixedOld){const raw=bytes(join(base,name)),pin=previous.files[name];
 if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)throw Error('base file pin mismatch: '+name);}
const old=bytes(join(base,'private-chat-reader.mjs')),next=bytes(join(root,'private-chat-reader.mjs'));
const marker=Buffer.from('  async function readMessages({startTime,endTime}) {');
const tail=Buffer.from('  return {status, begin, complete, verify, readMessages};');
const oldStart=old.indexOf(marker),nextStart=next.indexOf(marker),oldEnd=old.indexOf(tail),nextEnd=next.indexOf(tail);
if([oldStart,nextStart,oldEnd,nextEnd].some(x=>x<0)
 ||!old.subarray(0,oldStart).equals(next.subarray(0,nextStart))
 ||!old.subarray(oldEnd).equals(next.subarray(nextEnd)))throw Error('change escaped readMessages boundary');
process.stdout.write('scope-proof: full auth prefix and public-method suffix are byte-identical to 9b74 base\n');
const reader=join(root,'private-chat-reader.mjs'),readerSha=hash(next);
// Retain only basic execution/temp variables. Fixtures inject all provider calls.
const environment={};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','TMPDIR'])
 if(process.env[key]!==undefined)environment[key]=process.env[key];
Object.assign(environment,{
 WIS_PRIVATE_READER_MODULE:reader,WIS_PRIVATE_READER_SHA:readerSha,
 WIS_PRIVATE_SOURCE_READER_MODULE:reader,WIS_PRIVATE_SOURCE_READER_SHA:readerSha,
 WIS_PRIVATE_SOURCE_MODULE:reader,WIS_PRIVATE_SOURCE_SHA:readerSha,
 WIS_PRIVATE_HTTP_MODULE:join(base,'private-chat-auth.mjs'),WIS_PRIVATE_HTTP_SHA:previous.files['private-chat-auth.mjs'].sha256,
 WIS_PRIVATE_HTTP_ORIGINAL:join(base,'private-chat-auth-original.mjs'),WIS_PRIVATE_HTTP_ORIGINAL_SHA:previous.files['private-chat-auth-original.mjs'].sha256,
 WIS_PRIVATE_PAGE_TARGET:join(base,'private-chat.html'),WIS_PRIVATE_PAGE_SHA:previous.files['private-chat.html'].sha256,
 WIS_PRIVATE_PAGE_ORIGINAL:join(base,'private-chat-original.html'),WIS_PRIVATE_PAGE_ORIGINAL_SHA:previous.files['private-chat-original.html'].sha256
});
const tests=['private-reader-risk.test.mjs','private-http-independent.test.mjs','private-page-independent.test.mjs',
 'private-reader-http-native.test.mjs'].map(name=>join(base,name));
tests.push(...['private-source-author.test.mjs','private-source-counterexamples.test.mjs','private-source-independent.test.mjs'].map(name=>join(root,name)));
const result=spawnSync(process.execPath,['--experimental-vm-modules','--test','--test-reporter=tap',...tests],
 {cwd:root,env:environment,encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024});
if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
const expected=509,matches=pattern=>[...result.stdout.matchAll(pattern)];
for(const [name,value]of [['tests',expected],['pass',expected],['fail',0],['cancelled',0],['skipped',0],['todo',0]]){
 const summary=matches(new RegExp('^# '+name+' (\\d+)\\r?$','gm'));
 if(summary.length!==1||Number(summary[0][1])!==value)throw Error('regression summary not exact: '+name);
}
const ok=matches(/^ok (\d+) - /gm),bad=matches(/^not ok /gm),plans=matches(/^1\.\.(\d+)\r?$/gm);
if(ok.length!==expected||bad.length!==0||plans.length!==1||Number(plans[0][1])!==expected
 ||ok.some((m,i)=>Number(m[1])!==i+1))throw Error('regression TAP plan/results not continuous');
