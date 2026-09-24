import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// Execute the actual server functions against an in-memory journal and Feishu
// transport. These tests never start the HTTP server or contact production.
const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = server.indexOf(start), to = server.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `server section ${start} must exist`);
  return server.slice(from, to);
}
const reminderFunctions = [
  section('async function deliverLifecycleReminder(', 'async function refreshReminderReadbacks('),
  section('async function runLifecycleReminders(', 'function documentBlockText('),
].join('\n');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness({ openKind = 'interview', post = async () => ({ message_id: 'om_delivered' }) } = {}) {
  let journal = { schemaVersion: 1, receipts: [] };
  let interview = { text: '王丽今日面试', fingerprint: 'calendar-and-chat-1' };
  let rankingRevision = 12535;
  let calendarEvents = [{ eventId: 'e1', summary: '潘小慧复盘' }];
  let review = null;
  let tokenGate = null;
  let tokenEntered = null;
  const calls = { post: [], recruitment: [], tokens: 0, prePost: 0 };
  const state = { running: false, lastCheckAt: null, lastError: null, lastGate: {} };
  const sandbox = {
    randomUUID, createHash,
    lifecycleReminderEnabled: true,
    lifecycleInterviewReminderEnabled: openKind === 'interview',
    lifecycleCoachReminderEnabled: openKind === 'coach',
    notificationBotIdentityMatches: () => true,
    verifiedReminderRecipient: async () => true,
    withReminderJournalLock: async operation => operation(),
    readReminderJournal: async () => structuredClone(journal),
    writeReminderJournal: async value => { journal = structuredClone(value); },
    verifyReminderReadback: async () => false,
    getTenantToken: async () => {
      calls.tokens++;
      tokenEntered?.resolve();
      if (tokenGate) await tokenGate.promise;
      return 'test-token';
    },
    feishuPost: async (...args) => { calls.post.push(args); return post(...args); },
    lifecycleReminderState: state,
    refreshReminderReadbacks: async () => {},
    chinaDateFor: () => '2026-09-24',
    chinaMinutes: () => openKind === 'interview' ? 17 * 60 + 10 : 17 * 60 + 40,
    lifecycleReminderWindow: kind => kind === openKind ? 'open' : 'before',
    recruitmentCycleMonthForDate: () => '2026-09',
    recruitmentCycleSnapshot: async (_month, options) => {
      calls.recruitment.push(options);
      return structuredClone(interview);
    },
    buildInterviewReminderPreview: source => ({ sourceReady: true, text: source.text }),
    interviewReminderSourceFingerprint: source => source.fingerprint,
    recruitmentReviewerOpenId: 'ou_recruiter',
    coachReviewSnapshot: async () => review || {
      summary: { week: { start: '2026-09-23' } },
      source: { revision: rankingRevision },
      calendarFingerprints: { 官旗: JSON.stringify(calendarEvents) },
    },
    coachNames: { 官旗: '曾泳淇' },
    coachCalendarConfig: { 官旗: { openId: 'ou_coach' } },
    coachReviewReminder: () => ({ status: 'ready', text: '潘小慧今日复盘提醒' }),
    fetchCoachRankingRange: async () => ({ revision: rankingRevision, values: [['本周所在直播间']] }),
    assertCoachRankingRevision: async (expected, read) => {
      if ((await read()).revision !== expected) throw new Error('周排名在通知前已变化');
    },
    readCoachCalendar: async () => structuredClone(calendarEvents),
    coachCalendarFingerprint: events => JSON.stringify(events),
    console: { error() {} },
  };
  const { deliverLifecycleReminder, runLifecycleReminders } = runInNewContext(
    `${reminderFunctions}\n({deliverLifecycleReminder,runLifecycleReminders})`, sandbox,
    { filename: 'server.js reminder functions' },
  );
  return {
    calls, state, deliverLifecycleReminder, runLifecycleReminders,
    journal: () => structuredClone(journal),
    setInterview: value => { interview = value; },
    setRankingRevision: value => { rankingRevision = value; },
    setCalendarEvents: value => { calendarEvents = value; },
    setReview: value => { review = value; },
    pauseToken: () => {
      tokenGate = deferred(); tokenEntered = deferred();
      return { entered: tokenEntered.promise, resume: () => { tokenGate.resolve(); tokenGate = null; tokenEntered = null; } };
    },
  };
}

