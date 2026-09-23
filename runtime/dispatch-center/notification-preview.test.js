const test = require('node:test');
const assert = require('node:assert/strict');
const {buildOpeningPreview} = require('./notification-preview');

const date = '2026-09-24';
const now = new Date('2026-09-23T04:00:00.000Z');
const schedule = () => ({
  date,
  updatedAt: '2026-09-23T03:00:00.000Z',
  sourceStatus: Object.fromEntries(['guanqi', 'brand_selection', 'youxuan', 'wangou'].map(code => [code, {found:true}])),
  rooms: [
    {code:'guanqi',name:'官旗',anchors:[['08:00','10:00','主播甲']],assistants:[['08:00','10:00','助理乙']]},
    {code:'brand_selection',name:'品牌精选',anchors:[],assistants:[]},
    {code:'youxuan',name:'优选',anchors:[],assistants:[]},
    {code:'wangou',name:'王鸥美肤',anchors:[],assistants:[]},
  ],
});

test('verified fresh schedule produces previews but never authorizes sending', () => {
  const preview = buildOpeningPreview(schedule(), {date, now});
  assert.equal(preview.status, 'preview');
  assert.equal(preview.readyForSend, false);
  assert.deepEqual(preview.messages.map(item => item.name), ['主播甲','助理乙']);
  assert.match(preview.messages[0].text, /08:00—10:00/);
});

test('recovery snapshot never produces messages', () => {
  const input = schedule();
  input.recovery = {readOnly:true};
  assert.deepEqual(buildOpeningPreview(input, {date, now}).messages, []);
});

test('missing room or stale read blocks whole batch', () => {
  const missing = schedule();
  missing.sourceStatus.wangou.found = false;
  assert.equal(buildOpeningPreview(missing, {date, now}).status, 'pending');
  const stale = schedule();
  stale.updatedAt = '2026-09-22T00:00:00.000Z';
  assert.equal(buildOpeningPreview(stale, {date, now}).status, 'pending');
});

test('a non-tomorrow date cannot be worded as tomorrow', () => {
  const input = schedule();
  input.date = '2026-09-25';
  assert.equal(buildOpeningPreview(input, {date:'2026-09-25', now}).status, 'pending');
});

test('unverified person blocks whole batch', () => {
  const input = schedule();
  input.rooms[0].assistants[0][2] = '待核验';
  assert.deepEqual(buildOpeningPreview(input, {date, now}).messages, []);
});
