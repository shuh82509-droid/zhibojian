import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {normalizeCoachReview,coachReviewLabel,coachReviewEndpoint}=require('../exports/anchor-archives/assets/coach-review-ui.js');

const html = readFileSync(fileURLToPath(new URL('../exports/anchor-archives/recruitment-dashboard.html',import.meta.url)),'utf8');
const shell = readFileSync(fileURLToPath(new URL('../site/index.html',import.meta.url)),'utf8');
const docker = readFileSync(fileURLToPath(new URL('../Dockerfile',import.meta.url)),'utf8');
const overlayDocker = readFileSync(fileURLToPath(new URL('../Dockerfile.live-hub-v3-main',import.meta.url)),'utf8');
const server = readFileSync(fileURLToPath(new URL('../server.js',import.meta.url)),'utf8');
const framePolicy = readFileSync(fileURLToPath(new URL('../frame-policy.mjs',import.meta.url)),'utf8');

const sample = () => ({
  date:'2026-09-24',
  rotation:{status:'ready',week:{start:'2026-09-23',end:'2026-09-29'}},
  summary:{week:{start:'2026-09-23',end:'2026-09-29'},rooms:{
    '官旗':{status:'ready',anchors:[{name:'潘小慧',count:0}]},
    '品牌精选':{status:'ready',anchors:[{name:'何嘉慧',count:2}]},
    '优选':{status:'ready',anchors:[]},
    '王鸥美肤':{status:'ready',anchors:[{name:'王明玥',count:1}]},
  }},
  calendarStatus:Object.fromEntries(['官旗','品牌精选','优选','王鸥美肤'].map(room => [room,{status:'已读取'}])),
});

test('现役主播档案路径加载只读周复盘模块',() => {
  assert.match(shell,/modules\/anchors\/recruitment-dashboard\.html/);
  assert.match(docker,/COPY exports\/anchor-archives\/ \.\/public\/modules\/anchors\//);
  assert.match(overlayDocker,/COPY exports\/anchor-archives\/ \/app\/public\/modules\/anchors\//);
  assert.match(html,/<script src="assets\/coach-review-ui\.js"><\/script>/);
  assert.match(server,/\.js':'application\/javascript/);
  assert.match(framePolicy,/frame-ancestors 'self'/);
  assert.equal(coachReviewEndpoint('/yxb/wis-marketing-hub/modules/live-room-management/modules/anchors/recruitment-dashboard.html'),
    '/yxb/wis-marketing-hub/modules/live-room-management/api/lifecycle/coach-review');
  assert.equal(coachReviewEndpoint('/fd-027340/live-center-workbench/modules/anchors/recruitment-dashboard.html'),
    '/fd-027340/live-center-workbench/api/lifecycle/coach-review');
});

test('只有已核验的本周日历计次才显示真实零次，缺人不是零次',() => {
  const model = normalizeCoachReview(sample());
  assert.deepEqual(model.week,{start:'2026-09-23',end:'2026-09-29'});
  assert.match(coachReviewLabel(model,'官旗','潘小慧'),/^0 次 .*周三至周二/);
  assert.match(coachReviewLabel(model,'品牌精选','何嘉慧'),/^2 次/);
  assert.match(coachReviewLabel(model,'官旗','未列入主播'),/未列入.*不计次/);
  assert.equal(model.rooms['优选'].status,'ready');
  assert.equal(model.rooms['优选'].anchors.length,0);
});

test('任一教练未授权、周排名不完整或返回值无效时不伪造零次',() => {
  const withoutCalendar = sample();
  withoutCalendar.calendarStatus['官旗']={status:'待核验',reason:'token_expired'};
  let model = normalizeCoachReview(withoutCalendar);
  assert.equal(model.rooms['官旗'].status,'pending');
  assert.match(coachReviewLabel(model,'官旗','潘小慧'),/待核验/);
  assert.doesNotMatch(JSON.stringify(model),/token_expired/);

  const incompleteRanking = sample();
  incompleteRanking.rotation.status='partial';
  model=normalizeCoachReview(incompleteRanking);
  assert.ok(Object.values(model.rooms).every(room=>room.status==='pending'));

  const badCount=sample();
  badCount.summary.rooms['官旗'].anchors[0].count=null;
  model=normalizeCoachReview(badCount);
  assert.equal(model.rooms['官旗'].status,'pending');

  const wrongWeek=sample();
  wrongWeek.summary.week.start='2026-09-22';
  model=normalizeCoachReview(wrongWeek);
  assert.equal(model.week,null);
  assert.match(coachReviewLabel(model,'官旗','潘小慧'),/待核验/);

  const malformed=sample();
  malformed.summary.week.end='2026-09-31';
  model=normalizeCoachReview(malformed);
  assert.equal(model.week,null);
});

test('页面模型只保留房间、主播和计次，不暴露日程标题或事件 ID',() => {
  const data=sample();
  data.summary.rooms['官旗'].anchors[0].eventIds=['secret-event-id'];
  data.calendarStatus['官旗'].eventTitle='私人日历标题';
  data.eventsByRoom={'官旗':[{summary:'私人日历标题',eventId:'secret-event-id'}]};
  const rendered=JSON.stringify(normalizeCoachReview(data));
  assert.doesNotMatch(rendered,/secret-event-id|私人日历标题|eventIds|eventsByRoom/);
});
