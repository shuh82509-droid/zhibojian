'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOM_PLANNING, SHIFT_TIMES, formatShiftCell, generateDraft, generateMakeupDraft, parseRestSource, parseRestSources, restAdjustmentFromNote, transitionAllowed } = require('./planning-engine');
const SHIFT_LEGEND = '班次信息: L（05:30-14:30）: 05:30 ~ 14:30; R（06:30-15:30）: 06:30 ~ 15:30; M（21:30-05:00）: 21:30 ~ 次日 05:00; P（16:30-01:00）: 16:30 ~ 次日 01:00; J2（14:30-23:00）: 14:30 ~ 23:00';
const { alignPlanningRangeRow, assertPlanningFormulaRow, buildMakeupImportPlan, buildPlanningImportPlan, buildPlanningRoleEvidence, changedRowRanges, fullScheduleRange, headerDateKey, parseMakeupScheduleRows, planningReadbackState, spreadsheetValueRows, validateWriteOrigin } = require('./schedule-api-server');

function provenRole(draft) {
  const claims = {}, monthlyClaims = {}, timelineShifts = {}, roster = {};
  for (const item of draft.assignments) {
    const claim = {roomCode:draft.roomCode,role:draft.role};
    const key = `${item.date}|${item.name}`;
    claims[key] = [claim];
    monthlyClaims[`${item.date.slice(0,7)}|${item.name}`] = [claim];
    if (item.shiftCode !== '休' && !item.rest) {
      const [start,end] = String(item.shiftTime || SHIFT_TIMES[item.shiftCode]).replace(/次日/gu,'').split(/[–—-]/u);
      const minutes=(clock)=>{const [hour,minute]=clock.split(':').map(Number);return hour*60+minute;};
      const startMinute=minutes(start),endMinute=minutes(end);
      timelineShifts[key] = [{...claim,startMinute,endMinute:endMinute<=startMinute?endMinute+1440:endMinute}];
      roster[key] = [{roomCode:draft.roomCode,raw:`${item.shiftCode}（${item.shiftTime || SHIFT_TIMES[item.shiftCode]}）`}];
    }
  }
  return {completeDates:[...new Set(draft.assignments.map((item)=>item.date))],completeMonths:[...new Set(draft.assignments.map((item)=>item.date.slice(0,7)))],claims,monthlyClaims,timelineShifts,roster,timelineMentions:{},signature:'test-role-source'};
}

test('candidate dispatch page keeps planning API requests within its own route',()=>{
  for(const [file,variable] of [['planning-workbench.js','planningBase'],['app.js','apiBase']]){
    const script=fs.readFileSync(path.join(__dirname,file),'utf8');
    const statements=script.split(/\r?\n/u).filter(line=>line.includes('const hubDispatchPath =')||line.includes(`const ${variable} =`)).join('\n').replaceAll('const ','var ');
    const baseFor=pathname=>vm.runInNewContext(`${statements}\n${variable}`,{window:{location:{protocol:'https:',pathname}}});
    assert.equal(baseFor('/yxb/wis-marketing-hub/live-flow-candidate-r55/modules/dispatch-center/'),'/yxb/wis-marketing-hub/live-flow-candidate-r55/modules/dispatch-center',file);
    assert.equal(baseFor('/yxb/wis-marketing-hub/modules/dispatch-center/'),'/yxb/wis-marketing-hub/modules/dispatch-center',file);
    assert.equal(baseFor('/fd-027340/dispatch-center/'),'/fd-027340/dispatch-center',file);
    assert.equal(baseFor('/not-a-dispatch-route/'),'',file);
  }
});

test('planning defaults include only verified single anchor names, never unresolved co-broadcast labels', () => {
  const script = fs.readFileSync(path.join(__dirname, 'planning-workbench.js'), 'utf8');
  const start = script.indexOf('  function verifiedDefaultAnchorName(');
  const end = script.indexOf('\n  function matchingSavedDraft(', start);
  assert(start > 0 && end > start);
  const date = '2026-09-25';
  const scheduleData = { [date]: [{ code:'guanqi', name:'官旗', anchors:[
    ['05:30','07:00','丁阳虹'],
    ['07:00','08:00','丁阳虹','丁阳虹&曹总（老板场）'],
    ['08:00','10:00','潘小慧&其他人'],
    ['10:00','11:00','待定'],
    ['11:00','13:00','潘小慧'],
    ['13:00','14:00','曹总'],
  ] }] };
  const readDefaults = vm.runInNewContext(`${script.slice(start,end)}\nanchorsFromCurrentSchedule`, {
    scheduleData, currentScheduleDate:()=>date,
  });
  assert.deepEqual([...readDefaults('guanqi')], ['丁阳虹','潘小慧']);
  assert.equal(scheduleData[date][0].anchors[2][2], '潘小慧&其他人');
});

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
  assert.equal(people[0].remainingRest, null, 'partial dates cannot yield a final rest balance');
  assert.match(people[0].remainingRestReason, /日期列不完整/u);
  assert.deepEqual(people[0].calendar.map((item) => item.status), ['work', 'unassigned', 'rest']);
});

test('only explicit rest is counted; generic leave and unresolved cells never become monthly rest', () => {
  const rows = [
    ['UID','部门','工号','','2026/9/1','2026/9/2','2026/9/3','2026/9/4','2026/9/5','2026/9/6'],
    ['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛','休息','年假','调休','病假','','L（05:30-14:30）'],
  ];
  const [person] = parseRestSource(rows,'2026-09',{赵媛:{entitlement:4}});
  assert.equal(person.usedRest,1);
  assert.deepEqual(person.calendar.map((day)=>day.status),['rest','leave','leave','leave','unassigned','work']);
  assert.equal(person.remainingRest,null);
  assert.equal(person.monthComplete,false);
  assert.match(person.remainingRestReason,/日期列不完整/u);
});

test('cross-room and missing formal identity cannot present a final rest balance', () => {
  const header=['UID','部门','工号','','2026/9/1'];
  const row=['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛','休息'];
  const crossRoom=parseRestSource([header,row],'2026-09',{赵媛:{entitlement:4,roomName:'官旗'}},{赵媛:'直播间待核验'})[0];
  assert.equal(crossRoom.sourceStatus,'ambiguous');
  assert.equal(crossRoom.remainingRest,null);
  assert.match(crossRoom.sourceReason,/跨房/u);
  const missingIdentity=parseRestSource([header,['','凡岛-品牌营销部-直播中心-官旗','','赵媛','休息']],'2026-09',{赵媛:{entitlement:4}})[0];
  assert.equal(missingIdentity.sourceStatus,'ambiguous');
  assert.equal(missingIdentity.remainingRest,null);
  assert.match(missingIdentity.sourceReason,/身份/u);
});

