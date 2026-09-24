const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROOMS,
  REST_SCHEDULE_SOURCES,
  TOTAL_SCHEDULE_WIKI_URL,
  buildWritebackPlan,
  directLocalRequest,
  findDateBlock,
  isOnShift,
  localDateKey,
  parseScheduleSheets,
  resolveRosterColumns,
  sessionFromAuth,
} = require('./schedule-api-server');

test('September 2026 staffing schedule resolves to the user-provided workbook', () => {
  assert.equal(REST_SCHEDULE_SOURCES['2026-09'].wikiToken, 'UKVDwxpz7iKAv8k5KxTcxiDVnuf');
  assert.equal(REST_SCHEDULE_SOURCES['2026-09'].sheetId, '0jFdXf');
  assert.equal(REST_SCHEDULE_SOURCES['2026-09'].label, '品牌营销部-直播中心排班表_20260901_20260930');
  assert.equal(TOTAL_SCHEDULE_WIKI_URL, 'https://jqx28l0j4lx.feishu.cn/wiki/UKVDwxpz7iKAv8k5KxTcxiDVnuf');
});

const oldMondayBlock = [
  ['8月18日\n星期一', '旧主播', 'R（06:30-15:30）', '07:00-10:00'],
  ['', '旧主播二', '休息', '旧主播'],
];

const guanqi = [
  ['8月18日\n星期二', 'wis官旗', '时间', '05:30-08:00', '08:00-10:00', '', '', '', '', '', '', '', '', '02:00-05:30', '24小时', '赵媛', 'L（05:30-14:30）'],
  ['', '', '主播', '赵媛', '潘小慧', '', '', '', '', '', '', '', '', '王明玥', '', '潘小慧', 'GJ2（07:30-15:00）'],
  ['', '', '', '05:30-10:00', '10:00-14:30', '', '', '', '', '', '', '', '', '', '', '何嘉慧', 'GJ（15:30-23:00）'],
  ['', '', '', '林梓烁', '韦彩云', '', '', '', '', '', '', '', '', '', '', '林惠敏', '休息'],
  ['8月19日\n星期三'],
];

const guanqiCurrent = [
  ['8月21日\n星期五', 'wis官旗', '时间', '05:30-08:00', '08:00-10:00', '', '', '', '', '', '', '', '24小时', '主播甲', 'A（08:30-17:30）'],
  ['', '', '主播', '主播甲', '主播乙', '', '', '', '', '', '', '', '', '主播乙', 'GJ（15:30-23:00）'],
  ['', '', '', '05:30-10:00', '10:00-14:30', '', '', '', '', '', '', '', '', '助播甲', 'L（05:30-14:30）'],
  ['', '', '', '助播甲', '助播乙'],
  ['8月22日\n星期六'],
];

const brand = [
  ...oldMondayBlock,
  ['8月18日\n星期二', '李晓茏', 'AC1（07:30-16:30）', '05:30-08:00', '08:00-11:00'],
  ['', '陈璐', 'L（05:30-14:30）', '陈璐', '李晓茏'],
  ['', '丁阳虹', '休息', '不断播 89机制'],
  ['', '刘晶晶', 'J2（14:30-23:00）', '05:30-10:18', '10:18-15:06'],
  ['', '蒋珂', 'WB（17:30-次日02:00）', '刘子菁', '刘楠'],
  ['8月19日\n星期三'],
];

test('uses the latest matching date block and parses all room timelines', () => {
  assert.equal(findDateBlock([...oldMondayBlock, ...brand], '2026-08-18')[0][0], '8月18日\n星期二');
  const parsed = parseScheduleSheets({
    guanqi,
    brand_selection: brand,
    youxuan: brand,
    wangou: brand,
  }, '2026-08-18');
  const officialRoom = parsed.rooms.find((room) => room.code === 'guanqi');
  const brandRoom = parsed.rooms.find((room) => room.code === 'brand_selection');

  assert.deepEqual(officialRoom.anchors, [
    ['05:30', '08:00', '赵媛'],
    ['08:00', '10:00', '潘小慧'],
    ['02:00', '05:30', '王明玥'],
  ]);
  assert.deepEqual(officialRoom.assistants, [
    ['05:30', '10:00', '林梓烁'],
    ['10:00', '14:30', '韦彩云'],
  ]);
  assert(parsed.roster.some((person) => person.name === '赵媛' && person.shift.startsWith('L')));
  assert(parsed.roster.some((person) => person.name === '林惠敏' && person.shift === '休息'));
  assert.deepEqual(brandRoom.anchors, [
    ['05:30', '08:00', '陈璐'],
    ['08:00', '11:00', '李晓茏'],
  ]);
  assert.deepEqual(brandRoom.assistants, [
    ['05:30', '10:18', '刘子菁'],
    ['10:18', '15:06', '刘楠'],
  ]);
  assert.equal(parsed.sourceStatus.guanqi.firstRow, 1);
  assert.equal(parsed.sourceStatus.guanqi.lastRow, 4);
  assert.deepEqual(parsed.sourceStatus.guanqi.rosterColumns, ['P', 'Q']);
});

