import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLifecycleRefreshDue,
  mergeRecruitmentCandidates,
  normalizeAnchorReport,
  parseLatestCoachSummary,
  parseEmploymentMessages,
  parseRecruitmentMessages,
  buildInterviewReminderPreview
} from '../lifecycle-engine.mjs';

test('interview reminder requires a verified calendar and exact candidate match', () => {
  const date = '2026-09-23';
  const snapshot = {
    calendarStatus:'已连接：正式面试日历已读取 1 条详情事件。',
    coverage:{capped:false,chatMessages:12},
    candidates:[{name:'周小雨',inSubmissionCohort:true}],
    interviewEvents:{[date]:[{name:'周小雨面试 · 14:00',status:'calendar',eventId:'e1'}]},
  };
  const preview = buildInterviewReminderPreview(snapshot, date);
  assert.equal(preview.status, 'preview');
  assert.equal(preview.readyForSend, false);
  assert.deepEqual(preview.matches, [{name:'周小雨',eventId:'e1'}]);
  assert.match(preview.text, /周小雨/);
  assert.equal(buildInterviewReminderPreview({...snapshot,calendarStatus:'待授权'}, date).status, 'pending');
  assert.equal(buildInterviewReminderPreview({...snapshot,interviewEvents:{[date]:[{name:'未知姓名面试',status:'calendar'}]}}, date).status, 'pending');
});

test('recruitment parser deduplicates submissions and applies explicit results', () => {
  const parsed = parseRecruitmentMessages([
    {messageId:'m1',createdAt:'2026-08-21T01:00:00.000Z',text:'求职者 李彩红 是否符合【主播】的邀约标准',reactions:{details:[{emojiType:'OK',operatorId:'ou_0e5926902d4d6051d0ea14f042bb56f4'}]}},
    {messageId:'m2',createdAt:'2026-08-21T02:00:00.000Z',text:'求职者 李彩红 是否符合【主播】的邀约标准',reactions:{details:[{emojiType:'OK',operatorId:'ou_0e5926902d4d6051d0ea14f042bb56f4'}]}},
    {messageId:'m3',createdAt:'2026-08-21T03:00:00.000Z',text:'求职者 杨静娜 是否符合【主播】的邀约标准',reactions:{details:[{emoji_type:'No',operator:{operator_id:'ou_0e5926902d4d6051d0ea14f042bb56f4'}}]}}
  ]);
  assert.equal(parsed.dailyCounts['2026-08-21'], 2);
  assert.deepEqual(parsed.dailyNames['2026-08-21'], ['李彩红','杨静娜']);
  assert.equal(parsed.candidates.find(item => item.name === '李彩红').stage, 'initial_pass');
  assert.equal(parsed.candidates.find(item => item.name === '杨静娜').stage, 'initial_fail');
  assert.equal(parsed.candidates.some(item => item.stage === 'review'), false);
});

test('recruitment parser reads evaluation results and accepted offers without guessing', () => {
  const parsed = parseRecruitmentMessages([
    {messageId:'u1',createdAt:'2026-08-21T01:00:00.000Z',text:'求职者 周小雨 是否符合【主播】的邀约标准'},
    {messageId:'u2',createdAt:'2026-08-21T02:00:00.000Z',sender:{id:'ou_0e5926902d4d6051d0ea14f042bb56f4'},text:'**周小雨**\n颜值4 表现力4\n- **不通过**'},
    {messageId:'u3',createdAt:'2026-08-21T03:00:00.000Z',sender:{name:'倪梦萍',id:'ou_0e5926902d4d6051d0ea14f042bb56f4'},text:'**林小满**\n颜值4.5 表现力4\n- **通过**'},
    {messageId:'u4',createdAt:'2026-08-21T04:00:00.000Z',text:'品牌营销部-直播中心-新人主播-何小安接受offer 9.7待入职'}
  ]);
  assert.equal(parsed.candidates.find(item => item.name === '周小雨').stage, 'interview_fail');
  assert.equal(parsed.candidates.find(item => item.name === '林小满').stage, 'interview_pass');
  assert.equal(parsed.candidates.find(item => item.name === '何小安').startDate, '2026-09-07');
  assert.deepEqual(parsed.interviewEvents['2026-08-21'].map(item=>item.name), ['周小雨','林小满']);
});

