// Exact source-only regression: no server listener, formal store or provider.
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const manifestPath=join(root,'SOURCE-PINS.json'),manifestInfo=lstatSync(manifestPath);
if(!manifestInfo.isFile()||manifestInfo.isSymbolicLink())throw Error('non-regular manifest');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const names=Object.keys(manifest.files);
const expected=['private-chat-reader.mjs','private-chat-auth.mjs','private-chat.html',
 'private-chat-reader-original.mjs','private-chat-auth-original.mjs','private-chat-original.html',
 'private-reader-risk.test.mjs','private-http-independent.test.mjs','private-page-independent.test.mjs',
 'private-reader-http-native.test.mjs','private-reader-scope.mjs','qa-entry.mjs','README.md'];
if(manifest.schemaVersion!==1||manifest.productionDeployable!==false||names.length!==expected.length
 ||names.some(name=>!expected.includes(name)))throw Error('unexpected exact source payload');
const inventory=new Set([...names,'SOURCE-PINS.json']);
const actual=readdirSync(root);
if(actual.length!==inventory.size)throw Error('missing payload entry');
for(const name of actual){
 const info=lstatSync(join(root,name));
 if(!inventory.has(name)||!info.isFile()||info.isSymbolicLink())throw Error('unexpected payload entry');
}
for(const name of names){
 const info=lstatSync(join(root,name));
 if(!info.isFile()||info.isSymbolicLink())throw Error('non-regular manifest entry');
 const raw=readFileSync(join(root,name)),pin=manifest.files[name];
 if(raw.length!==pin.bytes||createHash('sha256').update(raw).digest('hex')!==pin.sha256)throw Error('raw byte pin mismatch: '+name);
}
const env={...process.env,
 WIS_PRIVATE_READER_MODULE:join(root,'private-chat-reader.mjs'),WIS_PRIVATE_READER_SHA:manifest.files['private-chat-reader.mjs'].sha256,
 WIS_PRIVATE_ORIGINAL_READER_MODULE:join(root,'private-chat-reader-original.mjs'),
 WIS_PRIVATE_HTTP_MODULE:join(root,'private-chat-auth.mjs'),WIS_PRIVATE_HTTP_SHA:manifest.files['private-chat-auth.mjs'].sha256,
 WIS_PRIVATE_HTTP_ORIGINAL:join(root,'private-chat-auth-original.mjs'),WIS_PRIVATE_HTTP_ORIGINAL_SHA:manifest.files['private-chat-auth-original.mjs'].sha256,
 WIS_PRIVATE_PAGE_TARGET:join(root,'private-chat.html'),WIS_PRIVATE_PAGE_SHA:manifest.files['private-chat.html'].sha256,
 WIS_PRIVATE_PAGE_ORIGINAL:join(root,'private-chat-original.html'),WIS_PRIVATE_PAGE_ORIGINAL_SHA:manifest.files['private-chat-original.html'].sha256};
function run(args){
 const result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',timeout:45000,maxBuffer:3*1024*1024});
 if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
 if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
}
// These eight source-comparison groups are not counted as TAP test cases.
run(['private-reader-scope.mjs']);
run(['--experimental-vm-modules','--test','--test-reporter=tap',
 'private-reader-risk.test.mjs','private-http-independent.test.mjs',
 'private-page-independent.test.mjs','private-reader-http-native.test.mjs']);