test('detects the current official-room roster columns without mistaking attendance for timeline', () => {
  const room = ROOMS.find((item) => item.code === 'guanqi');
  assert.deepEqual(resolveRosterColumns(room, guanqiCurrent.slice(0, 4)), [13, 14]);
  const parsed = parseScheduleSheets({
    guanqi: guanqiCurrent,
    brand_selection: [],
    youxuan: [],
    wangou: [],
  }, '2026-08-21');
  const officialRoom = parsed.rooms.find((item) => item.code === 'guanqi');
  assert.deepEqual(officialRoom.anchors, [
    ['05:30', '08:00', '主播甲'],
    ['08:00', '10:00', '主播乙'],
  ]);
  assert.deepEqual(officialRoom.assistants, [
    ['05:30', '10:00', '助播甲'],
    ['10:00', '14:30', '助播乙'],
  ]);
});

test('confirmed 官旗 co-broadcast keeps 曹总 display-only and never creates a separate duty name', () => {
  const rows = guanqiCurrent.map((row) => [...row]);
  rows[0][13] = '赵媛 & 曹总（老板场）';
  rows[1][3] = '赵媛 & 曹总（老板场）';
  rows[1][13] = '潘小慧';
  rows[1][4] = '潘小慧';
  const parsed = parseScheduleSheets({ guanqi: rows, brand_selection: [], youxuan: [], wangou: [] }, '2026-08-21');
  const officialRoom = parsed.rooms.find((item) => item.code === 'guanqi');
  assert.deepEqual(officialRoom.anchors, [
    ['05:30', '08:00', '赵媛', '赵媛&曹总（老板场）'],
    ['08:00', '10:00', '潘小慧'],
  ]);
  assert(parsed.roster.some((person) => person.name === '赵媛' && person.shift.startsWith('A')));
  assert(!parsed.roster.some((person) => person.name === '曹总' || person.name.includes('&')));
});

test('官旗 9/25 confirmed wide timeline retains all 13 shifts, 6 co-broadcast labels and the 05:30 tail', () => {
  const times = ['05:30-07:00', '07:00-08:00', '08:00-10:00', '10:00-11:00', '11:00-13:00',
    '13:00-14:00', '14:00-16:00', '16:00-18:00', '18:00-20:00', '20:00-23:00',
    '23:00-24:00', '24:00-02:00', '02:00-05:30'];
  const names = ['丁阳虹', '丁阳虹&曹总（老板场）', '潘小慧&曹总（老板场）',
    '丁阳虹&曹总（老板场）', '丁阳虹', '潘小慧', '潘小慧&曹总（老板场）',
    '林惠敏', '李晓茏', '林惠敏&曹总（老板场）', '李晓茏&曹总（老板场）',
    '李晓茏', '林羽浠'];
  const rows = [
    ['9月25日\n星期五', 'wis官旗', '时间', ...times],
    ['', '', '主播', ...names],
    ['', '', '', '5:30-10：10', '10：10-15：00', '15：00-19：50', '19：50-0：30', '00：30-5：30'],
    ['', '', '', '韦彩云', '林梓烁', '曾睿琳', '杨冰', '尹珩瑞'],
  ];
  const parsed = parseScheduleSheets({ guanqi: rows, brand_selection: [], youxuan: [], wangou: [] }, '2026-09-25');
  const anchors = parsed.rooms.find((room) => room.code === 'guanqi').anchors;
  assert.equal(anchors.length, 13);
  assert.equal(anchors.filter((shift) => shift[3] === `${shift[2]}&曹总（老板场）`).length, 6);
  assert.deepEqual(anchors.at(-1), ['02:00', '05:30', '林羽浠']);
  assert.deepEqual(parsed.roster, []);
});

