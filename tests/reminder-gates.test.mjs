import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {reminderScheduleConfig} from '../reminder-gates.mjs';

const base={LIFECYCLE_SCHEDULER_ENABLED:'1',LIFECYCLE_REMINDER_LEADER:'true',LIFECYCLE_REMINDERS_ENABLED:'true'};

test('interview-only release never enables coach even after future OAuth',()=>{
  const config=reminderScheduleConfig({...base,LIFECYCLE_INTERVIEW_REMINDERS_ENABLED:'true',LIFECYCLE_COACH_REMINDERS_ENABLED:'false'},false);
  assert.deepEqual(config,{scheduler:true,leader:true,enabled:true,interview:true,coach:false});
});

test('missing kind flags fail closed',()=>{
  assert.deepEqual(reminderScheduleConfig(base,false),{scheduler:true,leader:true,enabled:true,interview:false,coach:false});
});

test('leader, global reminder flag and recovery gate block both kinds',()=>{
  for(const [env,recovery] of [
    [{...base,LIFECYCLE_REMINDER_LEADER:'false'},false],
    [{...base,LIFECYCLE_REMINDERS_ENABLED:'false'},false],
    [base,true],
  ]) {
    const result=reminderScheduleConfig({...env,LIFECYCLE_INTERVIEW_REMINDERS_ENABLED:'true',LIFECYCLE_COACH_REMINDERS_ENABLED:'true'},recovery);
    assert.equal(result.interview,false);
    assert.equal(result.coach,false);
  }
});

test('interview-only reminder runs without starting the general refresh scheduler',()=>{
  const config=reminderScheduleConfig({...base,LIFECYCLE_SCHEDULER_ENABLED:'0',LIFECYCLE_INTERVIEW_REMINDERS_ENABLED:'true',LIFECYCLE_COACH_REMINDERS_ENABLED:'false'},false);
  assert.deepEqual(config,{scheduler:false,leader:true,enabled:true,interview:true,coach:false});
});

test('preview and scheduler use the same recruitment-cycle boundary',async()=>{
  const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
  assert.match(server,/const cycleMonth = recruitmentCycleMonthForDate\(date\);/u);
  assert.doesNotMatch(server,/day > 25/u);
});
