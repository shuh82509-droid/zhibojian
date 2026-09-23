'use strict';

const ROOM_PLANNING = Object.freeze({
  guanqi: {
    name: '官旗',
    anchorShifts: ['L', 'F', 'J2', 'P', 'M'],
    assistantShifts: ['L', 'A', 'X', 'Z', 'I', 'J', 'P', 'WB', 'M', 'ZBB'],
    assistants: ['尹珩瑞', '杨冰', '陈嘉欣', '蒙万叶', '韦彩云', '林梓烁', '雷惠朝'],
  },
  brand_selection: { name: '品牌精选', anchorShifts: ['AC1', 'L', 'J2', 'WB'], assistantShifts: ['L', 'A', 'X', 'Z', 'I', 'J', 'P', 'WB', 'M', 'ZBB'], assistants: [] },
  youxuan: { name: '优选', anchorShifts: ['R', 'X', 'B3', 'M'], assistantShifts: ['L', 'A', 'X', 'Z', 'I', 'J', 'P', 'WB', 'M', 'ZBB'], assistants: [] },
  wangou: { name: '王鸥美肤', anchorShifts: ['R', 'X', 'B3', 'M'], assistantShifts: ['L', 'A', 'X', 'Z', 'I', 'J', 'P', 'WB', 'M', 'ZBB'], assistants: [] },
});

const VERIFIED_ANCHOR_ROOMS = Object.freeze({
  潘小慧: '官旗', 赵媛: '官旗', 林惠敏: '官旗', 何嘉慧: '官旗', 刘晶晶: '官旗',
  杨晓彤: '品牌精选', 丁阳虹: '品牌精选', 李晓茏: '品牌精选', 陈璐: '品牌精选', 罗梓欣: '品牌精选', 胡琳琳: '品牌精选',
  王思佳: '王鸥美肤', 刁心然: '王鸥美肤', 林羽浠: '王鸥美肤', 刘睿: '王鸥美肤', 朱海鹏: '王鸥美肤', 宋怡琳: '王鸥美肤',
  李安妮: '优选', 黄芷曈: '优选', 陈荟聿: '优选', 王明玥: '优选', 蒋珂: '优选',
});

const SHIFT_TIMES = Object.freeze({
  GJ3: '05:30–13:00', L: '05:30–14:30', R: '06:30–15:30', GJ2: '07:30–15:00', AC1: '07:30–16:30',
  F: '08:00–17:00', A: '08:30–17:30', TXQJ: '08:30–17:30', W: '09:00–18:00', D2: '09:30–18:30', Q: '09:30–18:30',
  X: '10:00–19:00', H: '10:00–20:30', Z: '11:30–20:00', B2: '12:00–21:00', S: '12:30–21:00', I: '13:00–22:00',
  GJ4: '13:30–21:00', B3: '13:30–22:00', J: '14:00–23:00', GJ6: '14:30–22:00', J2: '14:30–23:00',
  G: '15:00–次日00:00', GJ: '15:30–23:00', G2: '15:30–23:59', K: '16:00–次日01:00', P: '16:30–次日01:00',
  GJ5: '17:30–次日01:00', WB: '17:30–次日02:00', ZBB: '21:00–次日06:00', N2: '20:00–次日04:30', M: '21:30–次日05:00', ZB1: '05:00–14:00',
});

// 8.31 定稿口径：只按明确指定的班次统计，不将相邻时段推断进来。
const OPENING_SHIFTS = new Set(['L']);
const CLOSING_SHIFTS = new Set(['P', 'WB']);
const OVERNIGHT_SHIFTS = new Set(['M', 'ZBB']);

function safeDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw Object.assign(new Error('日期格式应为 YYYY-MM-DD。'), { status: 422 });
  const date = new Date(`${text}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error('日期无效。'), { status: 422 });
  return text;
}

function dateKeys(startDate, endDate) {
  const start = new Date(`${safeDate(startDate)}T00:00:00+08:00`);
  const end = new Date(`${safeDate(endDate)}T00:00:00+08:00`);
  if (end < start) throw Object.assign(new Error('结束日期不能早于开始日期。'), { status: 422 });
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days > 62) throw Object.assign(new Error('单次排班最多支持 62 天。'), { status: 422 });
  return Array.from({ length: days }, (_, index) => {
    const value = new Date(start.getTime() + index * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  });
}

function normalizeRoster(value, fallback = []) {
  const input = Array.isArray(value) && value.length ? value : fallback.map((name, index) => ({ name, rank: index + 1 }));
  const seen = new Set();
  return input.map((item, index) => {
    const name = String(typeof item === 'string' ? item : item?.name || '').replace(/\s+/gu, ' ').trim().slice(0, 40);
    if (!name || seen.has(name)) return null;
    seen.add(name);
    const restDates = [...new Set((Array.isArray(item?.restDates) ? item.restDates : []).map(safeDate))];
    return {
      name,
      rank: Math.max(1, Math.min(7, Number(item?.rank) || index + 1)),
      restDates,
      entitlement: Math.max(0, Math.min(31, Number(item?.entitlement) || 0)),
      poolSelected: item?.poolSelected !== false,
    };
  }).filter(Boolean).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'zh-CN'));
}

function transitionAllowed(previous, next, roomCode) {
  if (!previous) return true;
  if (roomCode === 'guanqi' && next === 'L' && ['J2', 'P', 'M'].includes(previous)) return false;
  if (roomCode === 'guanqi' && next === 'F' && ['P', 'M'].includes(previous)) return false;
  if (roomCode === 'youxuan' && next === 'R' && ['B3', 'M'].includes(previous)) return false;
  return true;
}

function scoreForShift(shift, orderedShifts, resourceScores) {
  const explicit = Number(resourceScores?.[shift]);
  if (Number.isFinite(explicit)) return explicit;
  const index = orderedShifts.indexOf(shift);
  return index < 0 ? 0 : Math.max(1, orderedShifts.length - index);
}

function anchorAssignments(roomCode, roster, dates, shifts, resourceScores) {
  const assignments = []; const warnings = []; const previous = new Map(); const activeRoster = roster.filter((person) => person.poolSelected !== false); const usage = new Map(activeRoster.map((person) => [person.name, 0]));
  dates.forEach((date, dayIndex) => {
    let available = activeRoster.filter((person) => !person.restDates.includes(date));
    activeRoster.filter((person) => person.restDates.includes(date)).forEach((person) => assignments.push({ date, name: person.name, shiftCode: '休', score: 0, rest: true, restReason: '手工休息日' }));
    let dailyShifts = [...shifts];
    if (roomCode === 'guanqi' && available.length < 5) dailyShifts = dailyShifts.filter((shift) => shift !== 'P');
    if (roomCode === 'wangou' && available.length > dailyShifts.length) {
      const restCount = available.length - dailyShifts.length;
      const overnightPerson=available.find(person=>person.rank===3)||available.find(person=>person.rank===4);
      const automaticRest = available.filter(person=>person!==overnightPerson).sort((a, b) => (usage.get(b.name) || 0) - (usage.get(a.name) || 0) || b.rank - a.rank).slice(0, restCount);
      const restNames = new Set(automaticRest.map((person) => person.name));
      automaticRest.forEach((person) => assignments.push({ date, name: person.name, shiftCode: '休', score: 0, rest: true, restReason: '人数超过 4 人自动轮休' }));
      available = available.filter((person) => !restNames.has(person.name));
    }
    const chosen = new Set();
    if (['youxuan','wangou'].includes(roomCode) && dailyShifts.includes('M')) {
      const preferred = available.find((person) => person.rank === 3) || available.find((person) => person.rank === 4);
      if (preferred) {
        assignments.push({ date, name: preferred.name, shiftCode: 'M', score: scoreForShift('M', dailyShifts, resourceScores), rest: false, shiftTime: SHIFT_TIMES.M, targetRoomCode:roomCode==='youxuan'?'guanqi':'brand_selection', linkedOvernight:true });
        chosen.add(preferred.name); usage.set(preferred.name, (usage.get(preferred.name) || 0) + 1); previous.set(preferred.name, 'M');
      } else warnings.push(date+'：第 3、4 名均不可排，配对通宵 M 留空待人工调整。');
      dailyShifts = dailyShifts.filter(shift=>shift!=='M');
    }
    for (const shift of dailyShifts) {
      const protectsTopTwo = ['guanqi', 'brand_selection'].includes(roomCode) && shift === dailyShifts.at(-1);
      const candidates = available.filter((person) => !chosen.has(person.name) && transitionAllowed(previous.get(person.name), shift, roomCode) && !(protectsTopTwo && person.rank <= 2)).sort((a, b) => roomCode === 'wangou' ? ((usage.get(a.name)||0) - (usage.get(b.name)||0)) || ((a.rank-1-dayIndex%2+7)%7)-((b.rank-1-dayIndex%2+7)%7) : (usage.get(a.name) || 0) - (usage.get(b.name) || 0) || a.rank - b.rank);
      const person = candidates[0];
      if (!person) { warnings.push(`${date} ${shift}：没有满足倒班规则${protectsTopTwo ? '及前两名不排最低资源位' : ''}的可排主播，已留空待人工调整。`); continue; }
      assignments.push({ date, name: person.name, shiftCode: shift, score: scoreForShift(shift, shifts, resourceScores), rest: false, shiftTime: SHIFT_TIMES[shift] || '时间待配置' });
      chosen.add(person.name); usage.set(person.name, (usage.get(person.name) || 0) + 1); previous.set(person.name, shift);
    }
  });
  return { assignments, warnings };
}

function assistantAssignments(roster, dates, shifts, customShiftTimes) {
  const assignments = []; const warnings = [];
  dates.forEach((date, dayIndex) => {
    const available = roster.filter((person) => !person.restDates.includes(date));
    roster.filter((person) => person.restDates.includes(date)).forEach((person) => assignments.push({ date, name: person.name, shiftCode: '休', score: 0, rest: true, shiftTime: '休息' }));
    available.forEach((person, index) => {
      const shiftCode = shifts[(dayIndex * Math.max(1, available.length) + index) % Math.max(1, shifts.length)];
      if (shiftCode) assignments.push({ date, name: person.name, shiftCode, score: 0, rest: false, shiftTime: customShiftTimes[shiftCode] || SHIFT_TIMES[shiftCode] || '时间待配置' });
    });
    if (available.length < shifts.length) warnings.push(`${date}：可排助理 ${available.length} 人，班次按跨日轮转覆盖全部 ${shifts.length} 个类型；同一人当天只排一个班次。`);
  });
  return { assignments, warnings };
}

function summarizeAttendance(roster, assignments) {
  return roster.map((person) => {
    const rows = assignments.filter((item) => item.name === person.name); const shifts = rows.filter((item) => !item.rest).map((item) => item.shiftCode); const usedRest = rows.filter((item) => item.rest).length;
    return { name: person.name, entitlement: person.entitlement, usedRest, remainingRest: Math.max(0, person.entitlement - usedRest), opening: shifts.filter((shift) => OPENING_SHIFTS.has(shift)).length, closing: shifts.filter((shift) => CLOSING_SHIFTS.has(shift)).length, overnight: shifts.filter((shift) => OVERNIGHT_SHIFTS.has(shift)).length };
  });
}

function summarizeResourceAverages(dates, assignments) {
  return dates.map((date) => {
    const rows = assignments.filter((item) => item.date === date && !item.rest && Number.isFinite(Number(item.score)));
    return { date, average: rows.length ? Number((rows.reduce((sum, item) => sum + Number(item.score), 0) / rows.length).toFixed(2)) : null, positions: rows.length };
  });
}

function summarizeAnchorResources(roster, assignments) {
  return roster.filter((person) => person.poolSelected !== false).map((person) => {
    const rows = assignments.filter((item) => item.name === person.name && !item.rest);
    const totalResourceScore = Number(rows.reduce((sum, item) => sum + (Number(item.score) || 0), 0).toFixed(2));
    const actualWorkDays = new Set(rows.map((item) => item.date)).size;
    return {
      name: person.name,
      rank: person.rank,
      totalResourceScore,
      actualWorkDays,
      averageResourceScore: actualWorkDays ? Number((totalResourceScore / actualWorkDays).toFixed(2)) : null,
    };
  }).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'zh-CN'));
}

function normalizeCustomShiftTimes(input) {
  const result = {};
  Object.entries(input && typeof input === 'object' ? input : {}).forEach(([code, time]) => {
    const safeCode = String(code || '').replace(/\s+/gu, '').trim(); const safeTime = String(time || '').replace(/\s+/gu, '').trim().replace('-', '–');
    if (/^[A-Za-z0-9\u4e00-\u9fff]{1,12}$/u.test(safeCode) && /^\d{2}:\d{2}–(?:次日)?\d{2}:\d{2}$/u.test(safeTime)) result[safeCode] = safeTime;
  });
  return result;
}

function generateDraft(input) {
  const room = ROOM_PLANNING[input?.roomCode]; if (!room) throw Object.assign(new Error('未找到对应直播间。'), { status: 404 });
  const role = input?.role === 'assistant' ? 'assistant' : input?.role === 'anchor' ? 'anchor' : null; if (!role) throw Object.assign(new Error('排班岗位仅支持主播或助理。'), { status: 422 });
  const dates = dateKeys(input.startDate, input.endDate); const roster = normalizeRoster(input.roster, role === 'assistant' ? room.assistants : []); if (!roster.length) throw Object.assign(new Error('请至少填写一名排班人员。'), { status: 422 });
  const allowed = role === 'assistant' ? room.assistantShifts : room.anchorShifts; const customShiftTimes = normalizeCustomShiftTimes(input.customShiftTimes); const customShifts = Object.keys(customShiftTimes);
  const accepted = new Set([...allowed, ...customShifts]); const requested = (Array.isArray(input.shifts) ? input.shifts : allowed).map((value) => String(value || '').trim()).filter((value) => accepted.has(value)); const shifts = [...new Set(requested.length ? requested : allowed)];
  if(role==='anchor' && input.roomCode==='wangou') shifts.sort((a,b)=>scoreForShift(b,allowed,input.resourceScores||{})-scoreForShift(a,allowed,input.resourceScores||{}));
  const generated = role === 'assistant' ? assistantAssignments(roster, dates, shifts, customShiftTimes) : anchorAssignments(input.roomCode, roster, dates, shifts, input.resourceScores || {});
  for(const assignment of generated.assignments)if(!assignment.rest && customShiftTimes[assignment.shiftCode])assignment.shiftTime=customShiftTimes[assignment.shiftCode];
  const actualScores = generated.assignments.filter((item) => !item.rest && Number.isFinite(Number(item.score)));
  const eventDates = [...new Set((Array.isArray(input?.eventDates) ? input.eventDates : []).map(safeDate))].filter((date) => dates.includes(date));
  const anchorResourceSummary = summarizeAnchorResources(roster, generated.assignments);
  if (role === 'anchor' && input.roomCode === 'wangou') {
    const totals = anchorResourceSummary.map((item) => item.totalResourceScore);
    if (totals.some((value, index) => index > 0 && value >= totals[index - 1])) generated.warnings.push('王鸥美肤周期资源总分尚未严格递减，请结合活动日和休息日手工调整后再导入。');
  }
  return { schemaVersion: 3, roomCode: input.roomCode, roomName: room.name, role, startDate: dates[0], endDate: dates.at(-1), dates, roster, shifts, customShifts, customShiftTimes, resourceScores: input.resourceScores || {}, eventDates, assignments: generated.assignments, warnings: generated.warnings, averageScore: actualScores.length ? Number((actualScores.reduce((sum, item) => sum + Number(item.score), 0) / actualScores.length).toFixed(2)) : null, resourceAverages: summarizeResourceAverages(dates, generated.assignments), anchorResourceSummary, attendance: summarizeAttendance(roster, generated.assignments), updatedAt: new Date().toISOString() };
}

function formatShiftCell(item) {
  const code = String(item?.shiftCode || '').trim();
  if (!code) return '';
  if (item?.rest || code === '休' || code === '休息') return '休息';
  const time = String(item?.shiftTime || SHIFT_TIMES[code] || '').replace(/–/gu, '-').trim();
  return time && time !== '时间待配置' ? `${code}（${time}）` : code;
}

function generateMakeupDraft(input = {}) {
  const month = /^20\d{2}-\d{2}$/u.test(String(input.month || '')) ? String(input.month) : '';
  if (!month) throw Object.assign(new Error('化妆师排班月份格式应为 YYYY-MM。'), { status: 422 });
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const dates = dateKeys(`${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`);
  const roster = normalizeRoster(input.roster, []).map((person) => ({ ...person, entitlement: person.entitlement || person.restDates.length }));
  if (roster.length < 2 || roster.length > 6) throw Object.assign(new Error('化妆师排班需填写 2—6 名在职化妆师。'), { status: 422 });
  const assignments = []; const warnings = []; const totals = new Map(roster.map((person) => [person.name, 0])); const shiftTotals = new Map(roster.map((person) => [person.name, { AC1: 0, F: 0, Q: 0 }]));
  dates.forEach((date) => {
    const available = roster.filter((person) => !person.restDates.includes(date));
    roster.filter((person) => person.restDates.includes(date)).forEach((person) => assignments.push({ date, name: person.name, shiftCode: '休', shiftTime: '休息', rest: true, score: 0 }));
    const shifts = available.length >= 3 ? ['AC1', 'F', 'Q'] : available.length === 2 ? ['AC1', 'Q'] : available.length === 1 ? ['Q'] : [];
    const chosen = new Set();
    shifts.forEach((shiftCode) => {
      const person = available.filter((item) => !chosen.has(item.name)).sort((left, right) => (shiftTotals.get(left.name)?.[shiftCode] || 0) - (shiftTotals.get(right.name)?.[shiftCode] || 0) || (totals.get(left.name) || 0) - (totals.get(right.name) || 0) || left.rank - right.rank)[0];
      if (!person) return;
      assignments.push({ date, name: person.name, shiftCode, shiftTime: SHIFT_TIMES[shiftCode], rest: false, score: 0 });
      chosen.add(person.name); totals.set(person.name, (totals.get(person.name) || 0) + 1); shiftTotals.get(person.name)[shiftCode] += 1;
    });
    if (available.length < 2) warnings.push(`${date}：仅 ${available.length} 名化妆师可排，需人工确认现场覆盖。`);
  });
  const attendance = roster.map((person) => ({ name: person.name, workDays: totals.get(person.name) || 0, usedRest: person.restDates.length, remainingRest: Math.max(0, (person.entitlement || 0) - person.restDates.length), shifts: shiftTotals.get(person.name) }));
  return { schemaVersion: 1, module: 'makeup', month, startDate: dates[0], endDate: dates.at(-1), dates, roster, shifts: ['AC1', 'F', 'Q'], assignments, attendance, warnings, updatedAt: new Date().toISOString() };
}

function cellText(value) { return Array.isArray(value) ? value.map(cellText).join(' ') : value && typeof value === 'object' ? cellText(value.text ?? value.name ?? value.value ?? '') : String(value ?? '').replace(/\s+/gu, ' ').trim(); }
function scheduleDateKey(value, yearHint) {
  const text = cellText(value); if (!text) return '';
  let match = text.match(/(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/u); if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
  match = text.match(/(\d{1,2})月(\d{1,2})日/u); if (match) return `${yearHint}-${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
  return '';
}

function longestWorkStreak(calendar) {
  let streak = 0; let maximum = 0;
  calendar.forEach((day) => { streak = day.status === 'work' ? streak + 1 : 0; maximum = Math.max(maximum, streak); });
  return maximum;
}

function restAdjustmentFromNote(value) {
  const text = String(value || '').replace(/\s+/gu, '');
  const chinese = {'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
  const match = text.match(/(\d+|[零一二两三四五六七八九十])(?:天|个班|次)/u);
  const amount = match ? Number.isFinite(Number(match[1])) ? Number(match[1]) : chinese[match[1]] : 1;
  if (!amount) return 0;
  if (/上月多休|本月补班|欠班/u.test(text)) return -amount;
  if (/上月少休|上月多上|上月加班|本月补休/u.test(text)) return amount;
  return 0;
}

function parseRestSource(rows, month, profiles = {}) {
  const safeMonth = /^20\d{2}-\d{2}$/u.test(String(month || '')) ? String(month) : ''; if (!safeMonth || !Array.isArray(rows)) return [];
  const yearHint = safeMonth.slice(0, 4); let headerIndex = -1; let dateColumns = [];
  rows.forEach((row, rowIndex) => { const matches = (Array.isArray(row) ? row : []).map((cell, columnIndex) => ({ date: scheduleDateKey(cell, yearHint), columnIndex })).filter((item) => item.date.startsWith(safeMonth)); if (matches.length > dateColumns.length) { headerIndex = rowIndex; dateColumns = matches; } });
  if (headerIndex < 0 || !dateColumns.length) return [];
  const header = rows[headerIndex] || []; const foundNameColumn = header.findIndex((cell) => /姓名|主播/u.test(cellText(cell))); const employeeNumberColumn = header.findIndex((cell) => /工号/u.test(cellText(cell))); const nameColumn = foundNameColumn >= 0 ? foundNameColumn : employeeNumberColumn >= 0 ? employeeNumberColumn + 1 : 0;
  const eligible = new Set([...Object.keys(VERIFIED_ANCHOR_ROOMS), ...Object.keys(profiles || {})]); const people = [];
  rows.slice(headerIndex + 1).forEach((row) => {
    const name = cellText((row || [])[nameColumn]); if (!name || !eligible.has(name)) return;
    const profile = profiles[name] || {}; const roomName = ['官旗', '品牌精选', '优选', '王鸥美肤'].includes(profile.roomName) ? profile.roomName : VERIFIED_ANCHOR_ROOMS[name] || '直播间待核验';
    const calendar = dateColumns.map(({ date, columnIndex }) => { const shiftCode = cellText((row || [])[columnIndex]); const status = !shiftCode ? 'unassigned' : /休|假/u.test(shiftCode) ? 'rest' : 'work'; return { date, shiftCode, status }; });
    const usedRest = calendar.filter((day) => day.status === 'rest').length; const baseEntitlement = Number.isInteger(profile.entitlement) ? profile.entitlement : null; const compNote = String(profile.compNote || ''); const restAdjustment = restAdjustmentFromNote(compNote); const entitlement = baseEntitlement == null ? null : Math.max(0, baseEntitlement + restAdjustment); const maximumConsecutiveWorkDays = longestWorkStreak(calendar); const suggestedRestDate = calendar.find((day, index) => day.status === 'unassigned' && calendar.slice(Math.max(0, index - 6), index).filter((item) => item.status === 'work').length >= 6)?.date || null;
    people.push({ name, roomName, baseEntitlement, restAdjustment, entitlement, usedRest, remainingRest: entitlement == null ? null : Math.max(0, entitlement - usedRest), compNote, maximumConsecutiveWorkDays, suggestedRestDate, calendar, alert: maximumConsecutiveWorkDays >= 6 ? `最长连续排播 ${maximumConsecutiveWorkDays} 天，建议优先确认休息日。` : '' });
  });
  return people.sort((a, b) => Number(Boolean(b.alert)) - Number(Boolean(a.alert)) || a.roomName.localeCompare(b.roomName, 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'));
}

function parseRestSources(sources, month, profiles = {}) {
  const safeSources = Array.isArray(sources) ? sources : [];
  const current = safeSources.find((source) => source?.month === month);
  if (!current) return [];
  const currentPeople = parseRestSource(current.rows, month, profiles);
  const historyByName = new Map();
  safeSources.forEach((source) => {
    if (!source?.month || source.month === month || !Array.isArray(source.rows)) return;
    if (source.month >= month) return;
    parseRestSource(source.rows, source.month, profiles).forEach((person) => historyByName.set(person.name, [...(historyByName.get(person.name) || []), ...(person.calendar || [])]));
  });
  return currentPeople.map((person) => {
    const combined = [...(historyByName.get(person.name) || []), ...(person.calendar || [])].sort((a, b) => a.date.localeCompare(b.date));
    let streak = 0; let maximum = 0; let previousDate = null;
    combined.forEach((day) => {
      if (previousDate && Date.parse(day.date) - Date.parse(previousDate) !== 86400000) streak = 0;
      streak = day.status === 'work' ? streak + 1 : 0;
      if (day.date.startsWith(month)) maximum = Math.max(maximum, streak);
      previousDate = day.date;
    });
    const currentStart = combined.findIndex((day) => day.date.startsWith(month));
    const suggestedRestDate = combined.find((day, index) => day.date.startsWith(month) && day.status === 'unassigned' && index >= 6 && combined.slice(index - 6, index).every((item, offset) => item.status === 'work' && Date.parse(day.date) - Date.parse(item.date) === (6 - offset) * 86400000))?.date || null;
    return {
      ...person,
      previousMonthDaysIncluded: Math.max(0, currentStart),
      maximumConsecutiveWorkDays: maximum,
      suggestedRestDate,
      alert: maximum >= 6 ? `跨月最长连续排播 ${maximum} 天，建议优先确认休息日。` : '',
    };
  }).sort((a, b) => Number(Boolean(b.alert)) - Number(Boolean(a.alert)) || a.roomName.localeCompare(b.roomName, 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'));
}

module.exports = { ROOM_PLANNING, SHIFT_TIMES, VERIFIED_ANCHOR_ROOMS, dateKeys, formatShiftCell, generateDraft, generateMakeupDraft, normalizeRoster, parseRestSource, parseRestSources, restAdjustmentFromNote, scheduleDateKey, summarizeAnchorResources, summarizeAttendance, summarizeResourceAverages, transitionAllowed };

/** Only rest dates changed by the user are patched; other assignments are untouched. */
function syncDraftRestDays(draft, roster) {
  const next=structuredClone(draft),changes=[];
  next.restBackups={...(draft.restBackups||{})};
  for(const person of roster){
    const existing=next.roster.find(item=>item.name===person.name);
    if(!existing)continue;
    const previous=new Set(existing.restDates||[]),desired=new Set(person.restDates||[]);
    for(const date of next.dates){
      if(previous.has(date)===desired.has(date))continue;
      const key=date+'|'+person.name,index=next.assignments.findIndex(item=>item.date===date&&item.name===person.name);
      if(desired.has(date)){
        if(index>=0)next.restBackups[key]=structuredClone(next.assignments[index]);
        const rest={date,name:person.name,shiftCode:'休',rest:true,score:0,shiftTime:'休息',restReason:'同步休息日'};
        if(index>=0)next.assignments[index]=rest;else next.assignments.push(rest);
      }else if(next.restBackups[key]){
        if(index>=0)next.assignments[index]=next.restBackups[key];else next.assignments.push(next.restBackups[key]);
        delete next.restBackups[key];
      }else{
        if(index>=0&&next.assignments[index].rest)next.assignments.splice(index,1);
        next.warnings=[...(next.warnings||[]),date+' '+person.name+'：取消休息但无原班次备份，请手工安排。'];
      }
      changes.push({date,name:person.name,rest:desired.has(date)});
    }
    existing.restDates=[...desired];existing.entitlement=person.entitlement;
  }
  next.attendance=summarizeAttendance(next.roster,next.assignments);
  next.resourceAverages=summarizeResourceAverages(next.dates,next.assignments);
  next.anchorResourceSummary=summarizeAnchorResources(next.roster,next.assignments);
  return {draft:next,changes};
}
/** Mirrored M shifts only. Never re-generate the partner's normal assignments. */
function linkOvernightDrafts(source, drafts) {
  const targetRoomCode=source.roomCode==='youxuan'?'guanqi':source.roomCode==='wangou'?'brand_selection':null;
  if(source.role!=='anchor')return {drafts,linkedKeys:[]};
  if(!targetRoomCode){
    // The source room owns rank/rest decisions. Saving its partner must also
    // restore the linked M cells, including partners created after the source.
    const sourceRoom=source.roomCode==='guanqi'?'youxuan':source.roomCode==='brand_selection'?'wangou':null;
    let result=drafts;const keys=new Set();
    if(sourceRoom)for(const draft of Object.values(drafts)){
      if(draft.role!=='anchor'||draft.roomCode!==sourceRoom||!draft.dates.some(date=>source.dates.includes(date)))continue;
      const linked=linkOvernightDrafts(draft,result);result=linked.drafts;linked.linkedKeys.forEach(key=>keys.add(key));
    }
    return {drafts:result,linkedKeys:[...keys]};
  }
  const result={...drafts},linkedKeys=[];
  for(const [key,draft] of Object.entries(drafts)){
    if(draft.role!=='anchor'||draft.roomCode!==targetRoomCode||!draft.dates.some(date=>source.dates.includes(date)))continue;
    const next=structuredClone(draft);
    const overlap=new Set(source.dates.filter(date=>next.dates.includes(date)));
    const incoming=source.assignments.filter(item=>overlap.has(item.date)&&item.shiftCode==='M'&&!item.rest);
    for(const item of incoming){
      if(next.assignments.some(row=>row.date===item.date&&row.name===item.name&&!row.rest&&row.shiftCode!=='M'))throw Object.assign(Error(item.date+' '+item.name+' 已在配对直播间安排常规班次，不能再排通宵。'),{status:409});
    }
    const removed=next.assignments.filter(item=>overlap.has(item.date)&&item.shiftCode==='M');
    next.linkHistory=[...(next.linkHistory||[]),{at:new Date().toISOString(),sourceRoom:source.roomCode,before:removed}];
    next.assignments=next.assignments.filter(item=>!(overlap.has(item.date)&&item.shiftCode==='M'));
    for(const item of incoming){
      next.assignments=next.assignments.filter(row=>!(row.date===item.date&&row.name===item.name&&row.rest));
      if(!next.roster.some(person=>person.name===item.name))next.roster.push({...source.roster.find(person=>person.name===item.name),guestFrom:source.roomCode,restDates:[]});
      next.assignments.push({...item,linkedFrom:source.roomCode,targetRoomCode});
    }
    next.updatedAt=new Date().toISOString();next.attendance=summarizeAttendance(next.roster,next.assignments);next.anchorResourceSummary=summarizeAnchorResources(next.roster,next.assignments);next.resourceAverages=summarizeResourceAverages(next.dates,next.assignments);
    result[key]=next;linkedKeys.push(key);
  }
  return {drafts:result,linkedKeys};
}
module.exports.syncDraftRestDays=syncDraftRestDays;
module.exports.linkOvernightDrafts=linkOvernightDrafts;