test('genuine P/Q attendance remains separate from the 官旗 timeline', () => {
  const parsed = parseScheduleSheets({ guanqi, brand_selection: [], youxuan: [], wangou: [] }, '2026-08-18');
  const officialRoom = parsed.rooms.find((room) => room.code === 'guanqi');
  assert.deepEqual(parsed.sourceStatus.guanqi.rosterColumns, ['P', 'Q']);
  assert(officialRoom.anchors.some((shift) => shift[2] === '王明玥' && shift[0] === '02:00'));
  assert(!officialRoom.anchors.some((shift) => /\d{1,2}:\d{2}/u.test(shift[2])));
  assert(parsed.roster.some((person) => person.name === '潘小慧' && person.shift.startsWith('GJ2')));
  assert(!parsed.roster.some((person) => /\d{1,2}:\d{2}/u.test(person.name)));
});

test('unknown ampersand labels never infer opening principals or roster duties', () => {
  for (const label of ['赵媛&曹总（其他场）', '赵媛&其他人', '赵媛＆曹总&其他人']) {
    const rows = guanqiCurrent.map((row) => [...row]);
    rows[0][13] = label;
    rows[1][3] = label;
    rows[1][13] = '';
    rows[1][4] = '潘小慧';
    const parsed = parseScheduleSheets({ guanqi: rows, brand_selection: [], youxuan: [], wangou: [] }, '2026-08-21');
    const first = parsed.rooms.find((item) => item.code === 'guanqi').anchors[0];
    assert.equal(first[2], label);
    assert.equal(first[3], undefined);
    assert(!parsed.roster.some((person) => person.name === '赵媛' || person.name === '曹总'));
  }
});

test('creates an exact preview plan and changes the fingerprint when target cells change', () => {
  const room = ROOMS.find((item) => item.code === 'guanqi');
  const input = {
    date: '2026-08-18',
    roomCode: 'guanqi',
    role: 'anchor',
    name: '测试主播',
    start: '05:30',
    end: '10:00',
  };
  const plan = buildWritebackPlan(room, guanqi, input, 186430);
  assert.equal(plan.range, 'NYB2iu!D2:E2');
  assert.deepEqual(plan.before, ['赵媛', '潘小慧']);
  assert.deepEqual(plan.after, ['测试主播', '测试主播']);
  assert.deepEqual(plan.overwrites, ['赵媛', '潘小慧']);
  assert.equal(plan.revision, 186430);
  const changed = guanqi.map((row) => [...row]);
  changed[1][3] = '他人刚刚修改';
  assert.notEqual(buildWritebackPlan(room, changed, input, 186431).expectedHash, plan.expectedHash);
});

test('evaluates default dates and overnight shifts in Asia/Shanghai', () => {
  const utcMorning = new Date('2026-08-18T08:45:00.000Z');
  assert.equal(localDateKey(utcMorning), '2026-08-18');
  assert.equal(isOnShift(['16:00', '18:00'], utcMorning), true);
  assert.equal(isOnShift(['08:00', '10:00'], utcMorning), false);
});

test('allows host-to-container verification only without forwarding headers', () => {
  assert.equal(directLocalRequest({ headers: {}, socket: { remoteAddress: '::ffff:172.17.0.1' } }), true);
  assert.equal(directLocalRequest({
    headers: { 'x-forwarded-for': '203.0.113.8' },
    socket: { remoteAddress: '::ffff:172.17.0.1' },
  }), false);
  assert.equal(directLocalRequest({ headers: {}, socket: { remoteAddress: '203.0.113.8' } }), false);
});

test('maps the central identity and permission role without exposing a hardcoded account', () => {
  assert.deepEqual(sessionFromAuth({
    mode: 'central',
    user: { realName: '测试成员', number: 'FD-TEST' },
    permissions: { operation_admin: true, manage_permissions: false, super_admin: false },
  }), {
    user: { name: '测试成员', role: '运营管理员' },
    permissions: { super_admin: false, operation_admin: true, manage_permissions: false },
    access: { required_module: 'live-room-management' },
  });
});
