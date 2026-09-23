'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOM_PLANNING, SHIFT_TIMES, formatShiftCell, generateDraft, generateMakeupDraft, parseRestSource, parseRestSources, restAdjustmentFromNote, transitionAllowed } = require('./planning-engine');
const { buildMakeupImportPlan, buildPlanningImportPlan, headerDateKey, parseMakeupScheduleRows } = require('./schedule-api-server');

test('supports independent assistant rosters in all four rooms and rotates shift types', () => {
  assert.deepEqual(ROOM_PLANNING.guanqi.assistants, ['尹珩瑞', '杨冰', '陈嘉欣', '蒙万叶', '韦彩云', '林梓烁', '雷惠朝']);
  for (const roomCode of ['brand_selection', 'youxuan', 'wangou']) {
    assert.deepEqual(ROOM_PLANNING[roomCode].assistants, []);
    const roomDraft = generateDraft({ roomCode, role: 'assistant', startDate: '2026-09-01', endDate: '2026-09-03', roster: [{name:`${roomCode}助理`,restDates:[]}] });
    assert.equal(roomDraft.roomCode, roomCode);
  }
  const draft = generateDraft({ roomCode: 'guanqi', role: 'assistant', startDate: '2026-09-01', endDate: '2026-09-10' });
  for (const date of draft.dates) {
    const names = draft.assignments.filter((item) => item.date === date && !item.rest).map((item) => item.name);
    assert.equal(new Set(names).size, names.length);
  }
  assert.deepEqual(new Set(draft.assignments.filter((item) => !item.rest).map((item) => item.shiftCode)), new Set(ROOM_PLANNING.guanqi.assistantShifts));
});

test('associates default and custom shifts with verified times', () => {
  assert.equal(SHIFT_TIMES.L, '05:30–14:30');
  assert.equal(SHIFT_TIMES.ZBB, '21:00–次日06:00');
  const draft = generateDraft({ roomCode: 'guanqi', role: 'assistant', startDate: '2026-09-01', endDate: '2026-09-02', shifts: ['L', 'D1'], customShiftTimes: { D1: '09:00–18:00' } });
  assert.equal(draft.customShiftTimes.D1, '09:00–18:00');
  assert.ok(draft.assignments.some((item) => item.shiftCode === 'D1' && item.shiftTime === '09:00–18:00'));
});

test('assistant attendance follows the finalized L, P+WB and M+ZBB formulas', () => {
  const draft = generateDraft({ roomCode:'guanqi', role:'assistant', startDate:'2026-09-01', endDate:'2026-09-05', roster:[{name:'助理甲',entitlement:4,restDates:[]}], shifts:['L','P','WB','M','ZBB'] });
  assert.deepEqual(draft.attendance[0], {name:'助理甲',entitlement:4,usedRest:0,remainingRest:4,opening:1,closing:2,overnight:2});
});

test('enforces official and preferred reverse-shift constraints', () => {
  assert.equal(transitionAllowed('M', 'L', 'guanqi'), false);
  assert.equal(transitionAllowed('P', 'F', 'guanqi'), false);
  assert.equal(transitionAllowed('B3', 'R', 'youxuan'), false);
  assert.equal(transitionAllowed('X', 'R', 'youxuan'), true);
});

test('preferred room gives partner M to rank three with rank four fallback and records daily resource averages', () => {
  const draft = generateDraft({ roomCode: 'youxuan', role: 'anchor', startDate: '2026-09-03', endDate: '2026-09-09', roster: [{ name: '甲', rank: 1, entitlement: 2, restDates: [] }, { name: '乙', rank: 2, entitlement: 2, restDates: ['2026-09-04'] }, { name: '丙', rank: 3, entitlement: 2, restDates: ['2026-09-04'] }, { name: '丁', rank: 4, entitlement: 2, restDates: [] }] });
  assert.equal(draft.assignments.find((item) => item.date === '2026-09-03' && item.shiftCode === 'M')?.name, '丙');
  assert.equal(draft.assignments.find((item) => item.date === '2026-09-04' && item.shiftCode === 'M')?.name, '丁');
  assert.equal(draft.resourceAverages.length, draft.dates.length);
  for (const date of draft.dates) {
    const names = draft.assignments.filter((item) => item.date === date && !item.rest).map((item) => item.name);
    assert.equal(new Set(names).size, names.length);
  }
});

