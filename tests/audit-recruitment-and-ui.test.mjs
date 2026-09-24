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
 assert.deepEqual(result.funnel,{candidateCount:2,initialPassedCount:0,initialFailedCount:0,initialPendingCount:2,groupEvaluatedCount:1,groupPassedCount:1,unmatchedCount:2});
 assert.equal(result.submittedCount,3);assert.equal(result.candidates.length,4);
 assert.equal(result.candidates.find(x=>x.name==='张三').stage,'unmapped');
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

test('structured assessment UI is closed by default and source-bound to two verified actors',async()=>{
 const html=await readFile(new URL('../exports/recruitment-pool/recruitment-dashboard.html',import.meta.url),'utf8');
 assert.match(html,/id="assessmentCandidate" disabled/);
 assert.match(html,/id="assessmentOutcomes" disabled/);
 assert.match(html,/id="assessmentAttest" type="checkbox" disabled/);
 assert.match(html,/id="assessmentSubmit" type="submit" disabled/);
 assert.match(html,/assessmentAccess\.enabled&&assessmentAccess\.identityVerified/);
 assert.match(html,/assessmentAccess\.lock\?\.state==='free'/);
 assert.match(html,/snapshot\.submissionMessageCounts\?\.\[item\.name\]===1/);
 assert.match(html,/item\.submissionEvidence\?\.sourceId/);
 assert.match(html,/method:'POST',credentials:'same-origin'/);
 assert.match(html,/'X-Requested-With':'XMLHttpRequest'/);
 assert.match(html,/先读回记录，不自动重试/);
 assert.match(html,/不读取指定私聊|指定私聊没有被读取/);
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
});

test('招聘读取回填与本人提交回执均按周期和送审消息 ID 绑定',async()=>{
 const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
 assert.match(server,/const verified=chatComplete&&cycleEntries\.length \? structuredAssessmentForCandidate\(summary,candidate,cycleMonth\) : null/);
 assert.match(server,/const confirmation=structuredAssessmentForCandidate\([\s\S]*?submission\.candidate,cycleMonth\)/);
 assert.doesNotMatch(server,/summary\.byName\[|\)\.byName\[/);
});

test('recruitment page and 17:00 reminder use the same 25th cycle boundary',async()=>{
 const html=await readFile(new URL('../exports/recruitment-pool/recruitment-dashboard.html',import.meta.url),'utf8');
 const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
 assert.match(html,/Number\(TODAY\.slice\(8,10\)\)>=25/);
 assert.match(server,/const cycleMonth=recruitmentCycleMonthForDate\(targetDate\)/);
 assert.match(server,/const cycleMonth=recruitmentCycleMonthForDate\(date\)/);
 assert.doesNotMatch(server,/day>25/);
 assert.match(server,/if \(lifecycleInterviewReminderEnabled && interviewWindow === 'open'\) \{/);
 assert.match(server,/if \(lifecycleCoachReminderEnabled && coachWindow === 'open'\) \{/);
 assert.match(server,/已错过 17:00—18:00 窗口，未补发/);
  assert.match(server,/已错过 17:30—18:30 窗口，未补发/);
  assert.match(server,/verifyBeforePost:async\(\)=>\{[\s\S]*?const latestSource=await recruitmentCycleSnapshot\(cycleMonth,\{fresh:true\}\);[\s\S]*?interviewReminderSourceFingerprint\(latestSource,date\)!==expectedSource[\s\S]*?lifecycleReminderWindow\('interview',chinaMinutes\(new Date\(\)\)\) !== 'open'/);
  const durableIntent=server.indexOf('await writeReminderJournal(journal);',server.indexOf('async function deliverLifecycleReminder'));
  const check=server.indexOf('if (verifyBeforePost)',durableIntent);
  const post=server.indexOf("const data = await feishuPost('/im/v1/messages",check);
  assert.ok(durableIntent>=0&&check>durableIntent&&post>check,'fresh source check must happen after durable intent and before Feishu POST');
  const token=server.indexOf('sendToken = await getTenantToken();',durableIntent);
  assert.ok(token>durableIntent&&token<check,'token acquisition must finish before the final source check');
  assert.match(server.slice(post,post+300),/\},\{token:sendToken\}\)/);
  assert.match(server,/kind:'coach_review'[\s\S]*?verifyBeforePost:async\(\)=>\{/);
});
