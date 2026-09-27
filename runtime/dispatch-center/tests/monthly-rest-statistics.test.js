'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {parseMonthlyRestStatistics} = require('../monthly-rest-statistics');

function fixture() {
  const rows = Array.from({length:56}, () => Array(34).fill(''));
  rows[3].splice(0, 4, 'UID', '部门', '工号', '姓名');
  for (let day = 1; day <= 30; day += 1) rows[3][day + 3] = `2026/9/${day}`;
  const first = '甲乙丙丁戊己庚辛'; const second = '子丑寅卯辰巳午未申酉';
  for (let index = 0; index < 52; index += 1) {
    const row = rows[index + 4];
    row[0] = `uid-${index + 1}`;
    row[1] = `凡岛-品牌营销部-直播中心-${index % 2 ? '官旗' : '优选'}`;
    row[2] = `employee-${index + 1}`;
    row[3] = `测${first[Math.floor(index / 10)]}${second[index % 10]}`;
  }
  return rows;
}

const auditedGrayCells = new Set([
  'E47','F47','E48','F48','E49','F49','G49','H49','I49','J49',
  'E54','F54','E55','F55','G55','H55','I55','J55','K55','L55','M55','N55','O55','P55','Q55','R55','S55','T55',
  'E56','F56','G56','H56','I56','J56','K56','L56','M56','N56','O56','P56','Q56','R56','S56','T56','U56','V56','W56','X56',
]);

function columnName(index) {
  let value = index + 1; let name = '';
  while (value > 0) { value -= 1; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26); }
  return name;
}

test('counts explicit rest/work only and keeps blank, leave, unknown and gray cells pending', () => {
  const rows = fixture();
  rows[4][4] = '休息'; rows[4][5] = 'L(05:30-14:30)';
  rows[4][6] = '请假'; rows[4][7] = 'L'; rows[4][8] = 'L(08:00-17:00)';
  rows[46][4] = '休息'; // E47 was gray in the revision-bound audit.
  const data = parseMonthlyRestStatistics(rows, '2026-09', 52, {grayCells:new Set(['E47'])});
  assert.equal(data.available, true);
  assert.equal(data.personCount, 52);
  assert.equal(data.dateCount, 30);
  assert.deepEqual([data.people[0].explicitRestDays,data.people[0].explicitWorkDays,data.people[0].pendingDays], [1,1,28]);
  assert.deepEqual([data.people[42].explicitRestDays,data.people[42].pendingDays], [0,30]);
  assert.deepEqual(data.totals, {explicitRestDays:1,explicitWorkDays:1,pendingDays:1558,
    pendingByReason:{gray:1,blank:1554,leave:1,invalidShift:1,unknown:1}});
  assert.deepEqual(data.people[0].pendingCells.slice(0, 3), [
    {date:'2026-09-03',cell:'G5',reason:'leave'},
    {date:'2026-09-04',cell:'H5',reason:'unknown'},
    {date:'2026-09-05',cell:'I5',reason:'invalidShift'},
  ]);
  assert.deepEqual(data.people[42].pendingCells[0],{date:'2026-09-01',cell:'E47',reason:'gray'});
  assert.equal(data.readOnly,true);
  assert.equal(data.writeBackAllowed,false);
  assert.ok(!Object.hasOwn(data.people[0], 'remainingRest'));
});

test('fails closed for duplicate or missing date columns and unknown identity', () => {
  const duplicate = fixture(); duplicate[3][5] = duplicate[3][4];
  assert.equal(parseMonthlyRestStatistics(duplicate,'2026-09',52,{grayCells:new Set()}).available,false);
  const wrongUid = fixture(); wrongUid[5][0] = wrongUid[4][0];
  assert.equal(parseMonthlyRestStatistics(wrongUid,'2026-09',52,{grayCells:new Set()}).available,false);
  const missing = fixture(); missing[55][1] = '其它部门';
  assert.equal(parseMonthlyRestStatistics(missing,'2026-09',52,{grayCells:new Set()}).available,false);
  assert.equal(parseMonthlyRestStatistics(fixture(),'2026-09',52,{grayCells:new Set(['E99'])}).available,false);
});

test('known overnight spellings count as work, unknown time remains pending', () => {
  const rows = fixture();
  rows[4][4] = 'ZBB(18:30-次日02:00)';
  rows[4][5] = 'WB(22:30-次日06:00)';
  rows[4][6] = 'M(21:30-05:00)';
  rows[4][7] = 'ZBB(07:00-12:00)';
  const data = parseMonthlyRestStatistics(rows,'2026-09',52,{grayCells:new Set()});
  assert.equal(data.available,true);
  assert.deepEqual([data.people[0].explicitWorkDays,data.people[0].pendingDays],[3,27]);
  assert.deepEqual(data.people[0].pendingCells.find((item) => item.cell === 'H5'),
    {date:'2026-09-04',cell:'H5',reason:'invalidShift'});
});

test('synthetic full-month aggregate locates all 119 pending cells without a personal rest balance', () => {
  const rows = fixture();
  const invalid = new Set(['AG40','AH40','AD48']);
  const available = [];
  for (let row = 4; row < 56; row += 1) {
    for (let column = 4; column < 34; column += 1) {
      const cell = `${columnName(column)}${row + 1}`;
      if (auditedGrayCells.has(cell)) continue;
      rows[row][column] = 'L(05:30-14:30)';
      if (invalid.has(cell)) rows[row][column] = 'R（06:30-15:31）';
      else available.push([row,column]);
    }
  }
  available.slice(0, 68).forEach(([row,column]) => { rows[row][column] = ''; });
  available.slice(68, 402).forEach(([row,column]) => { rows[row][column] = '休息'; });
  const data = parseMonthlyRestStatistics(rows,'2026-09',52,{grayCells:auditedGrayCells});
  assert.equal(data.available,true);
  assert.deepEqual(data.totals,{explicitRestDays:334,explicitWorkDays:1107,pendingDays:119,
    pendingByReason:{gray:48,blank:68,leave:0,invalidShift:3,unknown:0}});
  const pending = data.people.flatMap((person) => person.pendingCells);
  assert.equal(pending.length,119);
  assert.equal(new Set(pending.map((item) => item.cell)).size,119);
  assert.deepEqual(pending.filter((item) => item.reason === 'invalidShift').map((item) => item.cell).sort(),
    ['AD48','AG40','AH40']);
  assert.ok(data.people.every((person) => person.explicitRestDays + person.explicitWorkDays + person.pendingDays === 30 &&
    Object.values(person.pendingByReason).reduce((sum, count) => sum + count, 0) === person.pendingDays &&
    person.pendingCells.length === person.pendingDays && !Object.hasOwn(person,'remainingRest')));
  assert.ok(pending.every((item) => !Object.hasOwn(item,'value') && !Object.hasOwn(item,'uid')));
});