test('official room leaves P empty below five working anchors and preferred pool is selectable', () => {
  const official = generateDraft({roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',roster:['甲','乙','丙','丁'].map((name,index)=>({name,rank:index+1,restDates:[]}))});
  assert.equal(official.assignments.some(item=>item.shiftCode==='P'), false);
  const preferred = generateDraft({roomCode:'youxuan',role:'anchor',startDate:'2026-09-03',endDate:'2026-09-03',roster:[{name:'甲',rank:1,poolSelected:true,restDates:[]},{name:'乙',rank:2,poolSelected:false,restDates:[]},{name:'丙',rank:3,poolSelected:true,restDates:[]}]});
  assert.equal(preferred.assignments.some(item=>item.name==='乙'), false);
});

test('official and brand-selection top two anchors never receive the lowest resource slot', () => {
  for (const roomCode of ['guanqi', 'brand_selection']) {
    const roster = ['甲','乙','丙','丁','戊'].map((name,index)=>({name,rank:index+1,restDates:[]}));
    const draft = generateDraft({roomCode,role:'anchor',startDate:'2026-09-01',endDate:'2026-09-03',roster});
    const lowest = ROOM_PLANNING[roomCode].anchorShifts.at(-1);
    assert.equal(draft.assignments.some(item=>item.shiftCode===lowest&&['甲','乙'].includes(item.name)), false);
  }
});

test('makeup monthly draft uses AC1 F Q for three staff and AC1 Q when one rests', () => {
  const draft = generateMakeupDraft({month:'2026-09',roster:[{name:'甲',restDates:['2026-09-02']},{name:'乙',restDates:[]},{name:'丙',restDates:[]}]});
  assert.deepEqual(new Set(draft.assignments.filter(item=>item.date==='2026-09-01'&&!item.rest).map(item=>item.shiftCode)),new Set(['AC1','F','Q']));
  assert.deepEqual(new Set(draft.assignments.filter(item=>item.date==='2026-09-02'&&!item.rest).map(item=>item.shiftCode)),new Set(['AC1','Q']));
  assert.equal(Math.max(...draft.attendance.map(item=>item.workDays))-Math.min(...draft.attendance.map(item=>item.workDays))<=1,true);
});

test('makeup source parser stays inside the selected month block and ignores summary rows', () => {
  const rows = [
    ['化妆师', '8月1日'], ['', '星期六'], ['旧化妆师', 'F（08:00-17:00）'], ['休息', ''],
    ['', ''], ['化妆师', '9月1日'], ['', '星期二'],
    ['肖慧萍', 'F（08:00-17:00）'], ['邓艳佳', 'Q（09:30-18:30）'], ['曾恩彤', 'AC1（07:30-16:30）'],
    ['AC1（07:30-16:30）', ''], ['化妆师', 'AC1（07:30-16:30）'], ['肖慧萍', '10'], ['邓艳佳', '10'], ['曾恩彤', '10'],
  ];
  const parsed = parseMakeupScheduleRows(rows, '2026-09-01', new Date('2026-09-01T02:00:00Z'));
  assert.equal(parsed.headerRow, 5);
  assert.deepEqual(parsed.roster, ['肖慧萍', '邓艳佳', '曾恩彤']);
  assert.deepEqual(parsed.people.map((person) => person.name), ['肖慧萍', '邓艳佳', '曾恩彤']);
  assert.deepEqual(parsed.people.map((person) => person.shiftCode), ['F（08:00-17:00）', 'Q（09:30-18:30）', 'AC1（07:30-16:30）']);
});

test('wangou auto-rests above four anchors and rotates the top resource position', () => {
  const roster=['甲','乙','丙','丁','戊'].map((name,index)=>({name,rank:index+1,entitlement:4,restDates:[]}));
  const draft=generateDraft({roomCode:'wangou',role:'anchor',startDate:'2026-09-02',endDate:'2026-09-09',roster,eventDates:['2026-09-09']});
  assert.deepEqual(draft.eventDates,['2026-09-09']);
  assert.equal(draft.assignments.filter(item=>item.restReason==='人数超过 4 人自动轮休').length,8);
  assert.ok(new Set(draft.assignments.filter(item=>item.name==='甲'&&!item.rest).map(item=>item.shiftCode)).size>1);
  assert.ok(draft.assignments.filter(item=>item.shiftCode==='M').every(item=>item.name==='丙'&&item.targetRoomCode==='brand_selection'));
  assert.ok(draft.anchorResourceSummary.every(item=>Number.isFinite(item.actualWorkDays)));
});

test('parses the authorized monthly schedule without treating blanks as rest or work', () => {
  const rows = [['姓名', '直播间', '2026/9/1', '2026/9/2', '2026/9/3'], ['主播甲', '官旗', 'L', '', '休'], ['尹珩瑞', '官旗', 'A', 'X', '休'], ['肖慧萍', '官旗', 'L', '', '休']];
  const people = parseRestSource(rows, '2026-09', { 主播甲: { roomName: '品牌精选', entitlement: 4, compNote: '9月补班一次' } });
  assert.equal(people.length, 1);
  assert.equal(people[0].roomName, '品牌精选');
  assert.equal(people[0].remainingRest, 3);
  assert.deepEqual(people[0].calendar.map((item) => item.status), ['work', 'unassigned', 'rest']);
});

test('filters the real attendance-table schema to the verified anchor roster', () => {
  const rows = [
    ['UID', '部门', '工号', '', '2026/9/1\n周二', '2026/9/2\n周三'],
    ['1', '凡岛-品牌营销部-直播中心-官旗', 'FD-1', '赵媛', 'L（05:30-14:30）', '休息'],
    ['2', '凡岛-品牌营销部-直播中心-优选', 'FD-2', '杜润瀚', 'W（09:00-18:00）', 'R（06:30-15:30）'],
    ['3', '凡岛-品牌营销部-直播中心-官旗', 'FD-3', '尹珩瑞', 'P（16:30-01:00）', '休息'],
  ];
  const people = parseRestSource(rows, '2026-09');
  assert.deepEqual(people.map((person) => person.name), ['赵媛']);
  assert.equal(people[0].roomName, '官旗');
  assert.deepEqual(people[0].calendar.map((day) => day.status), ['work', 'rest']);
});

test('cross-month rest calculation carries the previous month work streak', () => {
  const august = [['姓名','2026/8/29','2026/8/30','2026/8/31'],['赵媛','L','L','L']];
  const september = [['姓名','2026/9/1','2026/9/2','2026/9/3','2026/9/4'],['赵媛','L','L','L','']];
  const people = parseRestSources([{month:'2026-08',rows:august},{month:'2026-09',rows:september}], '2026-09', {赵媛:{entitlement:4,roomName:'官旗'}});
  assert.equal(people[0].maximumConsecutiveWorkDays, 6);
  assert.equal(people[0].suggestedRestDate, '2026-09-04');
});

test('rest advice requires six complete consecutive calendar days', () => {
  const parse = rows => parseRestSources([{month:'2026-09',rows}], '2026-09', {赵媛:{roomName:'官旗'}})[0];
  assert.equal(parse([['姓名','2026/9/1'],['赵媛','']]).suggestedRestDate,null);
  assert.equal(parse([['姓名','2026/9/1','2026/9/2'],['赵媛','L','']]).suggestedRestDate,null);
  const gap=parse([['姓名','2026/9/1','2026/9/2','2026/9/3','2026/9/5','2026/9/6','2026/9/7','2026/9/8'],['赵媛','L','L','L','L','L','L','']]);
  assert.equal(gap.maximumConsecutiveWorkDays,3);
  assert.equal(gap.suggestedRestDate,null);
});

test('compensation note adjusts the global rest entitlement without treating it as a manual save', () => {
  assert.equal(restAdjustmentFromNote('上月多休一天'), -1);
  assert.equal(restAdjustmentFromNote('上月少休2天'), 2);
  const rows=[['姓名','2026/9/1'],['赵媛','L']];
  const [person]=parseRestSource(rows,'2026-09',{赵媛:{roomName:'官旗',entitlement:7,compNote:'上月多休一天'}});
  assert.equal(person.baseEntitlement,7);assert.equal(person.entitlement,6);assert.equal(person.remainingRest,6);
});

test('builds an exact total-schedule import preview and exposes unresolved names', () => {
  const rows = [['', '', '', ''], ['姓名', '直播间', '2026/9/1', '2026/9/2'], ['甲', '优选', '', 'R'], ['乙', '优选', 'M', '']];
  const draft = { roomCode: 'youxuan', roomName: '优选', role: 'anchor', startDate: '2026-09-01', endDate: '2026-09-02', dates: ['2026-09-01', '2026-09-02'], assignments: [{ date: '2026-09-01', name: '甲', shiftCode: 'R' }, { date: '2026-09-02', name: '乙', shiftCode: 'M' }, { date: '2026-09-02', name: '未入总表', shiftCode: 'X' }] };
  const plan = buildPlanningImportPlan(draft, rows, 12);
  assert.equal(plan.resolvedCount, 2); assert.equal(plan.unresolved.length, 1); assert.equal(plan.ranges.length, 2); assert.equal(plan.overwrites.length, 0); assert.match(plan.expectedHash, /^[a-f0-9]{64}$/u); assert.equal(headerDateKey('9月2日', '2026'), '2026-09-02');
  assert.equal(plan.ranges[0].after.includes('R（06:30-15:30）'), true);
  assert.equal(formatShiftCell({shiftCode:'休',rest:true}), '休息');
});

test('total-schedule preview uses the currently resolved spreadsheet target', () => {
  const rows = [['姓名', '2026/9/1'], ['甲', '']];
  const draft = { roomCode:'guanqi', roomName:'官旗', role:'anchor', startDate:'2026-09-01', endDate:'2026-09-01', dates:['2026-09-01'], assignments:[{date:'2026-09-01',name:'甲',shiftCode:'L'}] };
  const target = {spreadsheetToken:'current-token',sheetId:'current-sheet',label:'当前总表'}; const plan = buildPlanningImportPlan(draft, rows, 3, target);
  assert.equal(plan.target.spreadsheetToken, 'current-token'); assert.match(plan.ranges[0].range, /^current-sheet!/u);
});

test('makeup import appends a new month without overwriting historical rows', () => {
  const rows = [['化妆师','2026/6/1'],['星期','周一'],['刘玉婷','AC1（07:30-16:30）'],['肖慧萍','Q（09:30-18:30）']];
  const draft = generateMakeupDraft({month:'2026-09',roster:[{name:'刘玉婷',restDates:[]},{name:'肖慧萍',restDates:[]}]});
  const target = {spreadsheetToken:'makeup-token',sheetId:'33648c',label:'化妆师排班'}; const plan = buildMakeupImportPlan(draft, rows, 8, target);
  assert.equal(plan.mode, 'append'); assert.equal(plan.unresolved.length, 0); assert.equal(plan.overwrites.length, 0); assert.match(plan.ranges[0].range, /^33648c!A6:/u); assert.equal(plan.ranges[0].values[0][1], '2026/9/1');
});

test('dispatch UI exposes four-room anchor and assistant planning, global rest entitlement and shared makeup duty', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'); const script = fs.readFileSync(path.join(__dirname, 'planning-workbench.js'), 'utf8'); const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'); const css = fs.readFileSync(path.join(__dirname, 'planning-workbench-20260829.css'), 'utf8');
  for (const label of ['化妆师月度排班', '预览导入化妆师表', '确认导入并回读', '月度排班工作台', '助理预排', '主播休息统计与连播预警', '全员固定月应休', '保存月应休', '筛选主播', '导入上期排班', '预览导入总表']) assert.match(html, new RegExp(label));
  assert.equal((html.match(/data-planning-role="assistant"/gu) || []).length, 4);
  assert.doesNotMatch(html, /肖慧萍|邓艳佳|曾恩彤/u);
  for (const guard of ['/api/planning/rest-profile', '/api/planning/rest-setting', '/api/planning/makeup/generate', '/api/planning/makeup/import/preview', '/api/planning/import/preview', 'expectedHash', 'allowOverwrite', 'readbacks', 'setDispatchMakeupDuty']) assert.match(script, new RegExp(guard));
  assert.match(script, /data-pick-rest-date/);assert.match(script, /applyDefaultEntitlement/);
  assert.match(app, /shared-makeup-row/u); assert.doesNotMatch(app, /roomMakeup/u);
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/u);
});

test('rest board follows the currently viewed schedule month instead of the next planning month', () => {
  const script = fs.readFileSync(path.join(__dirname, 'planning-workbench.js'), 'utf8');
  assert.ok(script.includes("$('#restMonth').value = currentScheduleDate().slice(0, 7)"));
  assert.equal(script.includes("$('#restMonth').value = defaultRange('guanqi', 'assistant')[0].slice(0, 7)"), false);
});
