'use strict';

// Isolated, read-only September statistics. This module does not participate
// in the r57 four-room planner, rest entitlement, import, or writeback paths.
const { SHIFT_TIMES, scheduleDateKey } = require('./planning-engine');

function cellText(value) {
  return Array.isArray(value) ? value.map(cellText).join(' ') :
    value && typeof value === 'object' ? cellText(value.text ?? value.name ?? value.value ?? '') :
      String(value ?? '').replace(/\s+/gu, ' ').trim();
}

// Spellings verified in the September total sheet legend; a bare shift code,
// unknown code, or mismatched time is not confirmed work.
const SHIFT_EXTRA = Object.freeze({
  G: ['15:00–00:00'], K: ['16:00–01:00'], P: ['16:30–01:00'],
  GJ5: ['17:30–01:00'], M: ['21:30–05:00'],
  ZBB: ['18:30–次日02:00'], WB: ['22:30–次日06:00'],
});

function normalizeTime(value) {
  const match = String(value || '').match(/^(次日)?(\d{1,2}):(\d{2})$/u);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) return '';
  return `${match[1] || ''}${match[2].padStart(2, '0')}:${match[3]}`;
}

function dayStatus(value) {
  const text = cellText(value).replace(/\s+/gu, '').replace(/：/gu, ':').replace(/[－—–~～]/gu, '-');
  if (!text) return 'blank';
  if (text === '休息') return 'rest';
  if (/请假|年假|病假|事假|调休|培训/u.test(text)) return 'leave';
  const match = text.match(/^([A-Za-z][A-Za-z0-9]*)[（(]((?:次日)?\d{1,2}:\d{2})-((?:次日)?\d{1,2}:\d{2})[）)]$/u);
  if (!match) return /^[A-Za-z][A-Za-z0-9]*[（(]/u.test(text) ? 'invalidShift' : 'unknown';
  if (!Object.hasOwn(SHIFT_TIMES, match[1])) return 'unknown';
  const actual = `${normalizeTime(match[2])}-${normalizeTime(match[3])}`;
  if (actual.includes('--') || actual.startsWith('-') || actual.endsWith('-')) return 'invalidShift';
  return [SHIFT_TIMES[match[1]], ...(SHIFT_EXTRA[match[1]] || [])].some((variant) => {
    const [start, end] = variant.replace(/[－—–~～]/gu, '-').split('-');
    return actual === `${normalizeTime(start)}-${normalizeTime(end)}`;
  }) ? 'work' : 'invalidShift';
}

function emptyPendingByReason() {
  return {gray:0,blank:0,leave:0,invalidShift:0,unknown:0};
}

function columnName(index) {
  let value = index + 1; let letters = '';
  while (value > 0) {
    value -= 1; letters = String.fromCharCode(65 + value % 26) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

function parseMonthlyRestStatistics(rows, month, expectedPeople = 52, options = {}) {
  const unavailable = (reason) => ({ available:false, month, personCount:null, dateCount:null,
    people:[], totals:null, reason, readOnly:true, writeBackAllowed:false });
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/u.test(String(month || '')) || !Array.isArray(rows) ||
      !Number.isInteger(expectedPeople) || expectedPeople < 1 || !(options.grayCells instanceof Set) ||
      [...options.grayCells].some((coordinate) => !/^[A-Z]+[1-9]\d*$/u.test(String(coordinate)))) {
    return unavailable('月总表参数、来源结构或灰格核验不可用。');
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const dates = Array.from({length:new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()},
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  const headers = rows.map((row, rowIndex) => ({row, rowIndex})).filter(({row}) =>
    Array.isArray(row) && ['UID', '部门', '工号'].every((label, index) => cellText(row[index]) === label));
  if (headers.length !== 1) return unavailable('月总表 UID、部门、工号表头缺失或重复。');
  const {row:header, rowIndex:headerIndex} = headers[0];
  const dateColumns = header.map((cell, index) => ({date:scheduleDateKey(cell, String(year)), index}))
    .filter((item) => item.date.startsWith(month));
  if (dateColumns.length !== dates.length || new Set(dateColumns.map((item) => item.date)).size !== dates.length ||
      dates.some((date) => !dateColumns.some((item) => item.date === date))) {
    return unavailable('月总表日期列缺失、重复或不是完整自然月。');
  }
  dateColumns.sort((a,b) => a.date.localeCompare(b.date));
  const prefix = '凡岛-品牌营销部-直播中心';
  const members = rows.slice(headerIndex + 1).map((row, offset) => ({row, sourceRow:headerIndex + offset + 2}))
    .filter(({row}) => Array.isArray(row) && cellText(row[1]).replace(/\s+/gu, '').startsWith(prefix));
  if (members.length !== expectedPeople) return unavailable(`月总表直播中心身份行不是已核验的 ${expectedPeople} 行。`);
  const auditedDayCells = new Set(members.flatMap(({sourceRow}) =>
    dateColumns.map(({index}) => `${columnName(index)}${sourceRow}`)));
  if ([...options.grayCells].some((cell) => !auditedDayCells.has(cell))) {
    return unavailable('灰格样式坐标不在已核验的人员日期区域。');
  }
  const uids = new Set(); const employeeNumbers = new Set(); const people = [];
  for (const {row, sourceRow} of members) {
    const uid = cellText(row[0]); const employeeNo = cellText(row[2]); const name = cellText(row[3]);
    const department = cellText(row[1]).replace(/\s+/gu, '');
    if (!uid || !employeeNo || !name || !/^[\p{Script=Han}·]{2,12}$/u.test(name) ||
        uids.has(uid) || employeeNumbers.has(employeeNo) ||
        (department !== prefix && !department.startsWith(`${prefix}-`))) {
      return unavailable('月总表人员 UID、工号、姓名或部门缺失、重复、异常。');
    }
    uids.add(uid); employeeNumbers.add(employeeNo);
    let explicitRestDays = 0; let explicitWorkDays = 0;
    const pendingByReason = emptyPendingByReason(); const pendingCells = [];
    for (const {date,index} of dateColumns) {
      const cell = `${columnName(index)}${sourceRow}`;
      const status = options.grayCells.has(cell) ? 'gray' : dayStatus(row[index]);
      if (status === 'rest') explicitRestDays += 1;
      else if (status === 'work') explicitWorkDays += 1;
      else { pendingByReason[status] += 1; pendingCells.push({date,cell,reason:status}); }
    }
    people.push({name, department, sourceRow, explicitRestDays, explicitWorkDays,
      pendingDays:pendingCells.length, pendingByReason, pendingCells});
  }
  const totals = people.reduce((sum, person) => {
    sum.explicitRestDays += person.explicitRestDays;
    sum.explicitWorkDays += person.explicitWorkDays;
    sum.pendingDays += person.pendingDays;
    for (const reason of Object.keys(sum.pendingByReason)) sum.pendingByReason[reason] += person.pendingByReason[reason];
    return sum;
  }, {explicitRestDays:0, explicitWorkDays:0, pendingDays:0, pendingByReason:emptyPendingByReason()});
  return {available:true, month, personCount:people.length, dateCount:dateColumns.length,
    people, totals, readOnly:true, writeBackAllowed:false,
    scopeNote:'仅统计总表中明确的休息和合法班次；灰格、空白、请假、班次时间异常及未知标记一律待核验，不计算剩余月休。'};
}

module.exports = {parseMonthlyRestStatistics};
