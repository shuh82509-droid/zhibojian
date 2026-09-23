import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseRecruitmentMessages} from '../lifecycle-engine.mjs';
const reviewerOpenId='verified-reviewer';
const submit=(name,emoji,date='2026-09-01')=>({createdAt:date+'T08:00:00+08:00',messageId:name+date,text:`面试官好，麻烦看一下求职者【${name}】是否符合【主播】的邀约标准`,reactions:{details:emoji?[{operatorId:reviewerOpenId,emojiType:emoji}]:[]}});
const evaluation=name=>({createdAt:'2026-09-02T08:00:00+08:00',messageId:name+'eval',sender:{id:reviewerOpenId},text:name+'\n颜值 8\n- 通过'});
test('submission cohort excludes unmatched evaluations and never infers OK from interview or offer',()=>{
 const result=parseRecruitmentMessages([submit('张三','OK'),submit('李四',null),evaluation('李四'),evaluation('王五'),{createdAt:'2026-09-03T08:00:00+08:00',text:'新人主播-赵六接受offer9.7待入职'},submit('张三','OK','2026-09-04')],{reviewerOpenId});
 assert.deepEqual(result.funnel,{candidateCount:2,initialPassedCount:1,initialFailedCount:0,initialPendingCount:1,groupEvaluatedCount:1,groupPassedCount:1,unmatchedCount:2});
 assert.equal(result.submittedCount,3);assert.equal(result.candidates.length,4);
 assert.equal(result.candidates.find(x=>x.name==='王五').inSubmissionCohort,false);
 assert.equal(result.candidates.find(x=>x.name==='李四').submissionEvidence.initialReview,null);
});
test('non-reviewer reactions and forged display names do not qualify',()=>{
 const fake=submit('张三','OK');fake.reactions.details[0].operatorId='other';
 const result=parseRecruitmentMessages([fake],{reviewerOpenId});
 assert.equal(result.funnel.initialPassedCount,0);
});
test('rolling seven days crosses month with missing-day gap, not zero',async()=>{
 const source=await readFile(new URL('../exports/anchor-archives/recruitment-dashboard.html',import.meta.url),'utf8');
 const fn=source.match(/function rollingTrendPoints\(name\)\{[\s\S]*?\n\}/)[0];
 const context=vm.createContext({sevenDayTrends:{endDate:'2026-09-04',series:{'丁阳虹':[{date:'2026-08-29',gmv:100},{date:'2026-09-04',gmv:200}]}}});
 const points=vm.runInContext(fn+';rollingTrendPoints("丁阳虹")',context);
 assert.equal(points.length,7);assert.equal(points[0].date,'2026-08-29');assert.equal(points[0].gmv,100);
 assert.equal(points[2].date,'2026-08-31');assert.equal(points[2].gmv,null);
 assert.doesNotMatch(source,/D\.reviewCounts\[[^\]]+\]\|\|0/);
 assert.match(source,/Promise\.all\(\[read\(days\),read\(7\)\]\)/);
});
test('all selected metrics have separate readable value rows and cards load has timeout recovery',async()=>{
 const chart=await readFile(new URL('../runtime/data-center/app/metric-trend.tsx',import.meta.url),'utf8');
 assert.match(chart,/逐点数值/);assert.doesNotMatch(chart,/length===1&&/);
 const cards=await readFile(new URL('../exports/material-center/material-cue-cards.html',import.meta.url),'utf8');
 assert.match(cards,/AbortSignal.timeout\(15000\)/);assert.match(cards,/重新读取手卡/);
 for(const path of ['../exports/anchor-archives/recruitment-dashboard.html','../exports/recruitment-pool/recruitment-dashboard.html','../exports/material-center/material-cue-cards.html']){
  const html=await readFile(new URL(path,import.meta.url),'utf8');
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 }
});
