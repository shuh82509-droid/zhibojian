import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeishuDashboardRows} from '../app/api/_lib/feishu-dashboard-fallback.ts';

const row=(time:string,gmv:unknown,delta:unknown,watchers:unknown=100,cost:unknown=10,deltaCost:unknown=5)=>
  ['2026/9/4',time,'测试主播',gmv,cost,null,delta,deltaCost,null,watchers,null,null,null,null,null];
const now=new Date('2026-09-04T15:15:00+08:00');
test('future formula zero and blank cumulative remain missing, including next day',()=>{
 const parsed=parseFeishuDashboardRows('guanqi','2026-09-04',[
  row('05:50-06:00',100,100),row('14:00-14:30',200,100),
  row('14:30-15:00',null,-200,null,null,0),row('15:00-15:30',null,0,null,null,0),
  row('16:00-16:30',null,0,null,null,0),row('23:30-00:00',null,0,null,null,0),
  row('00:00-00:30',null,0,null,null,0)],now);
 assert.equal(parsed.trend.find(x=>x.hour==='14:00')?.gmv,100);
 for(const hour of ['15:00','16:00','23:00','次日 00:00'])assert.equal(parsed.trend.find(x=>x.hour===hour)?.gmv,null,hour);
 assert.equal(parsed.session.durationSeconds,40*60);
 assert.equal(parsed.session.gmv,200);
});
test('verified zero survives and active interval is capped at now',()=>{
 const parsed=parseFeishuDashboardRows('guanqi','2026-09-04',[row('15:00-15:30',0,0,0,0,0)],now);
 assert.equal(parsed.trend[0].gmv,0);assert.equal(parsed.session.watchers,0);
 assert.equal(parsed.session.durationSeconds,15*60);
});
test('unreported historical zero is missing, historical confirmed zero is real',()=>{
 const parsed=parseFeishuDashboardRows('guanqi','2026-09-03',[row('06:00-06:30',null,0,null,null,0),row('07:00-07:30',0,0,0,0,0)],now);
 assert.equal(parsed.trend[0].gmv,null);assert.equal(parsed.trend[1].gmv,0);
 assert.equal(parsed.session.durationSeconds,30*60);
});
test('watcher decimals cannot silently become people or ten-thousands',()=>{
 for(const raw of ['1.87',3.87,-2]){
  const {session}=parseFeishuDashboardRows('guanqi','2026-09-04',[row('14:00-14:30',100,100,raw)],now);
  assert.equal(session.watchers,null);assert.equal(session.watchersStatus,'人数单位待核验');
 }
 assert.equal(parseFeishuDashboardRows('guanqi','2026-09-04',[row('14:00-14:30',100,100,'1.87万')],now).session.watchers,18700);
 assert.equal(parseFeishuDashboardRows('guanqi','2026-09-04',[row('14:00-14:30',100,100,'待核验')],now).session.watchers,null);
});
test('overnight and overlapping intervals do not inflate reported duration',()=>{
 const parsed=parseFeishuDashboardRows('guanqi','2026-09-03',[
  row('23:00-23:30',100,100),row('23:00-23:30',100,0),row('00:00-00:30',200,100)
 ],new Date('2026-09-04T00:10:00+08:00'));
 assert.equal(parsed.session.durationSeconds,40*60);
 assert.equal(parsed.trend[1].hour,'次日 00:00');
});
