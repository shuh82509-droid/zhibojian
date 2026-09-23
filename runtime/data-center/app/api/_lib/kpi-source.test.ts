import test from 'node:test';
import assert from 'node:assert/strict';
import { headerMonth, selectKpiSheet, targetCompletion } from './kpi-source.ts';

test('business month resolves a prior-month tab copy without renaming the source', async () => {
  const sheets = [{sheet_id:'copy',title:'2026年8月目标汇总（副本）'}, {sheet_id:'original',title:'2026年8月目标汇总'}];
  const found = await selectKpiSheet(sheets,'2026-09',async id => [[id==='copy'?'2026年9月份目标（主播教练/管培生）':'2026年8月份目标']]);
  assert.equal(found.sheet_id,'copy');assert.equal(found.title,sheets[0].title);
});
test('matching tab title cannot substitute for missing business-month evidence', async () => {
  await assert.rejects(selectKpiSheet([{sheet_id:'old',title:'2026年9月目标汇总'}],'2026-09',async()=>[['2026年8月份目标']]),/未找到/);
});
test('ambiguous business-month sources remain unverified',async()=>{
  await assert.rejects(selectKpiSheet([{sheet_id:'a'},{sheet_id:'b'}],'2026-09',async()=>[['2026年9月份目标']]),/多个/);
  assert.equal(headerMonth([['2026年8月及2026年9月目标']]),null);
});
test('unreadable header cannot silently hide a competing source',async()=>{
  await assert.rejects(selectKpiSheet([{sheet_id:'a'},{sheet_id:'b'}],'2026-09',async id=>{if(id==='b')throw new Error('source unavailable');return [['2026年9月份目标']];}),/source unavailable/);
});
test('source scans are bounded and dates validated before reading',async()=>{
  let calls=0;const read=async()=>{calls++;return []};
  await assert.rejects(selectKpiSheet([{sheet_id:'a'}],'2026-13',read),/月份/);
  await assert.rejects(selectKpiSheet(Array.from({length:37},(_,i)=>({sheet_id:String(i)})),'2026-09',read),/范围/);
  assert.equal(calls,0);
});
test('gross GMV cannot be divided by net GSV targets',()=>{
  assert.equal(targetCompletion(5857829,5200000,'cumulative_gmv'),null);
  assert.equal(targetCompletion(12138695,11100000,'gmv_minus_refund'),109.4);
  assert.equal(targetCompletion(389185,4300000,'daily_channel_net'),9.1);
});
test('missing and invalid targets remain missing; real zero remains zero',()=>{
  assert.equal(targetCompletion(null,100,'daily_channel_net'),null);
  assert.equal(targetCompletion(1,null,'daily_channel_net'),null);
  assert.equal(targetCompletion(1,-1,'daily_channel_net'),null);
  assert.equal(targetCompletion(0,100,'daily_channel_net'),0);
});
