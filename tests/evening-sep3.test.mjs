import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {parseRecruitmentMessages,extractAnchorEvaluation,verifiedAnchorEvidence,feishuDocumentLink} from '../lifecycle-engine.mjs';
const require=createRequire(import.meta.url);
const {generateDraft,linkOvernightDrafts,syncDraftRestDays}=require('../runtime/dispatch-center/planning-engine.js');
const {buildWritebackPlan}=require('../runtime/dispatch-center/schedule-api-server.js');
test('Coco reviewer uses its own app-scoped ID and ignores a forged display name',()=>{
 const reviewerOpenId='ou_308a92748ac8b66de306a99b2010d755';
 const parsed=parseRecruitmentMessages([
 {messageId:'a',createdAt:'2026-09-03T03:00:00Z',text:'求职者【张明珠】是否符合【主播】的邀约标准',reactions:{details:[{emojiType:'No',operatorId:reviewerOpenId}]}},
 {messageId:'b',createdAt:'2026-09-04T03:00:00Z',text:'求职者 陈嘉宁 是否符合【主播】的邀约标准',reactions:{details:[{emojiType:'OK',operatorId:reviewerOpenId}]}},
 {messageId:'c',createdAt:'2026-09-04T04:00:00Z',text:'**李保佳**\n颜值4 表现力3.5\n不通过',sender:{id:reviewerOpenId}},
 {messageId:'d',createdAt:'2026-09-04T05:00:00Z',text:'**李保佳**\n颜值4 表现力4\n通过',sender:{id:'different-app',name:'倪梦萍'}}
 ],{reviewerOpenId});
 assert.equal(parsed.candidates.find(x=>x.name==='张明珠').stage,'initial_fail');
 assert.equal(parsed.candidates.find(x=>x.name==='陈嘉宁').stage,'initial_pass');
 assert.equal(parsed.candidates.find(x=>x.name==='李保佳').stage,'interview_fail');
 assert.equal(parsed.submittedCount,2);
});
test('past proposed start dates never prove actual onboarding',()=>{
 const p=parseRecruitmentMessages([{createdAt:'2026-08-21T04:00:00Z',text:'新人主播-何小安接受offer 8.22待入职'}]);
 assert.notEqual(p.candidates[0].stage,'hired');assert.match(p.candidates[0].note,/实际到岗待核验/);
});
test('extracts only one anchor review and excludes operational messages',()=>{
 const text='潘小慧\n开播了\n讲解节奏需要放慢\n赵媛\n互动表现有进步\n收播了';
 assert.equal(extractAnchorEvaluation(text,'潘小慧',['潘小慧','赵媛']),'潘小慧\n讲解节奏需要放慢');
 assert.equal(extractAnchorEvaluation('潘小慧\n开播了','潘小慧',['潘小慧']), '');
 assert.doesNotMatch(extractAnchorEvaluation(text,'赵媛',['潘小慧','赵媛']),/潘小慧|收播/);
});
test('preserves Feishu rich-text links instead of retaining only their label',async()=>{
 const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
 assert.match(server,/text_field_as_array:'true'/);
 const url='https://jqx28l0j4lx.feishu.cn/wiki/HtuJwJoosib1yJkwp7wcgjk1nGh?from=from_copylink';
 assert.equal(feishuDocumentLink([{type:'url',text:'普通主播-陈璐',link:url}]),url);
 assert.equal(feishuDocumentLink('[普通主播]('+url+')'),url);
 assert.equal(feishuDocumentLink('javascript:alert(1)'), '');
});
test('cached anchor snapshots are revalidated and images are not counted as recordings',()=>{
 const now=Date.parse('2026-09-04T06:00:00Z'),base={source:'WIS直播战队',createdAt:'2026-09-03T05:00:00Z'};
 const snapshot={evidenceByAnchor:{潘小慧:{evaluations:[{...base,text:'潘小慧\n讲解节奏需要放慢'},{...base,text:'潘小慧 开播确认\n状态已确认'},{...base,source:'WIS直播学习',text:'潘小慧 话术正常'}],recordings:[{...base,text:'潘小慧',resources:[{type:'image'}]},{...base,text:'潘小慧',resources:[{type:'file',name:'capture.mov'}]},{...base,createdAt:'2026-08-30T05:00:00Z',text:'潘小慧',resources:[{type:'file',name:'old.mp4'}]}]}}};
 const filtered=verifiedAnchorEvidence(snapshot,now);
 assert.equal(filtered.evidenceByAnchor['潘小慧'].evaluations.length,1);
 assert.equal(filtered.evidenceByAnchor['潘小慧'].recordings.length,1);
 assert.equal(snapshot.evidenceByAnchor['潘小慧'].evaluations.length,3);
});
const roster=['甲','乙','丙','丁','戊'].map((name,index)=>({name,rank:index+1,restDates:[]}));
test('both room pairs use rank three, then rank four, and no unrelated substitute',()=>{
 for(const [roomCode,targetRoomCode] of [['youxuan','guanqi'],['wangou','brand_selection']]){
 const draft=generateDraft({roomCode,role:'anchor',startDate:'2026-09-03',endDate:'2026-09-05',roster:roster.map(p=>({...p,restDates:p.rank===3?['2026-09-04','2026-09-05']:p.rank===4?['2026-09-05']:[]}))});
 assert.equal(draft.assignments.find(x=>x.date==='2026-09-03'&&x.shiftCode==='M')?.name,'丙');
 assert.equal(draft.assignments.find(x=>x.date==='2026-09-04'&&x.shiftCode==='M')?.name,'丁');
 assert.equal(draft.assignments.some(x=>x.date==='2026-09-05'&&x.shiftCode==='M'),false);
 assert.ok(draft.assignments.filter(x=>x.shiftCode==='M').every(x=>x.targetRoomCode===targetRoomCode));
 }
});
test('rest sync touches only changed rest cells and restores prior assignments',()=>{
 const draft=generateDraft({roomCode:'guanqi',role:'assistant',startDate:'2026-09-03',endDate:'2026-09-05',roster:[{name:'助理甲',restDates:[]},{name:'助理乙',restDates:[]}]});
 const next=syncDraftRestDays(draft,[{name:'助理甲',restDates:['2026-09-04'],entitlement:6}]);
 assert.equal(next.changes.length,1);
 const unaffected=draft.assignments.filter(x=>!(x.name==='助理甲'&&x.date==='2026-09-04'));
 assert.deepEqual(next.draft.assignments.filter(x=>!(x.name==='助理甲'&&x.date==='2026-09-04')),unaffected);
 const restored=syncDraftRestDays(next.draft,[{name:'助理甲',restDates:[],entitlement:6}]);
 assert.deepEqual(restored.draft.assignments,draft.assignments);
});
test('partner linking changes only overnight and preserves normal shifts',()=>{
 const source=generateDraft({roomCode:'youxuan',role:'anchor',startDate:'2026-09-03',endDate:'2026-09-04',roster});
 const target=generateDraft({roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-05',roster:roster.map(p=>({...p,name:'官旗'+p.name}))});
 const original=target.assignments.filter(x=>!(source.dates.includes(x.date)&&x.shiftCode==='M'));
 const result=linkOvernightDrafts(source,{target});
 assert.deepEqual(result.drafts.target.assignments.filter(x=>!x.linkedFrom),original);
 assert.equal(result.linkedKeys.length,1);
 assert.equal(result.drafts.target.assignments.filter(x=>x.linkedFrom==='youxuan').length,2);
 assert.deepEqual(target.assignments.filter(x=>!(source.dates.includes(x.date)&&x.shiftCode==='M')),original);
});
test('saving a partner created later also resolves source-owned overnight cells',()=>{
 const source=generateDraft({roomCode:'wangou',role:'anchor',startDate:'2026-09-03',endDate:'2026-09-04',roster});
 const target=generateDraft({roomCode:'brand_selection',role:'anchor',startDate:'2026-09-03',endDate:'2026-09-04',roster:roster.map(p=>({...p,name:'精选'+p.name}))});
 const result=linkOvernightDrafts(target,{source,target});
 assert.equal(result.drafts.target.assignments.filter(x=>x.linkedFrom==='wangou').length,2);
 assert.deepEqual(result.drafts.source,source);
});

test('resource ordering follows entered scores while first rank rotates',()=>{
 const draft=generateDraft({roomCode:'wangou',role:'anchor',startDate:'2026-09-03',endDate:'2026-09-10',roster,resourceScores:{R:10,X:50,B3:30,M:5}});
 assert.deepEqual(draft.shifts,['X','B3','R','M']);
 assert.ok(new Set(draft.assignments.filter(x=>x.name==='甲'&&!x.rest).map(x=>x.shiftCode)).size>1);
});
test('visual uploads and cue cards use real storage with download and safe formats',async()=>{
 const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
 const visuals=await readFile(new URL('../exports/material-center/material-visuals.html',import.meta.url),'utf8');
 const visualClient=await readFile(new URL('../exports/material-center/material-visuals.js',import.meta.url),'utf8');
 const cues=await readFile(new URL('../exports/material-center/material-cue-cards.html',import.meta.url),'utf8');
 assert.match(server,/Content-Disposition/);assert.match(server,/invalid_folder/);assert.match(server,/serializeMaterial/);
 for(const theme of ['大促主题','品牌色平销','特殊内容场']){assert.match(visuals,new RegExp(theme));assert.match(server,new RegExp(theme))}
 assert.match(visualClient,/themeFolders/);assert.doesNotMatch(visuals,/夏季直播主视觉|PSD · 28 MB/);assert.match(visuals,/webkitdirectory/);assert.match(cues,/data-quick-save/);assert.match(cues,/data-delete/);assert.match(cues,/method:'DELETE'/);assert.match(server,/deletedCards/);assert.match(cues,/download=1/);
});

test('learning media uses the authorized chat id and avoids unsupported inline-video black screens',async()=>{
 const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
 const makeup=await readFile(new URL('../exports/material-center/material-makeup.html',import.meta.url),'utf8');
 assert.match(server,/oc_a5640cee560bb4078ded95fc2278c329/);
 assert.match(server,/getChatMessages\('learning', 200/);
 assert.match(makeup,/dataset\.liveLearningLoaded/);
 assert.match(makeup,/pairedVideos/);
 assert.match(makeup,/截图预览 · 打开原始录屏/);
 assert.match(makeup,/anchor-recording-fallback/);
 assert.doesNotMatch(makeup,/<video\b/);
 assert.match(makeup,/王鸥美肤/);
});
test('charts keep missing values as gaps and pin accessible data details',async()=>{
 const chart=await readFile(new URL('../runtime/data-center/app/metric-trend.tsx',import.meta.url),'utf8');
 assert.match(chart,/connected=false/);assert.match(chart,/setPinned\(true\)/);assert.match(chart,/GMV（元）/);assert.match(chart,/ROI（倍）/);assert.match(chart,/conversion"\?3/);assert.match(chart,/role="button"/);
});
test('recruitment uses one candidate population and anchor cards do not show legacy reviews',async()=>{
 const recruitment=await readFile(new URL('../exports/recruitment-pool/recruitment-dashboard.html',import.meta.url),'utf8');
 const anchors=await readFile(new URL('../exports/anchor-archives/recruitment-dashboard.html',import.meta.url),'utf8');
 assert.match(recruitment,/inSubmissionCohort===true/);
 assert.match(recruitment,/facts\.initialPassedCount/);
 assert.match(recruitment,/送审人次单独统计/);
 assert.doesNotMatch(anchors,/<div class="comment">\$\{esc\(host.comment\)\}/);
 assert.doesNotMatch(anchors,/const notes=\(D.notes/);
});
