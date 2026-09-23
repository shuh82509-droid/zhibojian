import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
assert.equal(process.env.CANDIDATE_ISOLATED_TEST,'1','Never run against production storage');
const base='http://127.0.0.1:3000/fd-027340/live-center-workbench/api';
const folder='候选验收专用-不发布';
async function post(path,body){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
assert.equal((await post('/material-assets',{kind:'visual',action:'create_folder',folder})).status,200);
assert.equal((await post('/material-assets',{kind:'visual',action:'create_folder',folder:'../outside'})).status,422);
const extensions='png jpg jpeg webp gif bmp tif tiff heic svg pdf txt csv psd ai eps doc docx xls xlsx ppt pptx zip rar 7z mp4 mov webm mp3 wav m4a'.split(' ');
const sample=Buffer.from('Candidate storage roundtrip fixture. Not a business document.\n');
for(const ext of extensions){
 const payload={kind:'visual',folder,name:'candidate-format.'+ext,dataUrl:'data:application/octet-stream;base64,'+sample.toString('base64')};
 const result=await post('/material-assets',payload);assert.equal(result.status,200,ext+': '+JSON.stringify(result.body));
 const download=await fetch(base+'/material-assets/'+result.body.asset.id+'?download=1');
 assert.match(download.headers.get('content-disposition'),/^attachment/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),sample);
 assert.equal((await post('/material-assets',payload)).body.deduplicated,true);
}
const large=Buffer.alloc(12*1024*1024,65);
assert.equal((await post('/material-assets',{kind:'visual',folder,name:'candidate-large.zip',dataUrl:'data:application/zip;base64,'+large.toString('base64')})).status,200);
assert.equal((await post('/material-assets',{kind:'cue-card',name:'invalid.png',dataUrl:'data:image/png;base64,'+sample.toString('base64')})).status,422);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ9sAAAAASUVORK5CYII=','base64');
const image=await post('/material-assets',{kind:'cue-card',name:'candidate.png',dataUrl:'data:image/png;base64,'+png.toString('base64')});assert.equal(image.status,200);
const card=await post('/material-cards',{title:'候选测试卡-不发布',room:'通用',category:'验收',products:['验收'],tags:['数据','自定义验收','数据'],coverUrl:image.body.asset.url,status:'draft'});
assert.equal(card.status,200,JSON.stringify(card.body));
const saved=card.body.card;assert.ok(saved.id);assert.equal(new Set(saved.tags).size,saved.tags.length);
const edited=await post('/material-cards',{...saved,title:'候选测试卡-第二版',expectedVersion:saved.version,status:'draft'});assert.equal(edited.status,200);
const conflict=await post('/material-cards',{...saved,title:'过时编辑不得覆盖',expectedVersion:saved.version});assert.equal(conflict.status,409);
const downloaded=await fetch(base+'/material-assets/'+image.body.asset.id+'?download=1');
assert.equal(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'),createHash('sha256').update(png).digest('hex'));
console.log(JSON.stringify({passed:true,formatRoundTrips:extensions.length,largeFileMiB:12,idempotence:true,folderTraversalRejected:true,invalidImageRejected:true,versionConflictProtected:true,productionWrites:0}));
