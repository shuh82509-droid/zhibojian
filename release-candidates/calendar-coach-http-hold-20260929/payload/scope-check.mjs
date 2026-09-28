import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=name=>readFileSync(new URL(name,import.meta.url));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const original=read('./coach-calendar-auth.original.mjs');
const candidate=read('./coach-calendar-auth.mjs');
const oldText=new TextDecoder('utf-8',{fatal:true}).decode(original);
const newText=new TextDecoder('utf-8',{fatal:true}).decode(candidate);
const lf=text=>text.replace(/\r\n/g,'\n');
const block=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert(a>=0&&b>a);assert.equal(text.indexOf(start,a+1),-1);return text.slice(a,b).trimEnd();};
test('entire exact mixed-newline reference is pinned and reversibly normalized, not a stale checkout',()=>{
 assert.equal(original.length,5586);assert.equal(sha(original),'b4da4dfc4bedb50e21aaa545d0a0cde74faf513b327732a11619b854c4b99859');
 const endings=[...oldText.matchAll(/\r?\n/g)].map(match=>match[0]);
 assert.equal(endings.filter(value=>value==='\r\n').length,65);assert.equal(endings.filter(value=>value==='\n').length,3);
 let index=0;const restored=lf(oldText).replace(/\n/g,()=>endings[index++]);
 assert.equal(index,endings.length);assert(Buffer.from(restored,'utf8').equals(original));
});
test('registered callback, cookie paths and unknown-state routing remain exact',()=>{
 for(const line of ["const cookieName = 'live_coach_calendar_oauth_state';","const callbackPath = '/api/lifecycle/calendar-auth/callback';",
 "const statusPath = '/api/lifecycle/coach-calendar-auth/status';","const startPath = '/api/lifecycle/coach-calendar-auth/start';"]){assert(lf(oldText).includes(line));assert(newText.includes(line));}
 assert(newText.includes('HttpOnly; Secure; SameSite=Lax'));
 assert.match(newText,/if \(!item\) return false;/);
 assert.doesNotMatch(newText,/public-consent|invite[_-]token|recover\w*\s*\(|unlock\w*\s*\(|unlink\s*\(|rmdir\s*\(/i);
});
test('incumbent callback HTML/CSP and same-origin guard unchanged as whole functions',()=>{
 assert.equal(block(lf(oldText),'  function page(','  function sameOrigin('),block(newText,'  function page(','  function sameOrigin('));
 assert.equal(block(lf(oldText),'  function sameOrigin(','  async function handleApi('),block(newText,'  function sameOrigin(','  async function callbackFailure('));
});
test('incumbent coach page outside script is byte-for-byte unchanged',()=>{
 const old=read('./coach-calendar.original.html'),next=read('./coach-calendar.html');
 assert.equal(sha(old),'e8007e507a7c35ca1812eda829a2b29bc89713b7e945f414d12930dffc4faebb');
 const parts=raw=>{const text=raw.toString('utf8'),a=text.indexOf('<script>'),b=text.indexOf('</script>');assert(a>0&&b>a);return [text.slice(0,a),text.slice(b)];};
 assert.deepEqual(parts(next),parts(old));
});
test('frozen durable dependency is exact previously reviewed reader, not current private reader',()=>{
 assert.equal(sha(read('./calendar-user-reader.mjs')),'9cbc9be0152abace6365d3f0dadef864dc9402e4b055e26a9d19424c09597912');
 assert.doesNotMatch(newText,/private.chat|lifecycle-engine|from\s*['"]/);
});
test('exact candidate manifest pins every explicit file before test import',()=>{
 const manifest=JSON.parse(read('./SOURCE-PINS.json'));
 assert.equal(manifest.schemaVersion,1);assert.equal(manifest.productionDeployable,false);assert.equal(manifest.actualCoachSource,'b4da4dfc4bedb50e21aaa545d0a0cde74faf513b327732a11619b854c4b99859');
 for(const [name,pin] of Object.entries(manifest.files)){assert.match(name,/^[A-Za-z0-9][A-Za-z0-9._-]+$/);const raw=read('./'+name);assert.equal(raw.length,pin.bytes,name);assert.equal(sha(raw),pin.sha256,name);}
});