test('recruitment parser ignores interview decisions from people other than the named reviewer', () => {
  const parsed = parseRecruitmentMessages([
    {messageId:'v1',createdAt:'2026-08-21T02:00:00.000Z',sender:{name:'其他成员'},text:'**周小雨**\n颜值4 表现力4\n- **通过**'}
  ]);
  assert.equal(parsed.candidates.length, 0);
  assert.deepEqual(parsed.interviewEvents, {});
});

test('employment parser accepts only verified coaching reports and keeps expected versus actual dates separate', () => {
  const parsed = parseEmploymentMessages([
    {messageId:'e1',createdAt:'2026-09-04T01:10:00.000Z',sender:{name:'倪梦萍'},text:'新人主播-谢红香已入职；谢红香考核通过。'},
    {messageId:'e2',createdAt:'2026-09-04T02:10:00.000Z',sender:{name:'其他成员'},text:'新人主播-李梓恒已入职；李梓恒考核通过。'},
  ]);
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].name, '谢红香');
  assert.equal(parsed.candidates[0].stage, 'hired');
  assert.equal(parsed.candidates[0].actualStartDate, '2026-09-04');
  assert.equal(parsed.candidates[0].assessmentPassed, true);
  assert.equal(parsed.candidates[0].source, 'WIS直播战队');
});

test('coach summary reads the newest dated section without treating missing fields as zero', () => {
  const parsed = parseLatestCoachSummary(`2026.8.20新人池情况：\n新人池：2人在培\n2026.8.24新人池情况：\n新人池：1人在培中\n培训进度：李楚晴 入职培训第4天；\n项目内编制：22人\n待入职考核：0人\n昨日送审简历数量：4个`);
  assert.deepEqual(parsed, {date:'2026-08-24',inTraining:1,projectHeadcount:22,pendingAssessment:0,yesterdaySubmitted:4,newcomerName:'李楚晴',newcomerDay:4});
});

test('candidate merge preserves historical media and does not delete old records', () => {
  const merged = mergeRecruitmentCandidates([{name:'甲',stage:'passed',media:['old.mp4']},{name:'乙',stage:'progress'}],[{name:'甲',stage:'failed',timeline:[['今天','明确结论']]}]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(item => item.name === '甲').media[0], 'old.mp4');
  assert.equal(merged.find(item => item.name === '甲').stage, 'failed');
});

test('anchor normalization keeps only verified nonempty rooms', () => {
  const parsed = normalizeAnchorReport({date:'2026-08-24',rooms:[
    {name:'官旗',people:[['潘小慧',92,'第1资源位',0,'稳定']]},
    {name:'优选',people:[]},
    {name:'未知房间',people:[['某人',88,'第1资源位',0,'']]}]
  });
  assert.deepEqual(parsed.verifiedRooms, ['官旗']);
  assert.equal(parsed.rooms['官旗'][0].score, 92);
});

test('09:30 and 18:00 scheduler catches up once per China slot', () => {
  assert.equal(isLifecycleRefreshDue({now:new Date('2026-08-24T01:29:00.000Z')}).due, false);
  assert.deepEqual(isLifecycleRefreshDue({now:new Date('2026-08-24T01:30:00.000Z')}), {date:'2026-08-24',slot:'09:30',slotKey:'2026-08-24T09:30',due:true});
  assert.equal(isLifecycleRefreshDue({now:new Date('2026-08-24T02:00:00.000Z'),lastAutomaticSlot:'2026-08-24T09:30'}).due, false);
  assert.equal(isLifecycleRefreshDue({now:new Date('2026-08-24T10:00:00.000Z'),lastAutomaticSlot:'2026-08-24T09:30'}).slot, '18:00');
  assert.equal(isLifecycleRefreshDue({now:new Date('2026-08-24T10:00:00.000Z'),lastAutomaticSlot:'2026-08-24T09:30'}).due, true);
});
