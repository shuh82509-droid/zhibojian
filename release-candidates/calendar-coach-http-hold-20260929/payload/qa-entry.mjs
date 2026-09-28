// Explicit frozen source QA only. No default server, network or formal data.
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(readFileSync(join(root,'SOURCE-PINS.json'),'utf8'));
const names=Object.keys(manifest.files);
if(names.length!==11||manifest.productionDeployable!==false)throw Error('unexpected frozen candidate');
const expected=new Set([...names,'SOURCE-PINS.json']);
for(const name of readdirSync(root))if(!expected.has(name)||!lstatSync(join(root,name)).isFile()||lstatSync(join(root,name)).isSymbolicLink())throw Error('unexpected file or directory');
for(const name of names){const raw=readFileSync(join(root,name)),pin=manifest.files[name];if(raw.length!==pin.bytes||createHash('sha256').update(raw).digest('hex')!==pin.sha256)throw Error('frozen pin mismatch: '+name);}
const tests=['scope-check.mjs','coach-http-independent.test.mjs','coach-reader-integration.test.mjs','coach-page-independent.test.mjs'];
const env={...process.env,
 WIS_COACH_HTTP_MODULE:join(root,'coach-calendar-auth.mjs'),WIS_COACH_HTTP_SHA:manifest.files['coach-calendar-auth.mjs'].sha256,
 WIS_COACH_PAGE_TARGET:join(root,'coach-calendar.html'),WIS_COACH_PAGE_SHA:manifest.files['coach-calendar.html'].sha256,
 WIS_COACH_PAGE_ORIGINAL:join(root,'coach-calendar.original.html'),WIS_COACH_PAGE_ORIGINAL_SHA:manifest.files['coach-calendar.original.html'].sha256};
const run=spawnSync(process.execPath,['--test','--test-reporter=tap',...tests],{cwd:root,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
if(run.stdout)process.stdout.write(run.stdout);if(run.stderr)process.stderr.write(run.stderr);
if(run.error)throw run.error;
process.exit(run.status??1);