test('even a complete month cannot show final remaining rest until person-level cross-room policy is settled', () => {
  const dates=Array.from({length:30},(_,index)=>`2026/9/${index+1}`);
  const values=dates.map((_,index)=>index===0?'休息':'L（05:30-14:30）');
  const rows=[['UID','部门','工号','',...dates],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛',...values]];
  const [person]=parseRestSource(rows,'2026-09',{赵媛:{entitlement:4}});
  assert.equal(person.sourceStatus,'matched');
  assert.equal(person.monthComplete,true);
  assert.equal(person.usedRest,1);
  assert.equal(person.remainingRest,null);
  assert.match(person.remainingRestReason,/跨直播间个人休息规则待确认/u);
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
  assert.equal(person.baseEntitlement,7);assert.equal(person.entitlement,7);
  assert.equal(person.restAdjustment,null,'free-text history is not an approved entitlement adjustment');
  assert.equal(person.remainingRest,null,'a compensation note cannot finalize a partial-month balance');
});

test('compound carry-over notes remain visible but never change monthly entitlement', () => {
  const dates=Array.from({length:30},(_,index)=>`2026/9/${index+1}`);
  const rows=[['UID','部门','工号','',...dates],
    ['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛',...dates.map(()=> 'L（05:30-14:30）')]];
  const [person]=parseRestSource(rows,'2026-09',{赵媛:{entitlement:7,compNote:'上月多休一天，另有调班两次待核'}});
  assert.equal(person.compNote,'上月多休一天，另有调班两次待核');
  assert.equal(person.entitlement,7);
  assert.equal(person.restAdjustment,null);
  assert.equal(person.remainingRest,null);
  assert.match(person.remainingRestReason,/补班备注/u);
});

test('builds an exact total-schedule import preview and exposes unresolved names', () => {
  const rows = [[SHIFT_LEGEND], ['UID', '部门', '工号', '', '2026/9/1', '2026/9/2'], ['u-1', '凡岛-品牌营销部-直播中心-优选', 'FD-1', '甲', '', 'R'], ['u-2', '凡岛-品牌营销部-直播中心-优选', 'FD-2', '乙', 'M', '']];
  const draft = { roomCode: 'youxuan', roomName: '优选', role: 'anchor', startDate: '2026-09-01', endDate: '2026-09-02', dates: ['2026-09-01', '2026-09-02'], assignments: [{ date: '2026-09-01', name: '甲', shiftCode: 'R' }, { date: '2026-09-02', name: '乙', shiftCode: 'M' }, { date: '2026-09-02', name: '未入总表', shiftCode: 'X' }] };
  const plan = buildPlanningImportPlan(draft, rows, 12, undefined, provenRole(draft));
  assert.equal(plan.resolvedCount, 2); assert.equal(plan.unresolved.length, 1); assert.equal(plan.ranges.length, 2); assert.equal(plan.overwrites.length, 0); assert.match(plan.expectedHash, /^[a-f0-9]{64}$/u); assert.equal(headerDateKey('9月2日', '2026'), '2026-09-02');
  assert.equal(plan.ranges[0].after.includes('R（06:30-15:30）'), true);
  assert.equal(formatShiftCell({shiftCode:'休',rest:true}), '休息');
});

test('total-schedule preview uses the currently resolved spreadsheet target', () => {
  const rows = [[SHIFT_LEGEND], ['UID', '部门', '工号', '', '2026/9/1'], ['u-1', '凡岛-品牌营销部-直播中心-官旗', 'FD-1', '甲', '']];
  const draft = { roomCode:'guanqi', roomName:'官旗', role:'anchor', startDate:'2026-09-01', endDate:'2026-09-01', dates:['2026-09-01'], assignments:[{date:'2026-09-01',name:'甲',shiftCode:'L'}] };
  const target = {spreadsheetToken:'current-token',sheetId:'current-sheet',label:'当前总表'}; const plan = buildPlanningImportPlan(draft, rows, 3, target, provenRole(draft));
  assert.equal(plan.target.spreadsheetToken, 'current-token'); assert.match(plan.ranges[0].range, /^current-sheet!/u);
});

test('total import fingerprint binds the exact after value and leaves intervening cells out of write ranges', () => {
  const rows = [[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1','2026/9/2','2026/9/3'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','甲','','他人公式结果','']];
  const base = {roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-03',dates:['2026-09-01','2026-09-03'],assignments:[{date:'2026-09-01',name:'甲',shiftCode:'L'},{date:'2026-09-03',name:'甲',shiftCode:'P'}]};
  const target = {spreadsheetToken:'current-token',sheetId:'0jFdXf',label:'正式排班表'};
  const plan = buildPlanningImportPlan(base, rows, 498, target, provenRole(base));
  assert.deepEqual(plan.ranges.map((range) => range.range), ['0jFdXf!E3:E3','0jFdXf!G3:G3']);
  assert.equal(plan.ranges.some((range) => range.range.includes('F3')), false);
  assert.notEqual(buildPlanningImportPlan({...base,assignments:[{...base.assignments[0],shiftCode:'J2'},base.assignments[1]]},rows,498,target,provenRole(base)).expectedHash,plan.expectedHash);
});

test('total import omits already-correct cells instead of rewriting their formulas or formatting', () => {
  const rows = [[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1','2026/9/2'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','甲','L（05:30-14:30）','']];
  const draft = {roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-02',dates:['2026-09-01','2026-09-02'],assignments:[{date:'2026-09-01',name:'甲',shiftCode:'L'},{date:'2026-09-02',name:'甲',shiftCode:'P'}]};
  const plan = buildPlanningImportPlan(draft,rows,498,{spreadsheetToken:'test-token',sheetId:'test-sheet'},provenRole(draft));
  assert.equal(plan.noChangeCount,1);
  assert.deepEqual(plan.ranges.map(item=>item.range),['test-sheet!F3:F3']);
  assert.equal(plan.overwrites.length,0);
});

test('total import formula inspection fails closed on formulas and unverifiable occupied cells', () => {
  const item = {range:'test-sheet!E3:F3',before:['原值',''],after:['新值','P']};
  assert.doesNotThrow(()=>assertPlanningFormulaRow(item,['原值','']));
  assert.throws(()=>assertPlanningFormulaRow(item,['=A1','']),error=>error.code==='TOTAL_SCHEDULE_FORMULA_PROTECTED');
  assert.throws(()=>assertPlanningFormulaRow(item,[]),error=>error.code==='TOTAL_SCHEDULE_FORMULA_UNVERIFIED');
});

test('single-range parser recognizes only the documented explicit empty range and rejects malformed readback', () => {
  assert.deepEqual(spreadsheetValueRows({data:{valueRange:{range:'',majorDimension:'ROWS'}}}),[]);
  assert.deepEqual(spreadsheetValueRows({data:{valueRange:{range:'',values:[]}}}),[]);
  assert.deepEqual(spreadsheetValueRows({data:{valueRange:{range:'test-sheet!E3:E3',values:[['L']]}}}),[['L']]);
  assert.throws(()=>spreadsheetValueRows({data:{}}),error=>error.code==='SHEET_READBACK_UNVERIFIED');
  assert.throws(()=>spreadsheetValueRows({data:{valueRange:{range:'test-sheet!E3:E3'}}}),error=>error.code==='SHEET_READBACK_UNVERIFIED');
  assert.throws(()=>spreadsheetValueRows({data:{valueRange:{range:'test-sheet!E3:E3',values:[]}}}),error=>error.code==='SHEET_READBACK_UNVERIFIED');
  assert.throws(()=>spreadsheetValueRows({data:{valueRange:{range:'test-sheet!E3:E3',values:[null]}}}),error=>error.code==='SHEET_READBACK_UNVERIFIED');
});

test('exact cell readback aligns a trimmed Feishu range without shifting the column', () => {
  assert.deepEqual(alignPlanningRangeRow('test-sheet!E3:F3','test-sheet!F3:F3',[['P']]),['','P']);
  assert.deepEqual(alignPlanningRangeRow('test-sheet!E3:F3','',[]),['','']);
  assert.throws(()=>alignPlanningRangeRow('test-sheet!E3:F3','test-sheet!D3:E3',[['L','P']]),error=>error.code==='SHEET_READBACK_UNVERIFIED');
  assert.throws(()=>assertPlanningFormulaRow({range:'test-sheet!E3:F3',before:['原值',''],after:['新值','P']},['','P']),error=>error.code==='TOTAL_SCHEDULE_FORMULA_UNVERIFIED');
});

test('legacy room writeback writes only changed cells and preserves same-value formula cells', () => {
  assert.deepEqual(changedRowRanges('test-sheet!E3:G3',['L','公式显示值',''],['L','公式显示值','P']),[{range:'test-sheet!G3:G3',before:[''],after:['P'],row:3}]);
  assert.deepEqual(changedRowRanges('test-sheet!E3:G3',['L','公式显示值','P'],['L','公式显示值','P']),[]);
});

test('exact import readback differentiates success, unchanged, mixed, and missing responses', () => {
  const ranges = [{before:['','旧值'],after:['L','P']}];
  assert.equal(planningReadbackState(ranges,[['L','P']]),'after');
  assert.equal(planningReadbackState(ranges,[['','旧值']]),'before');
  assert.equal(planningReadbackState(ranges,[['L','旧值']]),'mixed');
  assert.equal(planningReadbackState(ranges,[[]]),'unverified');
});

test('dispatch write origin accepts only the two exact hub origins', () => {
  const request = origin=>({headers:{origin,'x-requested-with':'XMLHttpRequest'}});
  for (const origin of ['https://app.fandow.top','https://hub.fandow.com']) assert.doesNotThrow(()=>validateWriteOrigin(request(origin),{mode:'central'}));
  for (const origin of ['https://hub.fandow.com.evil.test','http://hub.fandow.com','https://other.fandow.com']) assert.throws(()=>validateWriteOrigin(request(origin),{mode:'central'}),/跨站写回/u);
  assert.throws(()=>validateWriteOrigin({headers:{origin:'https://hub.fandow.com'}},{mode:'central'}),/写回请求标识/u);
});

test('total import blocks duplicate names and unrelated departments instead of choosing first match', () => {
  const rows = [[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','甲',''],['u-2','凡岛-品牌营销部-直播中心-品牌精选','FD-2','甲',''],['u-3','凡岛-电商部','FD-3','乙','']];
  const draft = {roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'甲',shiftCode:'L'},{date:'2026-09-01',name:'乙',shiftCode:'P'}]};
  const plan = buildPlanningImportPlan(draft,rows,498,{spreadsheetToken:'current-token',sheetId:'0jFdXf'},provenRole(draft));
  assert.equal(plan.ranges.length,0);
  assert.deepEqual(plan.unresolved.map((item)=>item.reason),['正式总表存在同名人员，须用唯一身份核验','人员不在直播中心部门']);
});

test('total import selects the exact attendance template when a shift code has multiple times', () => {
  const legend = '班次信息: ZBB（18:30-次日2:00）: 18:30 ~ 次日 02:00; ZBB(21:00-次日6:00): 21:00 ~ 次日 06:00; WB(17:30-次日02:00): 17:30 ~ 次日 02:00; WB(22：30—次日6：00): 22:30 ~ 次日 06:00';
  const rows = [[legend],['UID','部门','工号','','2026/9/1','2026/9/2'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','甲','','']];
  const draft = {roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-02',dates:['2026-09-01','2026-09-02'],assignments:[{date:'2026-09-01',name:'甲',shiftCode:'ZBB',shiftTime:'18:30–次日02:00'},{date:'2026-09-02',name:'甲',shiftCode:'WB',shiftTime:'22:30–次日06:00'}]};
  const plan = buildPlanningImportPlan(draft,rows,498,{spreadsheetToken:'current-token',sheetId:'0jFdXf'},provenRole(draft));
  assert.deepEqual(plan.ranges[0].after,['ZBB（18:30-次日2:00）','WB(22：30—次日6：00)']);
  const bad = buildPlanningImportPlan({...draft,assignments:[{...draft.assignments[0],shiftTime:'20:00-次日03:00'},draft.assignments[1]]},rows,498,{spreadsheetToken:'current-token',sheetId:'0jFdXf'},provenRole(draft));
  assert.equal(bad.unresolved[0].reason,'班次时间不符合原表考勤模板');
});

test('full source range follows sheet dimensions and rejects unknown bounds', () => {
  assert.equal(fullScheduleRange({sheetId:'0jFdXf',rowCount:190,columnCount:34}),'0jFdXf!A1:AH190');
  assert.throws(()=>fullScheduleRange({sheetId:'0jFdXf',rowCount:0,columnCount:34}),/尺寸异常/u);
});

test('rest source surfaces duplicate anchor rows as unverified rather than calculating a false zero', () => {
  const rows = [['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛','休息'],['u-2','凡岛-品牌营销部-直播中心-官旗','FD-2','赵媛','L']];
  const [person] = parseRestSource(rows,'2026-09');
  assert.equal(person.sourceStatus,'ambiguous'); assert.equal(person.usedRest,null); assert.equal(person.calendar.length,0);
});

test('rest source does not double-count a repeated date column', () => {
  const rows = [['UID','部门','工号','','2026/9/1','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛','休息','休息']];
  const [person] = parseRestSource(rows,'2026-09');
  assert.equal(person.sourceStatus,'ambiguous');
  assert.match(person.sourceReason,/重复日期列/u);
  assert.equal(person.usedRest,null);assert.equal(person.remainingRest,null);assert.deepEqual(person.calendar,[]);
});

function liveRoleSheets(people={}) {
  const selected=(value,day)=>typeof value==='function'?value(day):value||'';
  const block=(roomCode,day,anchor='',assistant='')=>{
    const anchorName=selected(anchor,day);
    const rows=[[`9月${day}日`,'','时间','05:30-08:00'],['','','主播',anchorName],['','','','05:30-10:00'],['','','',selected(assistant,day)]];
    if(anchorName){const personColumn=roomCode==='guanqi'?13:1;rows[0][personColumn]=anchorName;rows[0][personColumn+1]='L（05:30-14:30）';}
    return rows;
  };
  return Object.fromEntries(['guanqi','brand_selection','youxuan','wangou'].map(roomCode=>[roomCode,{rows:Array.from({length:30},(_,index)=>block(roomCode,index+1,people[roomCode]?.anchor,people[roomCode]?.assistant)).flat(),revision:189107}]));
}

test('full-month four-room timelines prove role and rest; missing, conflicting, or stale sources block total import', () => {
  const rows=[[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛',''],['u-2','凡岛-品牌营销部-直播中心-官旗','FD-2','尹珩瑞','']];
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  const assignment=(name,shiftCode='L')=>({date:'2026-09-01',name,shiftCode});
  const draft=(name,role='anchor',roomCode='guanqi',shiftCode='L')=>({roomCode,role,startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[assignment(name,shiftCode)]});
  const sheets=liveRoleSheets({guanqi:{anchor:'赵媛',assistant:'尹珩瑞'}});
  const anchor=draft('赵媛');
  const proof=buildPlanningRoleEvidence(anchor,sheets);
  assert.deepEqual(proof.claims['2026-09-01|赵媛'],[{roomCode:'guanqi',role:'anchor'}]);
  assert.deepEqual(proof.claims['2026-09-01|尹珩瑞'],[{roomCode:'guanqi',role:'assistant'}]);
  assert.deepEqual(proof.completeMonths,['2026-09']);
  assert.equal(buildPlanningImportPlan(anchor,rows,504,target,proof).ranges.length,1);
  const wrongRole=buildPlanningImportPlan(draft('尹珩瑞'),rows,504,target,proof);
  assert.equal(wrongRole.ranges.length,0);assert.match(wrongRole.unresolved[0].reason,/岗位或直播间/u);
  const wrongRoom=buildPlanningImportPlan(draft('赵媛','anchor','youxuan'),rows,504,target,proof);
  assert.equal(wrongRoom.ranges.length,0);assert.match(wrongRoom.unresolved[0].reason,/总表部门直播间/u);
  const rest=buildPlanningImportPlan(draft('未在时间轴','anchor','guanqi','休'),[[SHIFT_LEGEND],rows[1],['u-3','凡岛-品牌营销部-直播中心-官旗','FD-3','未在时间轴','']],504,target,proof);
  assert.equal(rest.ranges.length,0);assert.match(rest.unresolved[0].reason,/休息或未排班待核验/u);
  assert.equal(rest.assignmentCount,1,'休息草稿仍保留在预览中');
  const restingAnchor=draft('赵媛','anchor','guanqi','休');
  const restingProof=buildPlanningRoleEvidence(restingAnchor,liveRoleSheets({guanqi:{anchor:(day)=>day===1?'':'赵媛'}}));
  const absentRest=buildPlanningImportPlan(restingAnchor,rows,504,target,restingProof);
  assert.equal(absentRest.ranges.length,0,'other days cannot turn an absent person into explicit rest');
  assert.match(absentRest.unresolved[0].reason,/缺席或空白不能写为休息/u);
  const explicitRestSheets=liveRoleSheets({guanqi:{anchor:(day)=>day===1?'':'赵媛'}});
  explicitRestSheets.guanqi.rows[0][13]='赵媛';
  explicitRestSheets.guanqi.rows[0][14]='休息';
  const explicitRest=buildPlanningImportPlan(restingAnchor,rows,504,target,buildPlanningRoleEvidence(restingAnchor,explicitRestSheets));
  assert.equal(explicitRest.ranges.length,1,'exact home-room rest evidence permits the precise cell');
  const workingOnRest=buildPlanningImportPlan(restingAnchor,rows,504,target,proof);
  assert.equal(workingOnRest.ranges.length,0);assert.match(workingOnRest.unresolved[0].reason,/仍有排播/u);
  const conflictSheets=liveRoleSheets({guanqi:{anchor:'赵媛'},brand_selection:{assistant:'赵媛'}});
  const conflict=buildPlanningImportPlan(anchor,rows,504,target,buildPlanningRoleEvidence(anchor,conflictSheets));
  assert.equal(conflict.ranges.length,0);assert.match(conflict.unresolved[0].reason,/跨房或兼任/u);
  const laterConflict=buildPlanningImportPlan(anchor,rows,504,target,buildPlanningRoleEvidence(anchor,liveRoleSheets({guanqi:{anchor:'赵媛'},brand_selection:{assistant:(day)=>day===2?'赵媛':''}})));
  assert.equal(laterConflict.ranges.length,0);assert.match(laterConflict.unresolved[0].reason,/整月跨房/u);
  const missingSheets=liveRoleSheets({guanqi:{anchor:'赵媛'}});missingSheets.wangou.rows=[];
  const missing=buildPlanningImportPlan(anchor,rows,504,target,buildPlanningRoleEvidence(anchor,missingSheets));
  assert.equal(missing.ranges.length,0);assert.match(missing.unresolved[0].reason,/来源不完整/u);
  const driftedSheets=liveRoleSheets({guanqi:{anchor:'赵媛'}});driftedSheets.wangou.revision=189108;
  assert.equal(buildPlanningRoleEvidence(anchor,driftedSheets).completeDates.length,0);
  const repeatedSheets=liveRoleSheets({guanqi:{anchor:'赵媛'}});repeatedSheets.wangou.rows.push(...repeatedSheets.wangou.rows);
  assert.equal(buildPlanningRoleEvidence(anchor,repeatedSheets).completeDates.length,0);
  assert.notEqual(buildPlanningRoleEvidence(anchor,sheets).signature,buildPlanningRoleEvidence(anchor,liveRoleSheets({guanqi:{anchor:'赵媛'},youxuan:{assistant:'另一人'}})).signature);
});

test('role proof anchors to the dated first pair and rejects unsupported work or occupied rest', () => {
  const rows=[[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心','FD-1','赵媛','']];
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  const draft=(shiftCode='L',rest=false)=>({roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'赵媛',shiftCode,rest}]});
  const sheets=liveRoleSheets({guanqi:{anchor:'赵媛',assistant:'尹珩瑞'}});
  sheets.guanqi.rows[2][4]='08:00-10:00';sheets.guanqi.rows[3][4]='尹珩瑞';
  const proof=buildPlanningRoleEvidence(draft(),sheets);
  assert.deepEqual(proof.claims['2026-09-01|赵媛'],[{roomCode:'guanqi',role:'anchor'}]);
  assert.deepEqual(proof.claims['2026-09-01|尹珩瑞'],[{roomCode:'guanqi',role:'assistant'}], 'a longer assistant range must not become the anchor');
  assert.equal(buildPlanningImportPlan(draft(),rows,504,target,proof).ranges.length,1,'the live-center department is allowed only with unique source-backed room and role');

  const wrongTime=liveRoleSheets({guanqi:{anchor:'赵媛'}});wrongTime.guanqi.rows[0][3]='20:00-23:00';
  const timePlan=buildPlanningImportPlan(draft(),rows,504,target,buildPlanningRoleEvidence(draft(),wrongTime));
  assert.equal(timePlan.ranges.length,0);assert.match(timePlan.unresolved[0].reason,/时间未覆盖/u);
  const wrongCode=liveRoleSheets({guanqi:{anchor:'赵媛'}});wrongCode.guanqi.rows[0][14]='GJ3(05:30-13:00)';
  const codePlan=buildPlanningImportPlan(draft(),rows,504,target,buildPlanningRoleEvidence(draft(),wrongCode));
  assert.equal(codePlan.ranges.length,0);assert.match(codePlan.unresolved[0].reason,/代码或时间/u);
  const missingRoster=liveRoleSheets({guanqi:{anchor:'赵媛'}});missingRoster.guanqi.rows[0][13]='';missingRoster.guanqi.rows[0][14]='';
  const missingPlan=buildPlanningImportPlan(draft(),rows,504,target,buildPlanningRoleEvidence(draft(),missingRoster));
  assert.equal(missingPlan.ranges.length,0);assert.match(missingPlan.unresolved[0].reason,/考勤班次缺失/u);

  const restDraft=draft('休',true);
  const workRoster=liveRoleSheets({guanqi:{anchor:(day)=>day===1?'':'赵媛'}});
  workRoster.guanqi.rows[0][13]='赵媛';workRoster.guanqi.rows[0][14]='L（05:30-14:30）';
  const workRest=buildPlanningImportPlan(restDraft,rows,504,target,buildPlanningRoleEvidence(restDraft,workRoster));
  assert.equal(workRest.ranges.length,0);assert.match(workRest.unresolved[0].reason,/考勤名单仍有工作/u);
  const pending=liveRoleSheets({guanqi:{anchor:(day)=>day===1?'':'赵媛'}});
  pending.guanqi.rows[2][3]='待定';pending.guanqi.rows[3][3]='赵媛';
  const pendingRest=buildPlanningImportPlan(restDraft,rows,504,target,buildPlanningRoleEvidence(restDraft,pending));
  assert.equal(pendingRest.ranges.length,0);assert.match(pendingRest.unresolved[0].reason,/来源不完整/u);
  const contrary=liveRoleSheets({guanqi:{anchor:'赵媛'}});contrary.guanqi.rows[1][2]='助理';
  assert.deepEqual(buildPlanningRoleEvidence(draft(),contrary).completeMonths,[]);
  assert.notEqual(buildPlanningRoleEvidence(draft(),sheets).signature,buildPlanningRoleEvidence(draft(),wrongCode).signature,'roster evidence changes the source signature');
  assert.notEqual(buildPlanningRoleEvidence(draft(),sheets).signature,buildPlanningRoleEvidence(draft(),wrongTime).signature,'timeline times change the source signature');
});

test('a blank or pending attendance cell is not evidence of rest', () => {
  const rows=[[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛','']];
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  const draft={roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'赵媛',shiftCode:'休',rest:true}]};
  const sheets=liveRoleSheets({guanqi:{anchor:(day)=>day===1?'':'赵媛'}});
  sheets.guanqi.rows[0][13]='赵媛';
  for (const raw of ['', '待排']) {
    sheets.guanqi.rows[0][14]=raw;
    const proof=buildPlanningRoleEvidence(draft,sheets);
    assert.deepEqual(proof.completeMonths,['2026-09']);
    assert.deepEqual(proof.roster['2026-09-01|赵媛'],[{roomCode:'guanqi',raw}]);
    const plan=buildPlanningImportPlan(draft,rows,504,target,proof);
    assert.equal(plan.ranges.length,0,`attendance ${JSON.stringify(raw)} must block a rest write`);
    assert.match(plan.unresolved[0].reason,/考勤名单仍有工作或待定/u);
  }
  sheets.guanqi.rows[0][13]='赵媛（待排）';
  for (const raw of ['', '休息']) {
    sheets.guanqi.rows[0][14]=raw;
    const annotated=buildPlanningRoleEvidence(draft,sheets);
    assert.deepEqual(annotated.roster['2026-09-01|赵媛'],[{roomCode:'guanqi',raw,unverifiedName:true}]);
    const plan=buildPlanningImportPlan(draft,rows,504,target,annotated);
    assert.equal(plan.ranges.length,0,'an annotated roster identity is not proof of rest');
    assert.match(plan.unresolved[0].reason,/姓名带未核验备注/u);
  }
  sheets.guanqi.rows[0][13]='赵媛';
  sheets.guanqi.rows[0][14]='休息';
  const valid=buildPlanningRoleEvidence(draft,sheets);
  assert.equal(buildPlanningImportPlan(draft,rows,504,target,valid).ranges.length,1,'an explicit rest entry is allowed when four-room timelines are complete');
});

test('a work shift cannot ignore an unparsed same-day support mention in another room', () => {
  const rows=[[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛','']];
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  const draft={roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'赵媛',shiftCode:'L'}]};
  const sheets=liveRoleSheets({guanqi:{anchor:'赵媛'}});
  const clean=buildPlanningRoleEvidence(draft,sheets);
  assert.deepEqual(clean.timelineMentionRooms['2026-09-01|赵媛'],['guanqi']);
  assert.equal(buildPlanningImportPlan(draft,rows,504,target,clean).ranges.length,1);
  sheets.brand_selection.rows.splice(4,0,['','','','赵媛支援']);
  const ambiguous=buildPlanningRoleEvidence(draft,sheets);
  assert.deepEqual(ambiguous.completeMonths,['2026-09'],'the note is not a parsed shift, but must still block this individual');
  assert.deepEqual(ambiguous.timelineMentionRooms['2026-09-01|赵媛'],['brand_selection','guanqi']);
  const plan=buildPlanningImportPlan(draft,rows,504,target,ambiguous);
  assert.equal(plan.ranges.length,0);
  assert.match(plan.unresolved[0].reason,/整月.*跨房.*核验/u);
});

test('month-wide room proof cannot ignore another day roster or unresolved support evidence', () => {
  // Synthetic local candidate data, not a snapshot or verification of the
  // production workbook revision. Live-source drift is checked before POST.
  const candidateRevision=505;
  const rows=[[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛','']];
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  for (const rest of [false,true]) {
    const draft={roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'赵媛',shiftCode:rest?'休':'L',rest}]};
    const source=()=>{
      const sheets=liveRoleSheets({guanqi:{anchor:(day)=>rest&&day===1?'':'赵媛'}});
      if(rest){sheets.guanqi.rows[0][13]='赵媛';sheets.guanqi.rows[0][14]='休息';}
      return sheets;
    };
    const clean=buildPlanningRoleEvidence(draft,source());
    assert.equal(buildPlanningImportPlan(draft,rows,candidateRevision,target,clean).ranges.length,1);
    assert.notEqual(buildPlanningImportPlan(draft,rows,candidateRevision,target,clean).expectedHash,
      buildPlanningImportPlan(draft,rows,candidateRevision-1,target,clean).expectedHash,
      'a prior target revision cannot reuse the current candidate preview hash');
    for (const kind of ['attendance','blank-attendance','annotated-attendance','support-note']) {
      const sheets=source();
      if(kind==='support-note') sheets.brand_selection.rows.splice(8,0,['','','','赵媛支援']);
      else {
        sheets.brand_selection.rows[4][1]=kind==='annotated-attendance'?'赵媛（支援）':'赵媛';
        sheets.brand_selection.rows[4][2]=kind==='blank-attendance'?'':'L（05:30-14:30）';
      }
      const proof=buildPlanningRoleEvidence(draft,sheets);
      assert.deepEqual(proof.completeMonths,['2026-09']);
      assert.deepEqual(proof.monthlyClaims['2026-09|赵媛'],[{roomCode:'guanqi',role:'anchor'}], 'absence of a parsed second role is not proof of a single room');
      const plan=buildPlanningImportPlan(draft,rows,candidateRevision,target,proof);
      assert.equal(plan.ranges.length,0,`${rest?'rest':'work'} must not ignore another-day ${kind}`);
      assert.match(plan.unresolved[0].reason,/整月.*跨房.*核验/u);
      assert.notEqual(proof.signature,clean.signature);
    }
    const unrelated=source();
    unrelated.brand_selection.rows[4][1]='另一同事';
    unrelated.brand_selection.rows[4][2]='L（05:30-14:30）';
    assert.equal(buildPlanningImportPlan(draft,rows,candidateRevision,target,buildPlanningRoleEvidence(draft,unrelated)).ranges.length,1,'unrelated colleagues cannot block this person');
    const anotherMonth=source();
    anotherMonth.brand_selection.rows.push(['10月1日','赵媛','L（05:30-14:30）','05:30-08:00'],['','','主播','赵媛']);
    assert.equal(buildPlanningImportPlan(draft,rows,candidateRevision,target,buildPlanningRoleEvidence(draft,anotherMonth)).ranges.length,1,'a different month cannot be silently merged into this month room evidence');
  }
});

test('unselected attendance columns and readable dated notes are negative evidence, never a new duty identity', () => {
  // Synthetic rev505 candidate cases; no live-source snapshot or write.
  const rows=[[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-品牌精选','FD-1','赵媛','']];
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  for (const rest of [false,true]) {
    const draft={roomCode:'brand_selection',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'赵媛',shiftCode:rest?'休':'L',rest}]};
    const source=()=>{
      const sheets=liveRoleSheets({brand_selection:{anchor:(day)=>rest&&day===1?'':'赵媛'}});
      if(rest){sheets.brand_selection.rows[0][1]='赵媛';sheets.brand_selection.rows[0][2]='休息';}
      return sheets;
    };
    const clean=buildPlanningRoleEvidence(draft,source());
    assert.equal(buildPlanningImportPlan(draft,rows,505,target,clean).ranges.length,1);
    for (const kind of ['alternate-empty','alternate-pending','dated-note']) {
      const sheets=source();
      if(kind==='dated-note') sheets.guanqi.rows[7][0]='赵媛支援';
      else {
        sheets.guanqi.rows[4][15]='赵媛（支援）';
        sheets.guanqi.rows[4][16]=kind==='alternate-empty'?'':'待核验';
        // Keep the first candidate pair selected even when the secondary shift
        // text is nonempty. Neither layout selection may erase the other name.
        if(kind==='alternate-pending'){sheets.guanqi.rows[5][13]='另一同事';sheets.guanqi.rows[5][14]='L（05:30-14:30）';}
      }
      const proof=buildPlanningRoleEvidence(draft,sheets);
      assert.deepEqual(proof.completeMonths,['2026-09']);
      assert.deepEqual(proof.monthlyClaims['2026-09|赵媛'],[{roomCode:'brand_selection',role:'anchor'}]);
      assert.deepEqual(proof.claims['2026-09-02|赵媛'],[{roomCode:'brand_selection',role:'anchor'}], 'negative evidence cannot create a Guanqi shift or role');
      if(kind!=='dated-note') assert.ok(proof.roster['2026-09-02|赵媛'].some((entry)=>entry.roomCode==='guanqi'&&entry.unverifiedName===true),'an unselected candidate column is never positive identity evidence');
      const plan=buildPlanningImportPlan(draft,rows,505,target,proof);
      assert.equal(plan.ranges.length,0,`${rest?'rest':'work'} cannot ignore ${kind}`);
      assert.match(plan.unresolved[0].reason,/整月.*跨房.*核验/u);
      assert.notEqual(proof.signature,clean.signature);
    }
    const undated=source();
    undated.guanqi.rows.unshift(['赵媛支援']);
    assert.equal(buildPlanningImportPlan(draft,rows,505,target,buildPlanningRoleEvidence(draft,undated)).ranges.length,1,'undated global text is not silently assigned to the selected month');
  }
  const homeDraft={roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'赵媛',shiftCode:'L'}]};
  const homeRows=structuredClone(rows);homeRows[2][1]='凡岛-品牌营销部-直播中心-官旗';
  const homeSheets=liveRoleSheets({guanqi:{anchor:'赵媛'}});
  homeSheets.guanqi.rows[0][15]='赵媛（支援）';homeSheets.guanqi.rows[0][16]='';
  const homePlan=buildPlanningImportPlan(homeDraft,homeRows,505,target,buildPlanningRoleEvidence(homeDraft,homeSheets));
  assert.equal(homePlan.ranges.length,0,'even in the home room a second unverified attendance identity cannot be silently accepted');
  assert.match(homePlan.unresolved[0].reason,/姓名带未核验备注/u);
});

test('only a pure terminal month-end footer can be ignored; dated or ambiguous support remains negative evidence', () => {
  // Synthetic local rev505 candidate, not a production workbook snapshot.
  const rows=[[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-品牌精选','FD-1','赵媛','']];
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  for (const rest of [false,true]) {
    const draft={roomCode:'brand_selection',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'赵媛',shiftCode:rest?'休':'L',rest}]};
    const source=()=>{
      const sheets=liveRoleSheets({brand_selection:{anchor:(day)=>rest&&day===1?'':'赵媛'}});
      if(rest){sheets.brand_selection.rows[0][1]='赵媛';sheets.brand_selection.rows[0][2]='休息';}
      return sheets;
    };
    const clean=buildPlanningRoleEvidence(draft,source());
    for(const footer of [[['本月汇总']],[['本月汇总'],[],['']]]) {
      const sheets=source();sheets.guanqi.rows.push(...footer);
      const proof=buildPlanningRoleEvidence(draft,sheets);
      assert.deepEqual(proof.monthlySourceRooms['2026-09|赵媛'],['brand_selection']);
      assert.equal(buildPlanningImportPlan(draft,rows,505,target,proof).ranges.length,1,'a pure terminal heading contains no person evidence');
      assert.equal(proof.signature,clean.signature,'unbound footer text cannot change dated source evidence');
    }
    for(const prefix of [[],[['本月汇总']]]) for(const text of ['10/1赵媛支援','10-01赵媛支援']) {
      const sheets=source();sheets.guanqi.rows.push(...prefix,[text]);
      assert.equal(buildPlanningImportPlan(draft,rows,505,target,buildPlanningRoleEvidence(draft,sheets)).ranges.length,1,'an explicitly next-month note is not September room evidence');
    }
    for(const kind of ['mid-month-footer','month-end-footer-followed-by-support','ambiguous-monthly-summary','month-end-summary-9/30','month-end-summary-09-30','month-end-summary-9月30','alternate-P5','dated-note-before-footer','footer-label-with-duty-cells','unrecognized-summary-note']) {
      const sheets=source();
      if(kind==='mid-month-footer') sheets.guanqi.rows.splice(8,0,['本月汇总'],['','','','赵媛支援']);
      if(kind==='month-end-footer-followed-by-support') sheets.guanqi.rows.push(['本月汇总'],['','','','赵媛支援']);
      if(kind==='ambiguous-monthly-summary') sheets.guanqi.rows.push(['本月汇总／赵媛支援']);
      if(kind.startsWith('month-end-summary-')) sheets.guanqi.rows.push([`本月汇总／${kind.slice('month-end-summary-'.length)}赵媛支援`]);
      if(kind==='alternate-P5'){sheets.guanqi.rows[4][15]='赵媛（支援）';sheets.guanqi.rows[4][16]='';}
      if(kind==='dated-note-before-footer') sheets.guanqi.rows[7][0]='赵媛支援';
      if(kind==='footer-label-with-duty-cells') {const row=['本月汇总'];row[15]='赵媛（支援）';sheets.guanqi.rows.push(row);}
      if(kind==='unrecognized-summary-note') sheets.guanqi.rows.push(['补充：本月汇总／赵媛支援']);
      sheets.guanqi.rows.push(['本月汇总']);
      const proof=buildPlanningRoleEvidence(draft,sheets);
      const plan=buildPlanningImportPlan(draft,rows,505,target,proof);
      assert.equal(plan.ranges.length,0,`an explicit later footer cannot hide ${kind}`);
      assert.match(plan.unresolved[0].reason,/整月.*跨房.*核验/u);
    }
  }
});

test('unexplained same-day person mentions block both rest and work even in the verified home room', () => {
  // Synthetic local rev505 candidate, not a production workbook snapshot.
  const rows=[[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛','']];
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  for(const rest of [false,true]) {
    const draft={roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'赵媛',shiftCode:rest?'休':'L',rest}]};
    const source=()=>{
      const sheets=liveRoleSheets({guanqi:{anchor:(day)=>rest&&day===1?'':'赵媛'}});
      if(rest){sheets.guanqi.rows[0][13]='赵媛';sheets.guanqi.rows[0][14]='休息';}
      return sheets;
    };
    const clean=buildPlanningRoleEvidence(draft,source());
    assert.equal(buildPlanningImportPlan(draft,rows,505,target,clean).ranges.length,1,'normal verified attendance and timeline names are explained');
    for(const note of [['赵媛支援'],['赵媛'],['','','','','','','','','','','','','','','赵媛（支援）']]) {
      const sheets=source();sheets.guanqi.rows.splice(4,0,note);
      const proof=buildPlanningRoleEvidence(draft,sheets);
      const plan=buildPlanningImportPlan(draft,rows,505,target,proof);
      assert.equal(plan.ranges.length,0,`same-day unresolved source must stop ${rest?'rest':'work'}: ${JSON.stringify(note)}`);
      assert.match(plan.unresolved[0].reason,/未核验|未解释/u);
      assert.notEqual(proof.signature,clean.signature,'unexplained same-day person evidence belongs to the source signature');
    }
    const later=source();later.guanqi.rows.splice(8,0,['赵媛支援']);
    assert.equal(buildPlanningImportPlan(draft,rows,505,target,buildPlanningRoleEvidence(draft,later)).ranges.length,1,'another day in the same room is not a same-day conflict');
  }
});

test('an explicitly dated person note before the first date block is negative evidence, never an undated header exemption', () => {
  // Synthetic local rev505 candidate, not a production workbook snapshot.
  const rows=[[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-品牌精选','FD-1','赵媛','']];
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  for(const rest of [false,true]) {
    const draft={roomCode:'brand_selection',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'赵媛',shiftCode:rest?'休':'L',rest}]};
    const source=()=>{
      const sheets=liveRoleSheets({brand_selection:{anchor:(day)=>rest&&day===1?'':'赵媛'}});
      if(rest){sheets.brand_selection.rows[0][1]='赵媛';sheets.brand_selection.rows[0][2]='休息';}
      return sheets;
    };
    const clean=buildPlanningRoleEvidence(draft,source());
    for(const header of ['9/2 赵媛支援','09-02 赵媛支援','9月2 赵媛支援','2026/9/2 赵媛支援']) {
      const sheets=source();sheets.guanqi.rows.unshift([header]);
      const proof=buildPlanningRoleEvidence(draft,sheets);
      const plan=buildPlanningImportPlan(draft,rows,505,target,proof);
      assert.equal(plan.ranges.length,0,`explicit month date must not be treated as an undated header: ${header}`);
      assert.match(plan.unresolved[0].reason,/跨房.*核验/u);
      assert.notEqual(proof.signature,clean.signature);
    }
    for(const header of ['赵媛支援','10/2 赵媛支援','2025/9/2 赵媛支援']) {
      const sheets=source();sheets.guanqi.rows.unshift([header]);
      assert.equal(buildPlanningImportPlan(draft,rows,505,target,buildPlanningRoleEvidence(draft,sheets)).ranges.length,1,'undated and explicitly other-period headers do not prove this month');
    }
  }
});

test('an explicitly dated unresolved note belongs to its own day, not its surrounding date block', () => {
  // Synthetic local rev505 candidate, not a production workbook snapshot.
  const rows=[[SHIFT_LEGEND],['UID','部门','工号','','2026/9/2'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛','']];
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  for(const rest of [false,true]) {
    const draft={roomCode:'guanqi',role:'anchor',startDate:'2026-09-02',endDate:'2026-09-02',dates:['2026-09-02'],assignments:[{date:'2026-09-02',name:'赵媛',shiftCode:rest?'休':'L',rest}]};
    const source=()=>{
      const sheets=liveRoleSheets({guanqi:{anchor:(day)=>rest&&day===2?'':'赵媛'}});
      if(rest){sheets.guanqi.rows[4][13]='赵媛';sheets.guanqi.rows[4][14]='休息';}
      return sheets;
    };
    assert.equal(buildPlanningImportPlan(draft,rows,505,target,buildPlanningRoleEvidence(draft,source())).ranges.length,1);
    for(const note of [['9/2赵媛支援'],['09-02赵媛支援'],['9月2赵媛支援'],['9/2','','','赵媛支援']]) {
      const sheets=source();sheets.guanqi.rows.splice(4,0,note);
      const proof=buildPlanningRoleEvidence(draft,sheets);
      const plan=buildPlanningImportPlan(draft,rows,505,target,proof);
      assert.equal(plan.ranges.length,0,`a 9/2 note inside 9/1 cannot allow ${rest?'rest':'work'} on 9/2`);
      assert.match(plan.unresolved[0].reason,/未解释.*来源/u);
      assert.ok(proof.unexplainedSourceMentions['2026-09-02|赵媛']?.length);
    }
  }
});

test('explicit dated notes are scanned across the full source even when their host block is outside the selected month', () => {
  // Synthetic local rev505 candidate, not a production workbook snapshot.
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  const total=(date)=>[[SHIFT_LEGEND],['UID','部门','工号','',date.replaceAll('-','/')],['u-1','凡岛-品牌营销部-直播中心-品牌精选','FD-1','赵媛','']];
  const draft=(date,rest=false)=>({roomCode:'brand_selection',role:'anchor',startDate:date,endDate:date,dates:[date],assignments:[{date,name:'赵媛',shiftCode:rest?'休':'L',rest}]});
  const source=(octoberRest=false)=>{
    const sheets=liveRoleSheets({brand_selection:{anchor:'赵媛'}});
    const october=liveRoleSheets({brand_selection:{anchor:(day)=>octoberRest&&day===1?'':'赵媛'}});
    if(octoberRest){october.brand_selection.rows[0][1]='赵媛';october.brand_selection.rows[0][2]='休息';}
    for(const roomCode of Object.keys(sheets)) {
      const nextRows=october[roomCode].rows.map((row)=>{const result=[...row];result[0]=String(result[0]||'').replace(/^9月/u,'10月');return result;});
      const day31=structuredClone(nextRows.slice(-4));day31[0][0]='10月31日';
      sheets[roomCode].rows.push(...nextRows,...day31);
    }
    return sheets;
  };
  for(const rest of [false,true]) for(const note of [['10/1赵媛支援'],['10-01赵媛支援'],['10月1赵媛支援'],['10/1','','','赵媛支援']]) {
    const sheets=source(rest);sheets.guanqi.rows.splice(120,0,note);
    const requested=draft('2026-10-01',rest);
    const proof=buildPlanningRoleEvidence(requested,sheets);
    assert.deepEqual(proof.completeMonths,['2026-10'],'the October source is complete but still has a negative support note in September');
    const plan=buildPlanningImportPlan(requested,total(requested.startDate),505,target,proof);
    assert.equal(plan.ranges.length,0,'a 10/1 note after 9/30 cannot be missed when only October is requested');
    assert.match(plan.unresolved[0].reason,/跨房.*核验/u);
    assert.ok(proof.unexplainedSourceMentions['2026-10-01|赵媛']?.length);
    if(note.length===1) {
      const september=draft('2026-09-01');
      assert.equal(buildPlanningImportPlan(september,total(september.startDate),505,target,buildPlanningRoleEvidence(september,sheets)).ranges.length,1,'the same explicitly October note must not conflict with September');
    }
  }
  const reverse=source();reverse.guanqi.rows.splice(124,0,['9/30赵媛支援']);
  const october=draft('2026-10-01');
  assert.equal(buildPlanningImportPlan(october,total(october.startDate),505,target,buildPlanningRoleEvidence(october,reverse)).ranges.length,1,'a September note physically inside October is not an October conflict');
  const september=draft('2026-09-30');
  assert.equal(buildPlanningImportPlan(september,total(september.startDate),505,target,buildPlanningRoleEvidence(september,reverse)).ranges.length,0,'the same September note is still found when only September is requested');
  const mixed=source();const attendanceNote=['10/1'];attendanceNote[13]='赵媛';attendanceNote[14]='L（05:30-14:30）';mixed.guanqi.rows.splice(120,0,attendanceNote);
  const both={...draft('2026-09-01'),endDate:'2026-10-01',dates:['2026-09-01','2026-10-01'],assignments:[...draft('2026-09-01').assignments,...draft('2026-10-01').assignments]};
  const combinedProof=buildPlanningRoleEvidence(both,mixed);
  assert.ok(combinedProof.unexplainedSourceMentions['2026-10-01|赵媛']?.length,'a cell explained as September attendance cannot exempt its explicit October date');
  for(const rest of [false,true]) for(const title of ['10/1','10-01','10月1']) {
    const sheets=source(rest);sheets.guanqi.rows.splice(120,0,[title],['赵媛支援']);
    const requested=draft('2026-10-01',rest);
    const proof=buildPlanningRoleEvidence(requested,sheets);
    assert.equal(buildPlanningImportPlan(requested,total(requested.startDate),505,target,proof).ranges.length,0,'a date heading must bind the person on its following row');
    assert.ok(proof.unexplainedSourceMentions['2026-10-01|赵媛']?.length);
    const september=draft('2026-09-01');
    assert.equal(buildPlanningImportPlan(september,total(september.startDate),505,target,buildPlanningRoleEvidence(september,sheets)).ranges.length,1,'an October date heading also ends the September negative-evidence context');
  }
  const reverseSplit=source();reverseSplit.guanqi.rows.splice(124,0,['9/30'],['赵媛支援']);
  assert.equal(buildPlanningImportPlan(october,total(october.startDate),505,target,buildPlanningRoleEvidence(october,reverseSplit)).ranges.length,1,'a September heading and following person note inside October must not conflict with October');
  assert.equal(buildPlanningImportPlan(september,total(september.startDate),505,target,buildPlanningRoleEvidence(september,reverseSplit)).ranges.length,0,'a September heading inside October must still bind its following person note back to September');
  const reset=source();reset.brand_selection.rows.splice(120,0,['10/1'],['10/2'],['赵媛支援']);
  const resetProof=buildPlanningRoleEvidence(october,reset);
  assert.equal(resetProof.unexplainedSourceMentions['2026-10-01|赵媛'],undefined,'a later explicit date replaces the prior date context');
  assert.ok(resetProof.unexplainedSourceMentions['2026-10-02|赵媛']?.length);
  assert.equal(buildPlanningImportPlan(october,total(october.startDate),505,target,resetProof).ranges.length,1,'a verified home-room work day is unaffected by another unambiguous day');
  const ambiguous=source();ambiguous.brand_selection.rows.splice(120,0,['10/2、10/3'],['赵媛支援']);
  const ambiguousProof=buildPlanningRoleEvidence(october,ambiguous);
  assert.equal(buildPlanningImportPlan(october,total(october.startDate),505,target,ambiguousProof).ranges.length,0,'multiple-date context does not invent a precise assignment; that month stays fail-closed');
});

test('writeback proof rejects malformed or status-qualified times and roster shifts without weakening valid overnight slots', () => {
  const rows=[[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-官旗','FD-1','赵媛','']];
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  const draft=(shiftCode='L')=>({roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'赵媛',shiftCode}]});
  const base=()=>liveRoleSheets({guanqi:{anchor:'赵媛'}});
  for (const malformed of ['05:90-08:00','次日06:00-08:00','05:30-08:00（待定）','05:30-08:00取消','24:01-02:00','25:30-08:00','05:30-24:30']) {
    const sheets=base();sheets.guanqi.rows[0][3]=malformed;
    const proof=buildPlanningRoleEvidence(draft(),sheets);
    assert.deepEqual(proof.completeMonths,[],`${malformed} cannot prove an entire month`);
    assert.equal(buildPlanningImportPlan(draft(),rows,504,target,proof).ranges.length,0);
  }
  for (const malformed of ['05:90-08:00','05:30-08:00（待定）','安排中']) {
    const sheets=base();sheets.guanqi.rows[2][3]=malformed;sheets.guanqi.rows[3][3]='尹珩瑞';
    assert.deepEqual(buildPlanningRoleEvidence(draft(),sheets).completeMonths,[],`ambiguous assistant time ${malformed} cannot prove the month`);
  }
  for (const malformed of ['L（05:30-14:30）待定','L（05:30-14:30）取消','L（05:30-14:30）未知','L（05:90-14:30）']) {
    const sheets=base();sheets.guanqi.rows[0][14]=malformed;
    const proof=buildPlanningRoleEvidence(draft(),sheets);
    const plan=buildPlanningImportPlan(draft(),rows,504,target,proof);
    assert.equal(plan.ranges.length,0,`${malformed} cannot attest a work shift`);
    assert.match(plan.unresolved[0].reason,/代码或时间/u);
  }
  const fullwidth=base();fullwidth.guanqi.rows[0][3]='5:30-10：10';
  assert.equal(buildPlanningImportPlan(draft(),rows,504,target,buildPlanningRoleEvidence(draft(),fullwidth)).ranges.length,1);
  for (const overnight of ['23:00-次日02:00','23:00-02:00','22:00-24:00','24:00-02:00']) {
    const sheets=base();sheets.guanqi.rows[0][3]=overnight;sheets.guanqi.rows[0][14]='ZBB(21:00-次日6:00)';
    const overnightRows=[[`${SHIFT_LEGEND}; ZBB(21:00-次日6:00): 21:00 ~ 次日 06:00`],...rows.slice(1)];
    const plan=buildPlanningImportPlan(draft('ZBB'),overnightRows,504,target,buildPlanningRoleEvidence(draft('ZBB'),sheets));
    assert.equal(plan.ranges.length,1,`${overnight} is a valid overnight subset of attendance: ${JSON.stringify(plan.unresolved)}`);
  }
});

test('expanded live-room timeline beyond inferred roster columns blocks entire month', () => {
  const draft={roomCode:'guanqi',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'赵媛',shiftCode:'L'}]};
  const sheets=liveRoleSheets({guanqi:{anchor:'赵媛'}});
  sheets.guanqi.rows[0][13]='23:00-24:00';
  sheets.guanqi.rows[1][13]='赵媛';
  sheets.guanqi.rows[0][14]='24:00-02:00';
  sheets.guanqi.rows[1][14]='赵媛';
  const proof=buildPlanningRoleEvidence(draft,sheets);
  assert.deepEqual(proof.completeMonths,[], 'a wide source timeline must not be treated as a short complete day');
  const assistantExpanded=liveRoleSheets({guanqi:{anchor:'赵媛',assistant:'尹珩瑞'}});
  assistantExpanded.guanqi.rows[2][13]='23:00-次日02:00';
  assistantExpanded.guanqi.rows[3][13]='尹珩瑞';
  assert.deepEqual(buildPlanningRoleEvidence(draft,assistantExpanded).completeMonths,[], 'a wide assistant timeline must not be ignored');
});

test('a compound attendance name is a mention, never an exact writeback identity', () => {
  const draft={roomCode:'wangou',role:'anchor',startDate:'2026-09-01',endDate:'2026-09-01',dates:['2026-09-01'],assignments:[{date:'2026-09-01',name:'李凯彤',shiftCode:'休',rest:true}]};
  const rows=[[SHIFT_LEGEND],['UID','部门','工号','','2026/9/1'],['u-1','凡岛-品牌营销部-直播中心-王鸥美肤','FD-1','李凯彤','']];
  const target={spreadsheetToken:'test-token',sheetId:'0jFdXf'};
  const sheets=liveRoleSheets({wangou:{anchor:(day)=>day===1?'':'李凯彤'}});
  sheets.wangou.rows[0][1]='李凯彤&郑总';
  sheets.wangou.rows[0][2]='休息';
  const proof=buildPlanningRoleEvidence(draft,sheets);
  assert.deepEqual(proof.roster['2026-09-01|李凯彤'],[{roomCode:'wangou',raw:'休息',unverifiedName:true}]);
  const plan=buildPlanningImportPlan(draft,rows,504,target,proof);
  assert.equal(plan.ranges.length,0);
  assert.match(plan.unresolved[0].reason,/姓名带未核验备注/u);
});

test('only four confirmed Wangou gold-guide annotations resolve to the named anchor', () => {
  const draft={assignments:[{date:'2026-09-01',name:'李凯彤'}]};
  for (const name of ['李凯彤','李彩红','谷子晴','邓淑环']) {
    const sheets=liveRoleSheets({wangou:{anchor:name}});
    sheets.wangou.rows[1][3]=`${name}（金牌导购）`;
    const proof=buildPlanningRoleEvidence(draft,sheets);
    assert.deepEqual(proof.completeMonths,['2026-09']);
    assert.deepEqual(proof.claims[`2026-09-01|${name}`],[{roomCode:'wangou',role:'anchor'}]);
  }
  for (const unapproved of ['王颖慧（金牌导购）','李凯彤（支援）','李凯彤&曹总（老板场）']) {
    const sheets=liveRoleSheets({wangou:{anchor:'李凯彤'}});
    sheets.wangou.rows[1][3]=unapproved;
    assert.deepEqual(buildPlanningRoleEvidence(draft,sheets).completeMonths,[],unapproved);
  }
});

test('makeup import appends a new month without overwriting historical rows', () => {
  const rows = [['化妆师','2026/6/1'],['星期','周一'],['刘玉婷','AC1（07:30-16:30）'],['肖慧萍','Q（09:30-18:30）']];
  const draft = generateMakeupDraft({month:'2026-09',roster:[{name:'刘玉婷',restDates:[]},{name:'肖慧萍',restDates:[]}]});
  const target = {spreadsheetToken:'makeup-token',sheetId:'33648c',label:'化妆师排班'}; const plan = buildMakeupImportPlan(draft, rows, 8, target);
  assert.equal(plan.mode, 'append'); assert.equal(plan.unresolved.length, 0); assert.equal(plan.overwrites.length, 0); assert.match(plan.ranges[0].range, /^33648c!A6:/u); assert.equal(plan.ranges[0].values[0][1], '2026/9/1');
});

test('makeup update omits unchanged dates and hashes the exact replacement values', () => {
  const rows = [['标题'],['化妆师','2026/9/1','2026/9/2'],['星期','周二','周三'],['刘玉婷','AC1（07:30-16:30）','F（08:00-17:00）']];
  const draft = {month:'2026-09',dates:['2026-09-01','2026-09-02'],roster:[{name:'刘玉婷'}],assignments:[{name:'刘玉婷',date:'2026-09-01',shiftCode:'AC1'},{name:'刘玉婷',date:'2026-09-02',shiftCode:'Q'}]};
  const target = {spreadsheetToken:'makeup-token',sheetId:'33648c'};
  const plan = buildMakeupImportPlan(draft,rows,8,target);
  assert.equal(plan.mode,'update');
  assert.deepEqual(plan.ranges.map(item=>item.range),['33648c!C4:C4']);
  assert.equal(plan.overwrites.length,1);
  assert.notEqual(buildMakeupImportPlan({...draft,assignments:[draft.assignments[0],{...draft.assignments[1],shiftCode:'F'}]},rows,8,target).expectedHash,plan.expectedHash);
});

test('makeup update refuses duplicate names in the formal month block', () => {
  const rows = [['化妆师','2026/9/1'],['星期','周二'],['刘玉婷',''],['刘玉婷','']];
  const draft = {month:'2026-09',dates:['2026-09-01'],roster:[{name:'刘玉婷'}],assignments:[{name:'刘玉婷',date:'2026-09-01',shiftCode:'AC1'}]};
  const plan = buildMakeupImportPlan(draft,rows,8,{spreadsheetToken:'makeup-token',sheetId:'33648c'});
  assert.equal(plan.ranges.length,0);
  assert.match(plan.unresolved[0].reason,/重名/u);
});

test('dispatch UI exposes four-room anchor and assistant planning, global rest entitlement and shared makeup duty', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'); const script = fs.readFileSync(path.join(__dirname, 'planning-workbench.js'), 'utf8'); const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'); const css = fs.readFileSync(path.join(__dirname, 'planning-workbench-20260829.css'), 'utf8');
  assert.match(html, /id="planningSourceLink"[^>]+href="https:\/\/jqx28l0j4lx\.feishu\.cn\/wiki\/UKVDwxpz7iKAv8k5KxTcxiDVnuf"/u);
  assert.doesNotMatch(html, /Eui1waw7FiNSGdkQU0jcov2HnPe/u);
  assert.match(script, /const sourceLink = \$\('#planningSourceLink'\)/u);
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
