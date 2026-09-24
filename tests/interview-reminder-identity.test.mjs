import assert from 'node:assert/strict';
import test from 'node:test';
import {buildInterviewReminderPreview} from '../lifecycle-engine.mjs';

const date='2026-09-25';
const source=events=>({
  calendarStatus:'已连接：正式面试日历已读取详情事件。',
  coverage:{chatMessages:2,capped:false,reactionStatus:'已核验'},
  boundaryCarryover:{status:'verified',date,submissionMessageCounts:{}},
  interviewEvents:{[date]:events},
  candidates:[
    {name:'测试甲',inSubmissionCohort:true,
      submissionEvidence:{sourceId:'om_a',date,initialReview:'OK'},
      calendarEvidence:{date,eventId:events.find(item=>item.name.startsWith('测试甲'))?.eventId}},
    {name:'测试乙',inSubmissionCohort:true,
      submissionEvidence:{sourceId:'om_b',date,initialReview:'OK'},
      calendarEvidence:{date,eventId:events.find(item=>item.name.startsWith('测试乙'))?.eventId}},
  ],
  submissionMessageCounts:{测试甲:1,测试乙:1},
});
const event=(name,eventId)=>({status:'calendar',name:`${name}面试`,eventId});

test('different official event IDs and different submitted people are previewable',()=>{
  const result=buildInterviewReminderPreview(source([event('测试甲','ev-a'),event('测试乙','ev-b')]),date);
  assert.equal(result.sourceReady,true);
  assert.equal(result.matches.length,2);
});

test('duplicate candidate across official events fails closed',()=>{
  const result=buildInterviewReminderPreview(source([event('测试甲','ev-a'),event('测试甲','ev-b')]),date);
  assert.equal(result.status,'pending');
  assert.equal(result.sourceReady,undefined);
});

test('missing or duplicated official event IDs fail closed',()=>{
  for (const events of [
    [event('测试甲',''),event('测试乙','ev-b')],
    [event('测试甲','ev-a'),event('测试乙','ev-a')],
  ]) {
    const result=buildInterviewReminderPreview(source(events),date);
    assert.equal(result.status,'pending');
    assert.equal(result.sourceReady,undefined);
  }
});