test('17:00 source changed while token is pending: no stale interview message and no stuck intent', async () => {
  const app = harness();
  const token = app.pauseToken();
  const firstRun = app.runLifecycleReminders(new Date('2026-09-24T09:10:00.000Z'));
  await token.entered;
  assert.equal(app.journal().receipts[0].state, 'sending');
  app.setInterview({ text: '王丽娜今日面试', fingerprint: 'calendar-and-chat-2' });
  token.resume();
  await firstRun;
  assert.equal(app.calls.post.length, 0);
  assert.equal(app.journal().receipts.length, 0);
  assert.match(app.state.lastError.message, /发生变化/);
  assert.ok(app.calls.recruitment.length >= 2);
  assert.ok(app.calls.recruitment.every(item => item.fresh === true));

  await app.runLifecycleReminders(new Date('2026-09-24T09:11:00.000Z'));
  assert.equal(app.calls.post.length, 1);
  assert.equal(JSON.parse(app.calls.post[0][1].content).text, '王丽娜今日面试');
  assert.equal(app.journal().receipts.length, 1);
});

test('17:30 calendar changed while token is pending: no stale coach message and later fresh run succeeds', async () => {
  const app = harness({ openKind: 'coach' });
  const token = app.pauseToken();
  const firstRun = app.runLifecycleReminders(new Date('2026-09-24T09:40:00.000Z'));
  await token.entered;
  assert.equal(app.journal().receipts[0].state, 'sending');
  app.setCalendarEvents([{ eventId: 'e1', summary: '潘小慧复盘改期' }]);
  token.resume();
  await firstRun;
  assert.equal(app.calls.post.length, 0);
  assert.equal(app.journal().receipts.length, 0);
  assert.match(app.state.lastError.message, /日历在通知前发生变化/);

  await app.runLifecycleReminders(new Date('2026-09-24T09:41:00.000Z'));
  assert.equal(app.calls.post.length, 1);
  assert.equal(app.journal().receipts.length, 1);
});

test('17:30 ranking revision changed while token is pending: pre-POST check removes intent', async () => {
  const app = harness({ openKind: 'coach' });
  const token = app.pauseToken();
  const firstRun = app.runLifecycleReminders(new Date('2026-09-24T09:40:00.000Z'));
  await token.entered;
  app.setRankingRevision(12536);
  token.resume();
  await firstRun;
  assert.equal(app.calls.post.length, 0);
  assert.equal(app.journal().receipts.length, 0);
  assert.match(app.state.lastError.message, /周排名在通知前已变化/);
});

test('an unknown Feishu POST outcome persists one barrier and is never automatically resent', async () => {
  const app = harness({ post: async () => { throw new Error('socket timeout after POST'); } });
  const args = { key: 'interview-feedback:2026-09-24:ou_recruiter', date: '2026-09-24', kind: 'interview_feedback',
    recipientId: 'ou_recruiter', recipientName: '倪梦萍', text: '今日面试',
    verifyBeforePost: async () => { app.calls.prePost++; } };
  const first = await app.deliverLifecycleReminder(args);
  assert.equal(first.state, 'uncertain');
  assert.equal(app.calls.post.length, 1);
  assert.equal(app.journal().receipts[0].state, 'uncertain');
  const second = await app.deliverLifecycleReminder(args);
  assert.equal(second.state, 'uncertain');
  assert.equal(app.calls.post.length, 1);
  assert.equal(app.calls.prePost, 1);
  assert.equal(app.journal().receipts.length, 1);
});
