/**
 * 直播中心班表服务
 *
 * 凭据仅保留在服务端。写回必须经过：中枢权限 -> 预览 -> 目标单元格
 * 指纹校验 -> 精确范围写入 -> 飞书回读 -> 本地审计。
 */
const http = require('http');
const fs = require('fs/promises');
const { constants: fsConstants } = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { ROOM_PLANNING, SHIFT_TIMES, formatShiftCell, linkOvernightDrafts, syncDraftRestDays, generateDraft, generateMakeupDraft, parseRestSources, summarizeAnchorResources, summarizeAttendance, summarizeResourceAverages } = require('./planning-engine');
const { buildOpeningPreview } = require('./notification-preview');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.DISPATCH_CENTER_PORT || 3000);
const RECOVERY_READ_ONLY = process.env.RECOVERY_READ_ONLY === '1';
const SOURCE_SNAPSHOT_ENABLED = RECOVERY_READ_ONLY && Boolean(process.env.RECOVERY_SOURCE_SNAPSHOT_PATH);
const sourceSnapshot = SOURCE_SNAPSHOT_ENABLED ? require('./source-snapshot').createSnapshotReader(process.env.RECOVERY_SOURCE_SNAPSHOT_PATH, process.env.RECOVERY_SOURCE_SNAPSHOT_SHA256) : null;
const RECOVERY_MESSAGE = '维护恢复中，仅供查看。历史排班草稿与配置尚待恢复，保存和飞书写回已暂停。';
function recoveryPayload() { return {readOnly:true,historyStatus:'pending_recovery',message:RECOVERY_MESSAGE}; }
function withRecoveryBanner(content) {
  if (!RECOVERY_READ_ONLY) return content;
  const banner = `<style>html[data-live-hub-recovery-banner]{--live-hub-recovery-height:64px}html[data-live-hub-recovery-banner] body{padding-top:var(--live-hub-recovery-height)!important}html[data-live-hub-recovery-banner] .app-shell{min-height:calc(100dvh - var(--live-hub-recovery-height))!important}html[data-live-hub-recovery-banner] .app-shell>.sidebar{top:var(--live-hub-recovery-height)!important;height:calc(100dvh - var(--live-hub-recovery-height))!important;overflow-y:auto}#live-hub-recovery-notice{position:fixed;inset:0 0 auto;z-index:2147483647;min-height:64px;display:flex;align-items:center;justify-content:center;padding:10px 18px;box-sizing:border-box;background:#fff2cc;border-bottom:2px solid #c79226;color:#64450b;font:600 14px/1.5 system-ui,sans-serif;text-align:center}#live-hub-recovery-notice[hidden]{display:none!important}</style><aside id="live-hub-recovery-notice" role="status" hidden>${RECOVERY_MESSAGE}</aside><script src="./recovery-notice.js?v=20260914a" defer></script>`;
  return String(content).replace(/<body([^>]*)>/iu, '<body$1>'+banner);
}
const ROOT = __dirname;
const FEISHU_API = 'https://open.feishu.cn/open-apis';
const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const SCHEDULE_SPREADSHEET_TOKEN = process.env.SCHEDULE_SPREADSHEET_TOKEN || 'EuYqssm4WhNwAvtyybKcDdk1ned';
const TOTAL_SCHEDULE_SPREADSHEET_TOKEN = process.env.TOTAL_SCHEDULE_SPREADSHEET_TOKEN || '';
const TOTAL_SCHEDULE_SHEET_ID = process.env.TOTAL_SCHEDULE_SHEET_ID || '';
// September 2026 is the business-confirmed schedule workbook supplied for this
// module update. Keep the current target configurable for future monthly books.
const TOTAL_SCHEDULE_WIKI_TOKEN = process.env.TOTAL_SCHEDULE_WIKI_TOKEN || 'UKVDwxpz7iKAv8k5KxTcxiDVnuf';
const REST_SOURCE_WIKI_TOKEN = process.env.REST_SOURCE_WIKI_TOKEN || TOTAL_SCHEDULE_WIKI_TOKEN;
const MAKEUP_SOURCE_WIKI_TOKEN = 'QrjQwGyHoi6kZYkuKYCczBGYnoc';
const MAKEUP_SPREADSHEET_TOKEN = process.env.MAKEUP_SCHEDULE_SPREADSHEET_TOKEN || '';
const MAKEUP_SHEET_ID = process.env.MAKEUP_SCHEDULE_SHEET_ID || '33648c';
const TOTAL_SCHEDULE_WIKI_URL = `https://jqx28l0j4lx.feishu.cn/wiki/${TOTAL_SCHEDULE_WIKI_TOKEN}`;
const REST_SCHEDULE_SOURCES = Object.freeze({
  '2026-08': { wikiToken: 'J3ddwrBS1ibvsmkMeR2ctzEMn0d', spreadsheetToken: 'ON0Csry1ahlnrptURUPcrfJVn7e', sheetId: '0RAcLc', label: '2026 年 8 月原始排班表' },
  '2026-09': { wikiToken: 'UKVDwxpz7iKAv8k5KxTcxiDVnuf', spreadsheetToken: '', sheetId: '0jFdXf', label: '品牌营销部-直播中心排班表_20260901_20260930' },
});
const CENTRAL_AUTHORITY_BASE = String(
  process.env.CENTRAL_AUTHORITY_BASE || 'https://app.fandow.top/fd-026222/wis-central-auth/api',
).replace(/\/+$/u, '');
const REQUIRED_MODULE = 'live-room-management';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const AUDIT_LOG_PATH = process.env.SCHEDULE_AUDIT_LOG_PATH || path.join(DATA_DIR, 'schedule-writeback-audit.ndjson');
const PLANNING_STORE_PATH = process.env.PLANNING_STORE_PATH || path.join(DATA_DIR, 'planning-workbench.json');
const HOURLY_REFRESH_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 512 * 1024;
const WIKI_RESOLUTION_TTL_MS = 5 * 60 * 1000;

const ROOMS = [
  {
    code: 'guanqi', name: '官旗', platform: '抖音', className: 'flagship', sheetId: 'NYB2iu', maxColumn: 'Q',
    rosterCandidates: [[13, 14], [15, 16]], timelineColumns: [3, 15],
  },
  {
    code: 'brand_selection', name: '品牌精选', platform: '抖音', className: 'brand-room', sheetId: 'MVpDv0', maxColumn: 'L',
    rosterCandidates: [[1, 2]], timelineColumns: [3, 12],
  },
  {
    code: 'youxuan', name: '优选', platform: '抖音', className: 'best', sheetId: 'LRAvIU', maxColumn: 'L',
    rosterCandidates: [[1, 2]], timelineColumns: [3, 12],
  },
  {
    code: 'wangou', name: '王鸥美肤', platform: '视频号', className: 'wangou', sheetId: 'PhlV42', maxColumn: 'K',
    rosterCandidates: [[1, 2]], timelineColumns: [3, 11],
  },
];

let tenantToken = null;
const resolvedWikiSheets = new Map();
const resolvedSpreadsheetSheets = new Map();
let scheduleSourceCache = { expiresAt: 0, sheets: null };
const scheduleCache = new Map();

function securityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'self'");
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

function json(response, payload, status = 200) {
  securityHeaders(response);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function flattenCell(value) {
  if (Array.isArray(value)) return value.map(flattenCell).join('');
  if (value && typeof value === 'object') return String(value.text ?? value.value ?? '').trim();
  return String(value ?? '').trim();
}

function hashValue(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    throw Object.assign(new Error('日期格式应为 YYYY-MM-DD。'), { status: 422 });
  }
  return value;
}

function normalizeName(value) {
  const name = String(value || '').replace(/\s+/gu, ' ').trim();
  if (!name || name.length > 40) throw Object.assign(new Error('请填写 1—40 个字符的排班姓名。'), { status: 422 });
  if (/[<>\r\n\t]/u.test(name)) throw Object.assign(new Error('排班姓名包含不支持的字符。'), { status: 422 });
  return name;
}

function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

async function getTenantToken() {
  if (tenantToken && tenantToken.expiresAt > Date.now() + 60_000) return tenantToken.value;
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    throw Object.assign(new Error('未配置飞书应用凭据。'), { status: 503 });
  }
  const response = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw Object.assign(new Error(payload.msg || '无法获取飞书访问令牌。'), { status: 502 });
  }
  tenantToken = {
    value: payload.tenant_access_token,
    expiresAt: Date.now() + Math.max(60, Number(payload.expire || 7200) - 120) * 1000,
  };
  return tenantToken.value;
}

async function readWorkbookRevision(token) {
  try {
    const response = await fetch(`${FEISHU_API}/sheets/v3/spreadsheets/${SCHEDULE_SPREADSHEET_TOKEN}/sheets/query`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json();
    return Number(payload.data?.revision || payload.data?.spreadsheet?.revision || 0);
  } catch {
    return 0;
  }
}

async function readScheduleSheet(room, token) {
  const range = `${room.sheetId}!A:${room.maxColumn}`;
  if (sourceSnapshot) return sourceSnapshot.range(SCHEDULE_SPREADSHEET_TOKEN, range);
  const query = new URLSearchParams({ valueRenderOption: 'ToString', dateTimeRenderOption: 'FormattedString' });
  const response = await fetch(`${FEISHU_API}/sheets/v2/spreadsheets/${SCHEDULE_SPREADSHEET_TOKEN}/values/${encodeURIComponent(range)}?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw Object.assign(new Error(`${room.name}班表读取失败：${payload.msg || response.status}`), { status: 502 });
  }
  const values = payload.data?.valueRange?.values;
  if (!Array.isArray(values)) throw Object.assign(new Error(`${room.name}班表没有可读取的数据。`), { status: 502 });
  return {
    rows: values.map((row) => Array.isArray(row) ? row.map(flattenCell) : []),
    revision: Number(payload.data?.revision || payload.data?.valueRange?.revision || 0),
    source: {mode:'official_live',readAt:new Date().toISOString(),spreadsheetToken:SCHEDULE_SPREADSHEET_TOKEN,sheetId:room.sheetId},
  };
}

async function readRoomFresh(room) {
  if (sourceSnapshot) return readScheduleSheet(room);
  const token = await getTenantToken();
  const result = await readScheduleSheet(room, token);
  if (!result.revision) result.revision = await readWorkbookRevision(token);
  return { ...result, token };
}

async function readScheduleSheets(forceRefresh = false) {
  if (sourceSnapshot) return Object.fromEntries(await Promise.all(ROOMS.map(async room=>[room.code,await readScheduleSheet(room)])));
  if (!forceRefresh && scheduleSourceCache.sheets && scheduleSourceCache.expiresAt > Date.now()) {
    return scheduleSourceCache.sheets;
  }
  const token = await getTenantToken();
  const revision = await readWorkbookRevision(token);
  const entries = await Promise.all(ROOMS.map(async (room) => {
    const result = await readScheduleSheet(room, token);
    return [room.code, { ...result, revision: result.revision || revision }];
  }));
  const sheets = Object.fromEntries(entries);
  scheduleSourceCache = { sheets, expiresAt: Date.now() + HOURLY_REFRESH_MS };
  return sheets;
}

const shiftTimes = {
  GJ3: ['05:30', '13:00'], L: ['05:30', '14:30'], R: ['06:30', '15:30'], GJ2: ['07:30', '15:00'], AC1: ['07:30', '16:30'],
  F: ['08:00', '17:00'], A: ['08:30', '17:30'], TXQJ: ['08:30', '17:30'], W: ['09:00', '18:00'], D2: ['09:30', '18:30'], Q: ['09:30', '18:30'],
  X: ['10:00', '19:00'], H: ['10:00', '20:30'], Z: ['11:30', '20:00'], B2: ['12:00', '21:00'], S: ['12:30', '21:00'], I: ['13:00', '22:00'],
  GJ4: ['13:30', '21:00'], B3: ['13:30', '22:00'], J: ['14:00', '23:00'], GJ6: ['14:30', '22:00'], J2: ['14:30', '23:00'],
  G: ['15:00', '00:00'], GJ: ['15:30', '23:00'], G2: ['15:30', '23:59'], K: ['16:00', '01:00'], P: ['16:30', '01:00'],
  GJ5: ['17:30', '01:00'], WB: ['17:30', '02:00'], ZBB: ['21:00', '06:00'], N2: ['20:00', '04:30'], M: ['21:30', '05:00'], ZB1: ['05:00', '14:00'],
};

function namesFromCell(value) {
  return String(value || '').split(/[、,，\n\s/&＆]+/u).map((name) => name.trim())
    .filter((name) => name && !/主播|姓名|打卡|班次|休息|待定|无/u.test(name));
}

function normalizeTime(hours, minutes) {
  return `${String(Number(hours)).padStart(2, '0')}:${String(Number(minutes)).padStart(2, '0')}`;
}

function timeRangeFromCell(value) {
  const text = String(value || '').replace(/：/gu, ':').replace(/[～~—至]/gu, '-').replace(/次日/gu, '');
  const match = text.match(/(\d{1,2}):(\d{1,2})\s*-\s*(\d{1,2}):(\d{1,2})/u);
  return match ? [normalizeTime(match[1], match[2]), normalizeTime(match[3], match[4])] : null;
}

function shiftFromCell(value) {
  const text = String(value || '').replace(/（/gu, '(').replace(/）/gu, ')');
  if (/休息|OFF/iu.test(text)) return { shift: '休息', range: null };
  const times = timeRangeFromCell(text);
  if (times) return { shift: text, range: times };
  const code = Object.keys(shiftTimes).sort((a, b) => b.length - a.length)
    .find((item) => text.toUpperCase().startsWith(item));
  return { shift: text, range: code ? shiftTimes[code] : null };
}

const { onShift: isOnShift, businessDate } = require('./schedule-clock');

const WEEKDAY_ALIASES = [/[日天0]/u, /[一1]/u, /[二2]/u, /[三3]/u, /[四4]/u, /[五5]/u, /[六6]/u];

function isDateMarker(value) {
  return /(20\d{2}[年\-/.])?\d{1,2}月\d{1,2}日/u.test(String(value || ''));
}

function dateMarkerMatches(value, requestedDate) {
  const text = String(value || '');
  const match = text.match(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/u);
  if (!match) return false;
  const expected = new Date(`${requestedDate}T12:00:00+08:00`);
  if (Number(match[2]) !== expected.getMonth() + 1 || Number(match[3]) !== expected.getDate()) return false;
  if (match[1] && Number(match[1]) !== expected.getFullYear()) return false;
  const weekday = text.match(/星期\s*([日天一二三四五六0-6])/u);
  return !weekday || WEEKDAY_ALIASES[expected.getDay()].test(weekday[1]);
}

function findDateBlockWithMeta(rows, requestedDate) {
  let start = -1;
  rows.forEach((row, index) => { if (dateMarkerMatches(row[0], requestedDate)) start = index; });
  if (start < 0) return { rows: [], firstRow: null, lastRow: null, marker: '' };
  let end = rows.length;
  for (let index = start + 1; index < rows.length; index += 1) {
    if (isDateMarker(rows[index]?.[0])) { end = index; break; }
  }
  return { rows: rows.slice(start, end), firstRow: start + 1, lastRow: end, marker: String(rows[start]?.[0] || '') };
}

function findDateBlock(rows, requestedDate) {
  return findDateBlockWithMeta(rows, requestedDate).rows;
}

function timelineName(value) {
  const name = String(value || '').trim();
  return name && !/^(时间|主播|助理|不断播|机制|暂无|无)$/u.test(name) ? name : '';
}

function longestTimeSlotRun(row, bounds) {
  let best = [];
  let current = [];
  for (let index = bounds[0]; index < bounds[1]; index += 1) {
    if (timeRangeFromCell(row[index])) current.push(index);
    else {
      if (current.length > best.length) best = current;
      current = [];
    }
  }
  return current.length > best.length ? current : best;
}

function timeSlotIndices(row, bounds) {
  const indices = [];
  for (let index = bounds[0]; index < bounds[1]; index += 1) {
    if (timeRangeFromCell(row[index])) indices.push(index);
  }
  return indices;
}

function mergeAdjacentShifts(shifts) {
  return shifts.reduce((merged, shift) => {
    const previous = merged[merged.length - 1];
    if (previous && previous[1] === shift[0] && previous[2] === shift[2]) previous[1] = shift[1];
    else merged.push([...shift]);
    return merged;
  }, []);
}

function shiftsFromPairedRows(rangeRow, nameRow, bounds) {
  const shifts = timeSlotIndices(rangeRow, bounds).flatMap((index) => {
    const range = timeRangeFromCell(rangeRow[index]);
    const name = timelineName(nameRow[index]);
    return range && name ? [[range[0], range[1], name]] : [];
  });
  return mergeAdjacentShifts(shifts);
}

function rosterScore(block, columns) {
  return block.reduce((score, row) => {
    const names = namesFromCell(row[columns[0]]);
    const attendance = shiftFromCell(row[columns[1]]);
    return score + (names.length && attendance.shift ? names.length : 0);
  }, 0);
}

function resolveRosterColumns(room, block) {
  return room.rosterCandidates.reduce((best, columns) => (
    rosterScore(block, columns) > rosterScore(block, best) ? columns : best
  ), room.rosterCandidates[0]);
}

function resolveTimelineBounds(room, block) {
  const rosterStart = resolveRosterColumns(room, block)[0];
  const end = rosterStart > room.timelineColumns[0]
    ? Math.min(room.timelineColumns[1], rosterStart)
    : room.timelineColumns[1];
  return [room.timelineColumns[0], end];
}

function findTimelinePairs(room, block) {
  const bounds = resolveTimelineBounds(room, block);
  let headerIndex = -1;
  let headerRun = [];
  block.forEach((row, index) => {
    const run = timeSlotIndices(row, bounds);
    if (run.length > headerRun.length) { headerIndex = index; headerRun = run; }
  });
  const pairs = [];
  if (headerIndex >= 0 && block[headerIndex + 1]) {
    pairs.push({ role: 'anchor', rangeRowIndex: headerIndex, nameRowIndex: headerIndex + 1, slots: headerRun });
  }
  for (let index = headerIndex + 2; index < block.length - 1; index += 1) {
    const slots = timeSlotIndices(block[index], bounds);
    if (slots.length) {
      pairs.push({ role: 'assistant', rangeRowIndex: index, nameRowIndex: index + 1, slots });
      index += 1;
    }
  }
  return pairs;
}

function parseRoomSchedule(room, rows, requestedDate) {
  const match = findDateBlockWithMeta(rows, requestedDate);
  const block = match.rows;
  const parsedRoom = {
    code: room.code, name: room.name, platform: room.platform, className: room.className, anchors: [], assistants: [],
  };
  const roster = [];
  if (!block.length) {
    return { room: parsedRoom, roster, source: { found: false, sheetId: room.sheetId, firstRow: null, lastRow: null, marker: '' } };
  }

  const rosterColumns = resolveRosterColumns(room, block);
  block.forEach((row) => {
    const names = namesFromCell(row[rosterColumns[0]]);
    const attendance = shiftFromCell(row[rosterColumns[1]]);
    if (!names.length || !attendance.shift) return;
    names.forEach((name) => roster.push({ name, shift: attendance.shift, room: room.name, range: attendance.range }));
  });

  const pairs = findTimelinePairs(room, block);
  const timelineBounds = resolveTimelineBounds(room, block);
  const anchorPair = pairs.find((pair) => pair.role === 'anchor');
  if (anchorPair) {
    parsedRoom.anchors = shiftsFromPairedRows(block[anchorPair.rangeRowIndex], block[anchorPair.nameRowIndex], timelineBounds);
  }
  pairs.filter((pair) => pair.role === 'assistant').forEach((pair) => {
    parsedRoom.assistants.push(...shiftsFromPairedRows(block[pair.rangeRowIndex], block[pair.nameRowIndex], timelineBounds));
  });
  parsedRoom.assistants = mergeAdjacentShifts(parsedRoom.assistants);
  return {
    room: parsedRoom,
    roster,
    source: {
      found: true, sheetId: room.sheetId, firstRow: match.firstRow, lastRow: match.lastRow, marker: match.marker,
      rosterColumns: rosterColumns.map(columnName),
    },
  };
}

function sheetRows(value) {
  return Array.isArray(value) ? value : value?.rows || [];
}

function sheetRevision(value) {
  return Array.isArray(value) ? 0 : Number(value?.revision || 0);
}

function parseScheduleSheets(sheets, requestedDate) {
  const parsed = ROOMS.map((room) => parseRoomSchedule(room, sheetRows(sheets[room.code]), requestedDate));
  return {
    rooms: parsed.map((item) => item.room),
    roster: parsed.flatMap((item) => item.roster),
    sourceStatus: Object.fromEntries(parsed.map((item) => [item.room.code, {
      ...item.source, revision: sheetRevision(sheets[item.room.code]),
    }])),
  };
}

function availabilityFromRoster(roster, rooms, date) {
  const now = new Date();
  const currentNames = new Set(rooms.flatMap((room) => room.anchors
    .filter((shift) => isOnShift([shift[0], shift[1]], now, date)).map((shift) => shift[2])));
  const deduped = new Map();
  roster.forEach((person) => { if (!deduped.has(person.name) || person.shift === '休息') deduped.set(person.name, person); });
  const people = [...deduped.values()];
  return {
    standby: date === businessDate(now) ? people
      .filter((person) => person.range && isOnShift(person.range, now, date) && !currentNames.has(person.name))
      .map((person) => ({ name: person.name, shift: `${person.room} · ${person.shift}` })) : [],
    resting: people.filter((person) => person.shift === '休息').map((person) => ({ name: person.name, note: person.room })),
    sourceDate: date,
  };
}

function columnName(index) {
  let value = Number(index) + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function roleMetadata(room, rows, date) {
  const match = findDateBlockWithMeta(rows, date);
  if (!match.rows.length) return {};
  return Object.fromEntries(findTimelinePairs(room, match.rows).map((pair) => {
    const absoluteNameRow = match.firstRow + pair.nameRowIndex;
    const slots = pair.slots.map((cellIndex) => {
      const range = timeRangeFromCell(match.rows[pair.rangeRowIndex][cellIndex]);
      return {
        cell: `${columnName(cellIndex)}${absoluteNameRow}`,
        start: range[0],
        end: range[1],
        value: flattenCell(match.rows[pair.nameRowIndex][cellIndex]),
      };
    });
    return [pair.role, { slots }];
  }));
}

function buildWritebackPlan(room, rows, input, revision = 0) {
  const date = normalizeDate(input.date);
  const role = input.role === 'assistant' ? 'assistant' : input.role === 'anchor' ? 'anchor' : null;
  if (!role) throw Object.assign(new Error('排班角色仅支持主播或助播。'), { status: 422 });
  const name = normalizeName(input.name);
  const match = findDateBlockWithMeta(rows, date);
  if (!match.rows.length) throw Object.assign(new Error(`${room.name}未找到 ${date} 的班表日期块。`), { status: 404 });
  const pair = findTimelinePairs(room, match.rows).find((item) => item.role === role);
  if (!pair) {
    throw Object.assign(new Error(`${room.name}未找到可写入的${role === 'anchor' ? '主播' : '助播'}时间轴。`), { status: 409 });
  }
  const slots = pair.slots.map((cellIndex) => ({
    cellIndex, range: timeRangeFromCell(match.rows[pair.rangeRowIndex][cellIndex]),
  }));
  const startIndex = slots.findIndex((slot) => slot.range[0] === input.start);
  const endIndex = slots.findIndex((slot, index) => index >= startIndex && slot.range[1] === input.end);
  if (startIndex < 0 || endIndex < startIndex) {
    throw Object.assign(new Error('开始/结束时间必须与班表中的现有时间段边界一致。'), { status: 422 });
  }
  const selected = slots.slice(startIndex, endIndex + 1);
  const isContinuous = selected.every((slot, index) => index === 0 || selected[index - 1].range[1] === slot.range[0]);
  if (!isContinuous) throw Object.assign(new Error('所选时间段在班表中不连续，不能写回。'), { status: 422 });
  const firstColumn = selected[0].cellIndex;
  const lastColumn = selected[selected.length - 1].cellIndex;
  const absoluteNameRow = match.firstRow + pair.nameRowIndex;
  const before = selected.map((slot) => flattenCell(match.rows[pair.nameRowIndex][slot.cellIndex]));
  const range = `${room.sheetId}!${columnName(firstColumn)}${absoluteNameRow}:${columnName(lastColumn)}${absoluteNameRow}`;
  const fingerprint = {
    date, roomCode: room.code, role, name, action:input.action||'assign', range, before, marker: match.marker, firstRow: match.firstRow, lastRow: match.lastRow,
  };
  if(input.action==='remove' && before.some(value=>value!==name))throw Object.assign(new Error('删除范围必须全部属于所填姓名；请缩小时间范围后重新预览。'),{status:409});
  const after=selected.map(()=>input.action==='remove'?'':name);
  return {
    action:input.action==='remove'?'remove':'assign',
    date, roomCode: room.code, roomName: room.name, role, name, start: input.start, end: input.end,
    range, before, after, revision: Number(revision || 0),
    expectedHash: hashValue(fingerprint),
    overwrites: [...new Set(before.filter((value) => value && value !== name))],
    noChange: before.every((value,index) => value === after[index]),
  };
}

async function writeFeishuRange(token, plan) {
  const response = await fetch(`${FEISHU_API}/sheets/v2/spreadsheets/${SCHEDULE_SPREADSHEET_TOKEN}/values`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueRange: { range: plan.range, values: [plan.after] } }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw Object.assign(new Error(`飞书班表写入失败：${payload.msg || response.status}`), { status: 502 });
  }
  return payload.data || {};
}

async function readExactRange(token, range) {
  const query = new URLSearchParams({ valueRenderOption: 'ToString', dateTimeRenderOption: 'FormattedString' });
  const response = await fetch(`${FEISHU_API}/sheets/v2/spreadsheets/${SCHEDULE_SPREADSHEET_TOKEN}/values/${encodeURIComponent(range)}?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw Object.assign(new Error(`飞书班表回读失败：${payload.msg || response.status}`), { status: 502 });
  }
  return (payload.data?.valueRange?.values?.[0] || []).map(flattenCell);
}

function directLocalRequest(request) {
  if (process.env.HUB_SAME_ORIGIN_EMBED === 'true') return false;
  const forwarded = request.headers['x-forwarded-for'] || request.headers['x-real-ip'];
  const remote = String(request.socket.remoteAddress || '').replace(/^::ffff:/u, '');
  const privateAddress = remote === '127.0.0.1'
    || remote === '::1'
    || /^10\./u.test(remote)
    || /^192\.168\./u.test(remote)
    || /^172\.(1[6-9]|2\d|3[01])\./u.test(remote);
  return !forwarded && privateAddress;
}

function authorityHeaders(request) {
  const headers = { Accept: 'application/json' };
  if (request.headers.cookie) headers.Cookie = request.headers.cookie;
  if (request.headers['x-oa-token']) headers['X-OA-Token'] = request.headers['x-oa-token'];
  return headers;
}

async function authorize(request) {
  if (directLocalRequest(request)) {
    return {
      ok: true,
      mode: 'internal',
      user: { name: '服务器本机验收', id: 'internal' },
      permissions: { super_admin: true, operation_admin: true, manage_permissions: true },
    };
  }
  let upstream;
  try {
    upstream = await fetch(`${CENTRAL_AUTHORITY_BASE}/central-auth/me`, {
      headers: authorityHeaders(request), redirect: 'manual', signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, status: 503, detail: '统一权限服务暂时不可用，请稍后重试。' };
  }
  const payload = await upstream.json().catch(() => ({}));
  if (upstream.status !== 200) {
    const status = upstream.status === 401 || (upstream.status >= 300 && upstream.status < 400)
      ? 401
      : upstream.status === 403 ? 403 : 503;
    return {
      ok: false, status,
      detail: payload.detail || (status === 403 ? '当前账号未开通中枢登录权限。' : '统一登录状态已失效。'),
    };
  }
  if (!payload.access?.allowed_modules?.includes(REQUIRED_MODULE)) {
    return { ok: false, status: 403, detail: '当前账号未开通直播间管理权限。' };
  }
  return { ok: true, mode: 'central', user: payload.user || {}, permissions: payload.permissions || {} };
}

function actorFromAuth(auth) {
  const user = auth.user || {};
  const rawId = String(user.id || user.userId || user.number || user.realName || user.name || auth.mode);
  return {
    name: String(user.realName || user.name || (auth.mode === 'internal' ? '服务器本机验收' : '已授权成员')),
    ref: hashValue(rawId).slice(0, 16),
    authMode: auth.mode,
  };
}

function sessionFromAuth(auth) {
  const user = auth.user || {};
  const permissions = auth.permissions || {};
  const name = String(user.realName || user.name || (auth.mode === 'internal' ? '服务器本机验收' : '已授权成员'));
  const role = permissions.super_admin || permissions.manage_permissions
    ? '中枢管理员'
    : permissions.operation_admin
      ? '运营管理员'
      : '已授权成员';
  return {
    user: { name, role },
    permissions: {
      super_admin: Boolean(permissions.super_admin),
      operation_admin: Boolean(permissions.operation_admin),
      manage_permissions: Boolean(permissions.manage_permissions),
    },
    access: { required_module: REQUIRED_MODULE },
  };
}

async function appendAudit(entry) {
  await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
  await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o640 });
}

async function readAudit(limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  try {
    const content = await fs.readFile(AUDIT_LOG_PATH, 'utf8');
    return content.trim().split(/\r?\n/u).filter(Boolean).slice(-safeLimit).reverse().map((line) => JSON.parse(line));
  } catch (error) {
    if (RECOVERY_READ_ONLY) throw Object.assign(new Error('历史排班写回审计记录尚待恢复，暂时无法读取；不能据此判断此前没有发生写回。'), {status:503,code:'history_recovery_pending'});
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readSpreadsheetRange(spreadsheetToken, range) {
  if (sourceSnapshot) return sourceSnapshot.range(spreadsheetToken, range);
  const token = await getTenantToken();
  const query = new URLSearchParams({ valueRenderOption: 'ToString', dateTimeRenderOption: 'FormattedString' });
  const response = await fetch(`${FEISHU_API}/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}?${query}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) throw Object.assign(new Error(`飞书表格读取失败：${payload.msg || response.status}`), { status: response.status === 403 ? 403 : 502 });
  return { token, rows: (payload.data?.valueRange?.values || []).map((row) => Array.isArray(row) ? row.map(flattenCell) : []), revision: Number(payload.data?.revision || payload.data?.valueRange?.revision || 0) };
}

async function readPlanningStore() {
  try {
    const value = JSON.parse(await fs.readFile(PLANNING_STORE_PATH, 'utf8'));
    if (RECOVERY_READ_ONLY) {
      const record = item => Boolean(item) && typeof item === 'object' && !Array.isArray(item);
      if (!record(value) || !record(value.drafts) || !['makeupDrafts','restProfiles','restSettings'].every(key => !Object.hasOwn(value,key) || record(value[key]))) {
        throw new Error('Invalid historical planning store structure');
      }
    }
    return value && typeof value === 'object' ? value : { schemaVersion: 3, drafts: {}, makeupDrafts: {}, restProfiles: {}, restSettings: {}, updatedAt: null };
  } catch (error) {
    if (RECOVERY_READ_ONLY) throw Object.assign(new Error('历史排班草稿与休息配置尚待恢复，暂时无法读取；已发布到飞书的原始排班可从当前排班查看。'), {status:503,code:'history_recovery_pending'});
    if (error.code === 'ENOENT') return { schemaVersion: 3, drafts: {}, makeupDrafts: {}, restProfiles: {}, restSettings: {}, updatedAt: null };
    throw error;
  }
}

async function writePlanningStore(store) {
  if (RECOVERY_READ_ONLY) throw Object.assign(new Error(RECOVERY_MESSAGE), {status:423,code:'recovery_read_only'});
  await fs.mkdir(path.dirname(PLANNING_STORE_PATH), { recursive: true });
  const temporary = `${PLANNING_STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(store), { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporary, PLANNING_STORE_PATH);
}

async function planningStorageHealth() {
  if (RECOVERY_READ_ONLY) {
    await fs.access(DATA_DIR, fsConstants.R_OK);
    return {directory:DATA_DIR,store:PLANNING_STORE_PATH,access:'read-only',historyStatus:'pending_recovery'};
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.access(DATA_DIR, fsConstants.R_OK | fsConstants.W_OK);
  try { await fs.access(PLANNING_STORE_PATH, fsConstants.R_OK | fsConstants.W_OK); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { directory: DATA_DIR, store: PLANNING_STORE_PATH, access: 'read-write' };
}

function planningDraftKey(draft) { return [draft.roomCode, draft.role, draft.startDate, draft.endDate].join(':'); }

function normalizePlanningDraft(input) {
  const generated = generateDraft(input);
  if (!Array.isArray(input?.assignments)) return generated;
  const rosterNames = new Set(generated.roster.map((person) => person.name));
  const dates = new Set(generated.dates);
  const assignments = input.assignments.map((item) => {
    const name = normalizeName(item?.name); const date = normalizeDate(item?.date);
    const shiftCode = String(item?.shiftCode || '').replace(/\s+/gu, '').trim().slice(0, 12);
    if (!rosterNames.has(name) || !dates.has(date) || !shiftCode || !/^[A-Za-z0-9\u4e00-\u9fff]+$/u.test(shiftCode)) return null;
    const score = Number(item?.score);
    return { date, name, shiftCode, ...(item.linkedOvernight&&shiftCode==='M'?{linkedOvernight:true,targetRoomCode:generated.roomCode==='youxuan'?'guanqi':generated.roomCode==='wangou'?'brand_selection':item.targetRoomCode}:{}), score: Number.isFinite(score) ? score : 0, rest: shiftCode === '休' || item?.rest === true, shiftTime: generated.customShiftTimes?.[shiftCode] || SHIFT_TIMES[shiftCode] || (shiftCode === '休' ? '休息' : '时间待配置') };
  }).filter(Boolean);
  if (!assignments.length) throw Object.assign(new Error('排班草稿没有可保存的人员班次。'), { status: 422 });
  if(new Set(assignments.map(item=>item.date+'|'+item.name)).size!==assignments.length)throw Object.assign(new Error('同一人员同一天不能安排多个班次。'),{status:422});
  return { ...generated, restBackups:input.restBackups||{}, assignments, attendance: summarizeAttendance(generated.roster, assignments), resourceAverages: summarizeResourceAverages(generated.dates, assignments), anchorResourceSummary: summarizeAnchorResources(generated.roster, assignments), updatedAt: new Date().toISOString() };
}

function headerDateKey(value, yearHint) {
  const text = flattenCell(value).replace(/[年月.]/gu, '/').replace(/日/gu, '').trim();
  let match = text.match(/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/u);
  if (!match) {
    match = text.match(/(?:^|\D)(\d{1,2})[\/-](\d{1,2})(?:\D|$)/u);
    if (!match) return '';
    return `${yearHint}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
  }
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

function isMakeupPersonName(value) {
  const name = flattenCell(value).replace(/\s+/gu, ' ').trim();
  return /^[\p{Script=Han}·]{2,12}$/u.test(name)
    && !/姓名|化妆师|妆造|排班|休息|年假|病假|事假|调休|星期/u.test(name);
}

function parseMakeupScheduleRows(rows, date, now = new Date()) {
  const safeDate = normalizeDate(date); const yearHint = safeDate.slice(0, 4);
  let dateColumn = -1; let headerRow = -1;
  rows.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
    if (headerDateKey(cell, yearHint) === safeDate && dateColumn < 0) { dateColumn = columnIndex; headerRow = rowIndex; }
  }));
  if (dateColumn < 0) return { dateColumn, headerRow, roster: [], people: [] };
  const activeRows = [];
  for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || []; const name = flattenCell(row[0]).replace(/\s+/gu, ' ').trim();
    if (!name && !activeRows.length) continue;
    if (!isMakeupPersonName(name)) { if (activeRows.length) break; continue; }
    activeRows.push(row);
  }
  const isToday = safeDate === localDateKey(now);
  const people = activeRows.map((row) => {
    const name = flattenCell(row[0]).replace(/\s+/gu, ' ').trim(); const shiftCode = flattenCell(row[dateColumn]).replace(/\s+/gu, '').trim();
    if (!shiftCode || /休|假|培训/u.test(shiftCode)) return null; const parsedShift = shiftFromCell(shiftCode);
    return { name, roomName: '', shiftCode, range: parsedShift.range, onDuty: Boolean(isToday && parsedShift.range && isOnShift(parsedShift.range, now)) };
  }).filter(Boolean);
  return { dateColumn, headerRow, roster: activeRows.map((row) => flattenCell(row[0]).replace(/\s+/gu, ' ').trim()), people };
}

function buildPlanningImportPlan(draft, rows, revision = 0, target = { spreadsheetToken: TOTAL_SCHEDULE_SPREADSHEET_TOKEN, sheetId: TOTAL_SCHEDULE_SHEET_ID, label: '直播中心排班总表' }) {
  const dates = new Set(draft.dates || []); const yearHint = String(draft.startDate || '').slice(0, 4);
  let headerRow = -1; let headerMap = new Map();
  rows.forEach((row, rowIndex) => {
    const candidate = new Map();
    row.forEach((cell, columnIndex) => { const key = headerDateKey(cell, yearHint); if (dates.has(key)) candidate.set(key, columnIndex); });
    if (candidate.size > headerMap.size) { headerRow = rowIndex; headerMap = candidate; }
  });
  const nameRows = new Map();
  rows.forEach((row, rowIndex) => row.slice(0, 5).forEach((cell) => { const name = flattenCell(cell).replace(/\s+/gu, '').trim(); if (name && !nameRows.has(name)) nameRows.set(name, rowIndex); }));
  const targets = new Map(); const unresolved = [];
  for (const item of draft.assignments || []) {
    const name = String(item.name || '').replace(/\s+/gu, '').trim(); const rowIndex = nameRows.get(name); const columnIndex = headerMap.get(item.date);
    if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) { unresolved.push({ date: item.date, name: item.name, reason: !Number.isInteger(rowIndex) ? '总表未找到姓名' : '总表未找到日期列' }); continue; }
    const key = String(rowIndex); if (!targets.has(key)) targets.set(key, new Map()); targets.get(key).set(columnIndex, formatShiftCell(item));
  }
  const ranges = [...targets.entries()].map(([rowKey, cells]) => {
    const rowIndex = Number(rowKey); const columns = [...cells.keys()].sort((a, b) => a - b); const startColumn = columns[0]; const endColumn = columns.at(-1);
    const before = Array.from({ length: endColumn - startColumn + 1 }, (_, offset) => flattenCell(rows[rowIndex]?.[startColumn + offset])); const after = [...before];
    columns.forEach((columnIndex) => { after[columnIndex - startColumn] = cells.get(columnIndex); });
    return { range: `${target.sheetId}!${columnName(startColumn)}${rowIndex + 1}:${columnName(endColumn)}${rowIndex + 1}`, before, after, row: rowIndex + 1 };
  });
  const overwrites = ranges.flatMap((range) => range.before.map((value, index) => value && value !== range.after[index] ? ({ range: range.range, before: value, after: range.after[index] }) : null).filter(Boolean));
  const fingerprint = { roomCode: draft.roomCode, role: draft.role, startDate: draft.startDate, endDate: draft.endDate, headerRow, revision, ranges: ranges.map(({ range, before }) => ({ range, before })) };
  return { target, roomCode: draft.roomCode, roomName: draft.roomName, role: draft.role, startDate: draft.startDate, endDate: draft.endDate, headerRow: headerRow + 1, assignmentCount: (draft.assignments || []).length, resolvedCount: (draft.assignments || []).length - unresolved.length, ranges, unresolved, overwrites, revision: Number(revision || 0), expectedHash: hashValue({ ...fingerprint, target }) };
}

async function previewPlanningImport(draft) {
  const target = await resolveTotalScheduleTarget();
  const source = await readSpreadsheetRange(target.spreadsheetToken, `${target.sheetId}!A1:AZ120`);
  return { plan: buildPlanningImportPlan(draft, source.rows, source.revision, target), source };
}

async function writePlanningRanges(token, spreadsheetToken, ranges) {
  if (RECOVERY_READ_ONLY) throw Object.assign(new Error(RECOVERY_MESSAGE), {status:423,code:'recovery_read_only'});
  const response = await fetch(`${FEISHU_API}/sheets/v2/spreadsheets/${spreadsheetToken}/values_batch_update`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ valueRanges: ranges.map((item) => ({ range: item.range, values: item.values || [item.after] })) }), signal: AbortSignal.timeout(30_000) });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) throw Object.assign(new Error(`排班总表写入失败：${payload.msg || response.status}`), { status: 502 });
  return payload.data || {};
}

async function commitPlanningImport(input, auth) {
  if (input?.confirm !== true || !input?.expectedHash) throw Object.assign(new Error('请先预览并确认导入。'), { status: 409 });
  const draft = normalizePlanningDraft(input.draft || {}); const { plan, source } = await previewPlanningImport(draft);
  if (plan.expectedHash !== input.expectedHash) throw Object.assign(new Error('排班总表在预览后发生变化，请重新预览。'), { status: 409, code: 'TOTAL_SCHEDULE_CHANGED', plan });
  if (plan.unresolved.length) throw Object.assign(new Error(`有 ${plan.unresolved.length} 条排班未匹配到总表姓名或日期，已阻断导入。`), { status: 409, code: 'UNRESOLVED_ASSIGNMENTS', plan });
  if (plan.overwrites.length && input.allowOverwrite !== true) throw Object.assign(new Error('目标日期已有排班，需明确同意覆盖后才能导入。'), { status: 409, code: 'OVERWRITE_REQUIRED', plan });
  if (!plan.ranges.length) throw Object.assign(new Error('没有可写入的排班范围。'), { status: 422 });
  const result = await writePlanningRanges(source.token, plan.target.spreadsheetToken, plan.ranges); const readbacks = [];
  for (const item of plan.ranges) {
    const checked = await readSpreadsheetRange(plan.target.spreadsheetToken, item.range); const values = checked.rows[0] || [];
    if (values.length !== item.after.length || values.some((value, index) => value !== item.after[index])) throw Object.assign(new Error(`飞书回读与目标不一致：${item.range}`), { status: 502 });
    readbacks.push({ range: item.range, values });
  }
  const audit = { id: randomUUID(), at: new Date().toISOString(), action: 'planning-import', actor: actorFromAuth(auth), roomCode: plan.roomCode, roomName: plan.roomName, role: plan.role, startDate: plan.startDate, endDate: plan.endDate, ranges: plan.ranges.map((item) => item.range), assignmentCount: plan.assignmentCount, overwrites: plan.overwrites.length, resultRevision: Number(result.revision || result.updatedRevision || 0), readbackVerified: true };
  await appendAudit(audit);
  return { ok: true, plan, auditId: audit.id, readbacks, readbackVerified: true };
}

async function resolveWikiSpreadsheetToken(wikiToken, overrideToken = '', label = '飞书表格') {
  if (sourceSnapshot) return sourceSnapshot.resolveWiki(wikiToken, overrideToken);
  if (overrideToken) return overrideToken;
  const cached = resolvedWikiSheets.get(wikiToken); if (cached?.expiresAt > Date.now()) return cached.token;
  const token = await getTenantToken(); const response = await fetch(`${FEISHU_API}/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiToken)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }); const payload = await response.json();
  const spreadsheetToken = payload.data?.node?.obj_token || payload.data?.node?.objToken || '';
  if (!response.ok || payload.code !== 0 || !spreadsheetToken) throw Object.assign(new Error(`${label} Wiki 解析失败：${payload.msg || response.status}`), { status: response.status === 403 ? 403 : 502 });
  resolvedWikiSheets.set(wikiToken, { token: spreadsheetToken, expiresAt: Date.now() + WIKI_RESOLUTION_TTL_MS }); return spreadsheetToken;
}

async function resolveSpreadsheetSheetId(spreadsheetToken, preferredSheetId = '', label = '飞书表格') {
  if (sourceSnapshot) return sourceSnapshot.resolveSheet(spreadsheetToken, preferredSheetId);
  const cacheKey = `${spreadsheetToken}:${preferredSheetId}`;
  const cached = resolvedSpreadsheetSheets.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.sheetId;
  const token = await getTenantToken();
  const response = await fetch(`${FEISHU_API}/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw Object.assign(new Error(`${label}工作表读取失败：${payload.msg || response.status}`), { status: response.status === 403 ? 403 : 502 });
  }
  const sheets = Array.isArray(payload.data?.sheets) ? payload.data.sheets : [];
  const normalized = sheets.map((sheet) => ({
    id: String(sheet.sheet_id || sheet.sheetId || ''),
    title: String(sheet.title || '').trim(),
  })).filter((sheet) => sheet.id);
  const selected = normalized.find((sheet) => preferredSheetId && sheet.id === preferredSheetId)
    || normalized.find((sheet) => /排班|9月|09月|202609/u.test(sheet.title))
    || normalized[0];
  if (!selected) throw Object.assign(new Error(`${label}中未找到可读取的工作表。`), { status: 422 });
  resolvedSpreadsheetSheets.set(cacheKey, { sheetId: selected.id, expiresAt: Date.now() + WIKI_RESOLUTION_TTL_MS });
  return selected.id;
}

async function resolveTotalScheduleTarget() {
  const spreadsheetToken = await resolveWikiSpreadsheetToken(REST_SOURCE_WIKI_TOKEN, TOTAL_SCHEDULE_SPREADSHEET_TOKEN, '品牌营销部直播中心排班表');
  return {
    spreadsheetToken,
    sheetId: await resolveSpreadsheetSheetId(spreadsheetToken, TOTAL_SCHEDULE_SHEET_ID, '品牌营销部直播中心排班表'),
    label: '品牌营销部-直播中心排班表_20260901_20260930 （coco）',
    wikiToken: REST_SOURCE_WIKI_TOKEN,
  };
}

async function readMakeupSchedule(date) {
  const safeDate = normalizeDate(date); const sourceMeta = { label: '化妆师排班（Coco）', wikiToken: MAKEUP_SOURCE_WIKI_TOKEN, sheetId: MAKEUP_SHEET_ID, permissionStatus: '正在解析已授权 Wiki' };
  let spreadsheetToken; let source;
  try { spreadsheetToken = await resolveWikiSpreadsheetToken(MAKEUP_SOURCE_WIKI_TOKEN, MAKEUP_SPREADSHEET_TOKEN, '化妆师排班'); source = await readSpreadsheetRange(spreadsheetToken, `${MAKEUP_SHEET_ID}!A1:ZZ220`); }
  catch (error) { return { date: safeDate, available: false, roster: [], people: [], reason: `化妆师排班源读取失败：${error.message}`, checkedAt: new Date().toISOString(), source: { ...sourceMeta, permissionStatus: error?.status === 403 ? '待授权' : '待回传' } }; }
  const parsed = parseMakeupScheduleRows(source.rows, safeDate);
  if (parsed.dateColumn < 0) return { date: safeDate, available: false, roster: [], people: [], reason: sourceSnapshot ? '已读取化妆师排班源，但源表未覆盖当前日期。' : '已读取化妆师排班源，但源表未覆盖当前日期；可继续使用月度化妆师排班接口。', checkedAt: new Date().toISOString(), source: { ...sourceMeta, spreadsheetToken, revision: source.revision, ...(source.source||{}), permissionStatus: sourceSnapshot ? '只读来源备份 · 日期未覆盖' : '已读取 · 日期未覆盖' } };
  return { date: safeDate, available: true, roster: parsed.roster, people: parsed.people, checkedAt: new Date().toISOString(), source: { ...sourceMeta, spreadsheetToken, permissionStatus: '已读取', revision: source.revision, ...(source.source||{}) } };
}

function buildMakeupImportPlan(draft, rows, revision = 0, target = { spreadsheetToken: MAKEUP_SPREADSHEET_TOKEN, sheetId: MAKEUP_SHEET_ID, label: '化妆师排班' }) {
  const dates = new Set(draft.dates || []); const yearHint = draft.month.slice(0, 4);
  let headerRow = -1; let headerMap = new Map();
  rows.forEach((row, rowIndex) => {
    const candidate = new Map();
    row.forEach((cell, columnIndex) => { const date = headerDateKey(cell, yearHint); if (dates.has(date)) candidate.set(date, columnIndex); });
    if (candidate.size > headerMap.size) { headerRow = rowIndex; headerMap = candidate; }
  });
  const assignmentMap = new Map((draft.assignments || []).map((item) => [`${item.name}|${item.date}`, formatShiftCell(item)]));
  const ranges = []; const unresolved = []; let mode = 'append';
  if (headerRow >= 0 && headerMap.size) {
    mode = 'update';
    const missingDates = (draft.dates || []).filter((date) => !headerMap.has(date));
    missingDates.forEach((date) => unresolved.push({ date, name: '', reason: '化妆师表未找到日期列' }));
    const nameRows = new Map(); let started = false;
    for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
      const name = flattenCell(rows[rowIndex]?.[0]).replace(/\s+/gu, ' ').trim();
      if (!name && !started) continue;
      if (!isMakeupPersonName(name)) { if (started) break; continue; }
      started = true; nameRows.set(name.replace(/\s+/gu, ''), rowIndex);
    }
    for (const person of draft.roster || []) {
      const rowIndex = nameRows.get(String(person.name || '').replace(/\s+/gu, ''));
      if (!Number.isInteger(rowIndex)) { unresolved.push({ date: draft.month, name: person.name, reason: '化妆师表本月区块未找到姓名' }); continue; }
      if (missingDates.length) continue;
      const columns = (draft.dates || []).map((date) => headerMap.get(date)); const startColumn = Math.min(...columns); const endColumn = Math.max(...columns);
      const before = Array.from({ length: endColumn - startColumn + 1 }, (_, offset) => flattenCell(rows[rowIndex]?.[startColumn + offset])); const after = [...before];
      (draft.dates || []).forEach((date) => { after[headerMap.get(date) - startColumn] = assignmentMap.get(`${person.name}|${date}`) || ''; });
      ranges.push({ range: `${target.sheetId}!${columnName(startColumn)}${rowIndex + 1}:${columnName(endColumn)}${rowIndex + 1}`, before, after, row: rowIndex + 1 });
    }
  } else {
    const lastNonEmptyRow = rows.reduce((last, row, index) => row.some((cell) => flattenCell(cell)) ? index : last, -1);
    const startRow = Math.max(1, lastNonEmptyRow + 3); const monthNumber = Number(draft.month.slice(5, 7));
    const values = [
      ['化妆师', ...(draft.dates || []).map((date) => `${Number(date.slice(0, 4))}/${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`)],
      ['星期', ...(draft.dates || []).map((date) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(new Date(`${date}T12:00:00+08:00`)))],
      ...(draft.roster || []).map((person) => [person.name, ...(draft.dates || []).map((date) => assignmentMap.get(`${person.name}|${date}`) || '')]),
    ];
    const endColumn = (draft.dates || []).length; const endRow = startRow + values.length - 1;
    ranges.push({ range: `${target.sheetId}!A${startRow}:${columnName(endColumn)}${endRow}`, values, before: [], after: values.flat(), row: startRow, monthLabel: `${monthNumber}月` });
  }
  const overwrites = mode === 'update' ? ranges.flatMap((range) => range.before.map((value, index) => value && value !== range.after[index] ? ({ range: range.range, before: value, after: range.after[index] }) : null).filter(Boolean)) : [];
  const fingerprint = { target, month: draft.month, revision: Number(revision || 0), mode, ranges: ranges.map((item) => ({ range: item.range, before: item.before, values: item.values })) };
  return { target, month: draft.month, mode, assignmentCount: (draft.assignments || []).length, resolvedCount: (draft.assignments || []).length - unresolved.length, ranges, unresolved, overwrites, revision: Number(revision || 0), expectedHash: hashValue(fingerprint) };
}

async function previewMakeupImport(draft) {
  const spreadsheetToken = await resolveWikiSpreadsheetToken(MAKEUP_SOURCE_WIKI_TOKEN, MAKEUP_SPREADSHEET_TOKEN, '化妆师排班');
  const target = { spreadsheetToken, sheetId: MAKEUP_SHEET_ID, label: '化妆师排班', wikiToken: MAKEUP_SOURCE_WIKI_TOKEN };
  const source = await readSpreadsheetRange(spreadsheetToken, `${MAKEUP_SHEET_ID}!A1:ZZ220`);
  return { plan: buildMakeupImportPlan(draft, source.rows, source.revision, target), source };
}

function matrixMatches(actualRows, expectedRows) {
  return expectedRows.every((expected, rowIndex) => expected.every((value, columnIndex) => flattenCell(actualRows[rowIndex]?.[columnIndex]) === flattenCell(value)));
}

async function commitMakeupImport(input, auth) {
  if (input?.confirm !== true || !input?.expectedHash) throw Object.assign(new Error('请先预览并确认导入化妆师排班。'), { status: 409 });
  const draft = generateMakeupDraft(input.draft || {}); const { plan, source } = await previewMakeupImport(draft);
  if (plan.expectedHash !== input.expectedHash) throw Object.assign(new Error('化妆师排班表在预览后发生变化，请重新预览。'), { status: 409, code: 'MAKEUP_SCHEDULE_CHANGED', plan });
  if (plan.unresolved.length) throw Object.assign(new Error(`有 ${plan.unresolved.length} 项未匹配，已阻断导入。`), { status: 409, code: 'UNRESOLVED_MAKEUP_ASSIGNMENTS', plan });
  if (plan.overwrites.length && input.allowOverwrite !== true) throw Object.assign(new Error('目标月份已有排班，需明确同意覆盖后才能导入。'), { status: 409, code: 'OVERWRITE_REQUIRED', plan });
  if (!plan.ranges.length) throw Object.assign(new Error('没有可写入的化妆师排班范围。'), { status: 422 });
  const result = await writePlanningRanges(source.token, plan.target.spreadsheetToken, plan.ranges); const readbacks = [];
  for (const item of plan.ranges) {
    const expectedRows = item.values || [item.after]; const checked = await readSpreadsheetRange(plan.target.spreadsheetToken, item.range);
    if (!matrixMatches(checked.rows, expectedRows)) throw Object.assign(new Error(`化妆师排班飞书回读与目标不一致：${item.range}`), { status: 502 });
    readbacks.push({ range: item.range, rows: expectedRows.length });
  }
  const audit = { id: randomUUID(), at: new Date().toISOString(), action: 'makeup-planning-import', actor: actorFromAuth(auth), month: plan.month, mode: plan.mode, ranges: plan.ranges.map((item) => item.range), assignmentCount: plan.assignmentCount, overwrites: plan.overwrites.length, resultRevision: Number(result.revision || result.updatedRevision || 0), readbackVerified: true };
  await appendAudit(audit);
  return { ok: true, plan, auditId: audit.id, readbacks, readbackVerified: true };
}

function normalizeRestProfile(input, existing = {}) {
  const name = normalizeName(input?.name || existing?.name);
  if (!name) throw Object.assign(new Error('主播姓名不能为空。'), { status: 422 });
  const roomName = ['官旗', '品牌精选', '优选', '王鸥美肤'].includes(input?.roomName) ? input.roomName : existing.roomName || '';
  return { name, roomName, compNote: String(input?.compNote ?? existing.compNote ?? '').replace(/[<>\r\n\t]/gu, ' ').trim().slice(0, 300), updatedAt: new Date().toISOString() };
}

function normalizeRestSetting(input, existing = {}) {
  const month = /^20\d{2}-\d{2}$/u.test(String(input?.month || '')) ? String(input.month) : String(existing.month || '');
  if (!month) throw Object.assign(new Error('月份格式应为 YYYY-MM。'), { status: 422 });
  const raw = Number(input?.entitlement);
  if (!Number.isInteger(raw) || raw < 0 || raw > 31) throw Object.assign(new Error('月应休应为 0—31 的整数。'), { status: 422 });
  return { month, entitlement: raw, updatedAt: new Date().toISOString() };
}

function previousMonth(month) {
  const [year, value] = month.split('-').map(Number); const date = new Date(Date.UTC(year, value - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function readRestBoard(month, store) {
  const safeMonth = /^20\d{2}-\d{2}$/u.test(String(month || '')) ? String(month) : localDateKey().slice(0, 7);
  if (sourceSnapshot && !REST_SCHEDULE_SOURCES[safeMonth]) return {available:false,month:safeMonth,entitlement:null,people:[],historyStatus:'pending_recovery',source:{mode:'verified_backup',permissionStatus:'月份未备份'},reason:'该月份不在已核验的原表备份中，不能使用其他月份补齐。'};
  const selectedSource = safeMonth === localDateKey().slice(0, 7) ? null : REST_SCHEDULE_SOURCES[safeMonth];
  let sourceMeta = selectedSource ? { ...selectedSource } : { label: '品牌营销部-直播中心排班表', wikiToken: REST_SOURCE_WIKI_TOKEN, spreadsheetToken: '', sheetId: TOTAL_SCHEDULE_SHEET_ID };
  try {
    if (!sourceMeta.spreadsheetToken) sourceMeta = { ...sourceMeta, ...(await resolveTotalScheduleTarget()) };
    const readSources = [];
    const currentValue = await readSpreadsheetRange(sourceMeta.spreadsheetToken, `${sourceMeta.sheetId}!A1:AZ220`);
    readSources.push({ month: safeMonth, rows: currentValue.rows, revision: currentValue.revision, ...sourceMeta });
    const priorMonth = previousMonth(safeMonth); const priorSource = REST_SCHEDULE_SOURCES[priorMonth];
    if (priorSource) {
      try {
        const priorValue = await readSpreadsheetRange(priorSource.spreadsheetToken, `${priorSource.sheetId}!A1:AZ220`);
        readSources.unshift({ month: priorMonth, rows: priorValue.rows, revision: priorValue.revision, ...priorSource });
      } catch {
        // 上月来源仅用于识别跨月连班；无权限时仍应保留本月真实排班结果。
      }
    }
    const entitlement = store?.restSettings?.[safeMonth]?.entitlement ?? null;
    const profiles = Object.fromEntries(Object.entries(store?.restProfiles || {}).map(([name, profile]) => [name, { ...profile, entitlement }]));
    const people = parseRestSources(readSources, safeMonth, profiles);
    if (sourceSnapshot && !store) for (const person of people) person.roomName='直播间待核验';
    const currentRevision = readSources.find((source) => source.month === safeMonth)?.revision || 0;
    return { available: true, month: safeMonth, entitlement, people, source: { ...sourceMeta, revision: currentRevision, permissionStatus: '已读取', crossMonth: readSources.length > 1, ...(currentValue.source||{}), ...(sourceSnapshot ? {scopeNote:'仅统计原解析器已识别主播，不代表原表全部人员；未匹配人员请查看原表。'} : {}) }, checkedAt: new Date().toISOString(), historyStatus: sourceSnapshot && !store ? 'pending_recovery' : undefined, reason: people.length ? (sourceSnapshot && !store ? '原表只读备份；手工月应休、补班说明尚待恢复，剩余休假不作推断。' : '') : '当前月份没有匹配到已排班主播；空白单元格不会被计算为休息或上班。' };
  } catch (error) {
    return { available: false, month: safeMonth, entitlement: store?.restSettings?.[safeMonth]?.entitlement ?? null, people: [], source: { ...sourceMeta, permissionStatus: error?.status === 403 ? '待授权' : '待回传' }, checkedAt: new Date().toISOString(), reason: `主播休息板块暂不可读取：${error.message}` };
  }
}

let planningMutationQueue = Promise.resolve();
async function serializePlanningMutation(operation) {
  const previous=planningMutationQueue;let release;
  planningMutationQueue=new Promise(resolve=>{release=resolve});
  await previous;try{return await operation()}finally{release()}
}
async function planningApi(request, response, requestUrl, auth) {
  try {
    const route = requestUrl.pathname;
    if (request.method === 'GET' && route === '/api/planning') {
      const store = await readPlanningStore();
      let target;
      try {
        target = { ...(await resolveTotalScheduleTarget()), permissionStatus: '已连接' };
      } catch (error) {
        target = {
          label: '品牌营销部-直播中心排班表_20260901_20260930 （coco）',
          wikiToken: REST_SOURCE_WIKI_TOKEN,
          permissionStatus: error?.status === 403 ? '待授权' : '待回传',
          reason: userFacingErrorMessage(error, '排班表暂不可读取。'),
        };
      }
      return json(response, { ok: true, rooms: ROOM_PLANNING, shiftTimes: SHIFT_TIMES, drafts: store.drafts || {}, makeupDrafts: store.makeupDrafts || {}, updatedAt: store.updatedAt || null, totalSchedule: { ...target, url: TOTAL_SCHEDULE_WIKI_URL } });
    }
    if (request.method === 'POST' && route === '/api/planning/generate') { validateWriteOrigin(request, auth); return json(response, { ok: true, draft: generateDraft(await readJsonBody(request)) }); }
    if (request.method === 'POST' && route === '/api/planning/draft') {
      validateWriteOrigin(request, auth); const draft = normalizePlanningDraft(await readJsonBody(request)); const store = await readPlanningStore(); const key = planningDraftKey(draft); const actor = actorFromAuth(auth); const saved = { ...draft, key, updatedAt: new Date().toISOString(), updatedBy: actor.name };
      const linked=linkOvernightDrafts(saved,{...(store.drafts||{}),[key]:saved});
      await writePlanningStore({ ...store, schemaVersion: 3, drafts:linked.drafts, updatedAt:saved.updatedAt }); return json(response, { ok:true, draft:linked.drafts[key], drafts:linked.drafts, linkedKeys:linked.linkedKeys });
    }
    if(request.method==='POST'&&route==='/api/planning/sync-rest'){validateWriteOrigin(request,auth);const input=await readJsonBody(request);return json(response,{ok:true,...syncDraftRestDays(normalizePlanningDraft(input.draft),input.roster||[])})}
    if (request.method === 'GET' && route === '/api/planning/rest') {
      let store;
      try { store = await readPlanningStore(); } catch(error) {
        if (!sourceSnapshot || error.code !== 'history_recovery_pending') throw error;
        store = null; // Missing manual history is exposed, never replaced by an empty persisted store.
      }
      return json(response, { ok: true, data: await readRestBoard(requestUrl.searchParams.get('month'), store) });
    }
    if (request.method === 'POST' && route === '/api/planning/rest-setting') {
      validateWriteOrigin(request, auth); const body = await readJsonBody(request); const store = await readPlanningStore(); const current = store?.restSettings?.[String(body?.month || '')] || {};
      const setting = normalizeRestSetting(body, current); const actor = actorFromAuth(auth); const saved = { ...setting, updatedBy: actor.name };
      await writePlanningStore({ ...store, schemaVersion: 3, restSettings: { ...(store.restSettings || {}), [saved.month]: saved }, updatedAt: saved.updatedAt }); return json(response, { ok: true, setting: saved });
    }
    if (request.method === 'POST' && route === '/api/planning/rest-profile') {
      validateWriteOrigin(request, auth); const body = await readJsonBody(request); const store = await readPlanningStore(); const current = store?.restProfiles?.[String(body?.name || '').trim()] || {};
      const profile = normalizeRestProfile(body, current); const actor = actorFromAuth(auth); const saved = { ...profile, updatedBy: actor.name };
      await writePlanningStore({ ...store, schemaVersion: 3, restProfiles: { ...(store.restProfiles || {}), [saved.name]: saved }, updatedAt: saved.updatedAt }); return json(response, { ok: true, profile: saved });
    }
    if (request.method === 'GET' && route === '/api/planning/makeup') return json(response, { ok: true, data: await readMakeupSchedule(requestUrl.searchParams.get('date')) });
    if (request.method === 'POST' && route === '/api/planning/makeup/generate') { validateWriteOrigin(request, auth); return json(response, { ok: true, draft: generateMakeupDraft(await readJsonBody(request)) }); }
    if (request.method === 'POST' && route === '/api/planning/makeup/draft') {
      validateWriteOrigin(request, auth); const draft = generateMakeupDraft(await readJsonBody(request)); const store = await readPlanningStore(); const actor = actorFromAuth(auth); const saved = { ...draft, updatedBy: actor.name, updatedAt: new Date().toISOString() };
      await writePlanningStore({ ...store, schemaVersion: 3, makeupDrafts: { ...(store.makeupDrafts || {}), [saved.month]: saved }, updatedAt: saved.updatedAt }); return json(response, { ok: true, draft: saved });
    }
    if (request.method === 'POST' && route === '/api/planning/makeup/import/preview') { validateWriteOrigin(request, auth); const draft = generateMakeupDraft((await readJsonBody(request)).draft || {}); const { plan } = await previewMakeupImport(draft); return json(response, { ok: true, plan }); }
    if (request.method === 'POST' && route === '/api/planning/makeup/import') { validateWriteOrigin(request, auth); return json(response, await commitMakeupImport(await readJsonBody(request), auth)); }
    if (request.method === 'POST' && route === '/api/planning/import/preview') { validateWriteOrigin(request, auth); const draft = normalizePlanningDraft((await readJsonBody(request)).draft || {}); const { plan } = await previewPlanningImport(draft); return json(response, { ok: true, plan }); }
    if (request.method === 'POST' && route === '/api/planning/import') { validateWriteOrigin(request, auth); return json(response, await commitPlanningImport(await readJsonBody(request), auth)); }
    return json(response, { error: 'Not found' }, 404);
  } catch (error) { return errorResponse(response, error, '排班工作台请求失败。'); }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求内容过大。'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('请求内容不是有效 JSON。'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function validateWriteOrigin(request, auth) {
  if (auth.mode === 'internal') return;
  if (request.headers['x-requested-with'] !== 'XMLHttpRequest') {
    throw Object.assign(new Error('缺少写回请求标识。'), { status: 403 });
  }
  const origin = request.headers.origin;
  if (origin && origin !== 'https://app.fandow.top') {
    throw Object.assign(new Error('拒绝跨站写回请求。'), { status: 403 });
  }
}

async function previewWriteback(input) {
  const room = ROOMS.find((item) => item.code === input.roomCode);
  if (!room) throw Object.assign(new Error('未找到对应直播间。'), { status: 404 });
  const source = await readRoomFresh(room);
  return { plan: buildWritebackPlan(room, source.rows, input, source.revision), source };
}

async function commitWriteback(input, auth) {
  if (input.confirm !== true || !input.expectedHash) {
    throw Object.assign(new Error('请先预览并确认本次写回。'), { status: 409 });
  }
  const { plan, source } = await previewWriteback(input);
  if (plan.expectedHash !== input.expectedHash) {
    throw Object.assign(new Error('班表在预览后发生变化，请重新预览。'), {
      status: 409, code: 'SCHEDULE_CHANGED', plan,
    });
  }
  if (plan.overwrites.length && input.allowOverwrite !== true) {
    throw Object.assign(new Error('目标时间段已有排班，需明确勾选覆盖后才能写回。'), {
      status: 409, code: 'OVERWRITE_REQUIRED', plan,
    });
  }
  const verifyWrite = auth.mode === 'internal' && input.verifyWrite === true;
  let writeResult = null;
  if (!plan.noChange || verifyWrite) writeResult = await writeFeishuRange(source.token, plan);
  const readback = await readExactRange(source.token, plan.range);
  if (readback.length !== plan.after.length || readback.some((value, index) => value !== plan.after[index])) {
    throw Object.assign(new Error('飞书写入后的回读结果与目标值不一致，请人工核验。'), { status: 502 });
  }
  scheduleSourceCache = { expiresAt: 0, sheets: null };
  scheduleCache.delete(plan.date);
  const audit = {
    id: randomUUID(), at: new Date().toISOString(),
    action: plan.noChange ? (verifyWrite ? 'verify-write' : 'no-change') : plan.action==='remove'?'remove':'writeback',
    actor: actorFromAuth(auth),
    date: plan.date, roomCode: plan.roomCode, roomName: plan.roomName,
    role: plan.role, range: plan.range, start: plan.start, end: plan.end,
    before: plan.before, after: plan.after,
    sourceRevision: plan.revision,
    resultRevision: Number(writeResult?.revision || writeResult?.updatedRevision || 0),
    readbackVerified: true,
  };
  await appendAudit(audit);
  return { ok: true, plan, auditId: audit.id, readback, readbackVerified: true };
}

async function getSchedule(date) {
  const safeDate = normalizeDate(date);
  const sheets = await readScheduleSheets();
  const parsed = parseScheduleSheets(sheets, safeDate);
  const writeback = Object.fromEntries(ROOMS.map((room) => [room.code, {
    revision: sheetRevision(sheets[room.code]),
    roles: roleMetadata(room, sheetRows(sheets[room.code]), safeDate),
  }]));
  return {
    date: safeDate, rooms: parsed.rooms,
    availability: {...availabilityFromRoster(parsed.roster, parsed.rooms, safeDate), sourceKind:'schedule', attendanceVerified:false, coverageComplete: Object.values(parsed.sourceStatus).every(item=>item.found===true)},
    sourceStatus: parsed.sourceStatus, writeback: sourceSnapshot ? {} : writeback,
    updatedAt: sheets[ROOMS[0].code].source?.readAt || null,
    ...(sourceSnapshot ? {source:sheets[ROOMS[0].code].source,recovery:recoveryPayload()} : {}),
  };
}

async function refreshSchedule(date) {
  const schedule = await getSchedule(date);
  scheduleCache.set(date, schedule);
  return schedule;
}

async function refreshCachedSchedules() {
  const dates = scheduleCache.size ? [...scheduleCache.keys()] : [localDateKey()];
  const results = await Promise.allSettled(dates.map((date) => refreshSchedule(date)));
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length) console.error(`班表刷新失败：${failed.length} 个日期未更新。`);
  else console.log(`班表已刷新：${dates.join(', ')}`);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

async function serveStatic(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname);
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const target = path.resolve(ROOT, `.${requestPath}`);
  if (!target.startsWith(ROOT + path.sep) || !MIME_TYPES[path.extname(target)]) {
    return json(response, { error: 'Not found' }, 404);
  }
  try {
    const content = await fs.readFile(target);
    securityHeaders(response);
    response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(target)], 'Cache-Control': 'no-cache' });
    response.end(path.extname(target)==='.html' ? withRecoveryBanner(content) : content);
  } catch {
    json(response, { error: 'Not found' }, 404);
  }
}

function accessDenied(response, auth) {
  const status = Number(auth.status || 403);
  const title = status === 401 ? '请先从 WIS 品牌营销中枢登录' : '当前账号无权访问调度中心';
  const marketingHubUrl = process.env.HUB_SAME_ORIGIN_EMBED === 'true'
    ? '/yxb/wis-marketing-hub/'
    : 'https://app.fandow.top/fd-026222/wis-marketing-hub/';
  const body = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7f5;color:#18231f;font:15px system-ui,"Noto Sans SC",sans-serif}.card{width:min(440px,calc(100% - 40px));padding:32px;border:1px solid #e1e8e4;border-radius:16px;background:#fff;box-shadow:0 18px 60px rgba(26,69,49,.09)}h1{margin:0 0 12px;font-size:22px}p{color:#69766f;line-height:1.7}a{display:inline-block;margin-top:12px;padding:10px 16px;border-radius:9px;background:#166b4b;color:#fff;text-decoration:none;font-weight:700}</style><main class="card"><h1>${title}</h1><p>登录状态与界面权限由 WIS 品牌营销中枢统一管理。</p><a href="${marketingHubUrl}">返回中枢</a></main></html>`;
  securityHeaders(response);
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(body);
}

function userFacingErrorMessage(error, fallback = '请求处理失败。') {
  const message = String(error?.message || '');
  if (['EACCES', 'EPERM', 'EROFS'].includes(String(error?.code || '')) || /(?:[A-Z]:\\|\/app\/|\/data\/)/iu.test(message)) {
    return '排班草稿存储暂不可用，请检查持久化目录权限后重试；现有飞书排班未被修改。';
  }
  if (Number(error?.status) === 403) return '当前服务账号尚无该排班来源的读取权限，数据标记为待授权。';
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return '排班来源响应超时，请稍后重试；现有数据未被覆盖。';
  return message || fallback;
}

function errorResponse(response, error, fallback = '请求处理失败。') {
  const payload = { error: userFacingErrorMessage(error, fallback) };
  if (error.code) payload.code = error.code;
  if (error.plan) payload.plan = error.plan;
  return json(response, payload, Number(error.status || 502));
}

function startServer() {
  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${HOST}`);
    if (requestUrl.pathname === '/api/health') {
      let storage = null; let storageError = '';
      try { storage = await planningStorageHealth(); } catch (error) { storageError = userFacingErrorMessage(error, '排班存储不可读写。'); }
      let backupReady=false;
      if(sourceSnapshot)try{await sourceSnapshot.load();backupReady=true;}catch(error){storageError=userFacingErrorMessage(error);}
      const healthy = Boolean((sourceSnapshot ? backupReady : FEISHU_APP_ID && FEISHU_APP_SECRET) && storage);
      return json(response, {
        ok: healthy,
        service: 'dispatch-center',
        source: sourceSnapshot ? 'verified_backup' : 'feishu-sheets',
        ...(sourceSnapshot ? {mode:'degraded-read-only',historyStatus:'pending_recovery',realTime:false} : {}),
        writeback: RECOVERY_READ_ONLY ? 'paused_recovery' : 'preview-confirm-readback-audit',
        planning: RECOVERY_READ_ONLY ? 'history_pending_recovery' : 'draft-generate-total-sheet-preview-confirm-readback-audit',
        requiredModule: REQUIRED_MODULE,
        storage,
        storageError,
      }, healthy ? 200 : 503);
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      const auth = await authorize(request);
      if (!auth.ok) return json(response, { error: auth.detail }, auth.status);

      if (RECOVERY_READ_ONLY) {
        if (!['GET','HEAD'].includes(request.method)) return json(response, {ok:false,error:RECOVERY_MESSAGE,code:'recovery_read_only',recovery:recoveryPayload()}, 423);
        if (requestUrl.pathname === '/api/recovery/status') {
          try { return json(response, {ok:true,recovery:recoveryPayload(),sourceSnapshot:sourceSnapshot ? await sourceSnapshot.summary() : null}); }
          catch(error) { return errorResponse(response,error); }
        }
      }

      if (requestUrl.pathname === '/api/session' && request.method === 'GET') {
        return json(response, sessionFromAuth(auth));
      }

      if (requestUrl.pathname === '/api/planning' || requestUrl.pathname.startsWith('/api/planning/')) {
        const storedWrites = new Set(["/api/planning/draft","/api/planning/rest-setting","/api/planning/rest-profile","/api/planning/makeup/draft"]);
        return request.method==="POST"&&storedWrites.has(requestUrl.pathname)
          ? serializePlanningMutation(()=>planningApi(request,response,requestUrl,auth))
          : planningApi(request, response, requestUrl, auth);
      }

      if (requestUrl.pathname === '/api/schedule' && request.method === 'GET') {
        try {
          const safeDate = normalizeDate(requestUrl.searchParams.get('date'));
          const forceRefresh = requestUrl.searchParams.get('refresh') === '1';
          if (forceRefresh) {
            scheduleSourceCache = { expiresAt: 0, sheets: null };
            scheduleCache.delete(safeDate);
          }
          return json(
            response,
            forceRefresh ? await refreshSchedule(safeDate) : (scheduleCache.get(safeDate) || await refreshSchedule(safeDate)),
          );
        } catch (error) {
          return errorResponse(response, error, '读取实时班表失败。');
        }
      }

      if (requestUrl.pathname === '/api/notifications/opening-preview' && request.method === 'GET') {
        try {
          const date = normalizeDate(requestUrl.searchParams.get('date'));
          const schedule = await refreshSchedule(date);
          return json(response, {ok:true, preview:buildOpeningPreview(schedule, {date})});
        } catch (error) {
          return errorResponse(response, error, '生成开播提醒预览失败。');
        }
      }

      if (requestUrl.pathname === '/api/schedule/writeback/preview' && request.method === 'POST') {
        try {
          validateWriteOrigin(request, auth);
          const input = await readJsonBody(request);
          const { plan } = await previewWriteback(input);
          return json(response, { ok: true, plan });
        } catch (error) {
          return errorResponse(response, error, '生成写回预览失败。');
        }
      }

      if (requestUrl.pathname === '/api/schedule/writeback' && request.method === 'POST') {
        try {
          validateWriteOrigin(request, auth);
          return json(response, await commitWriteback(await readJsonBody(request), auth));
        } catch (error) {
          return errorResponse(response, error, '排班写回失败。');
        }
      }

      if (requestUrl.pathname === '/api/schedule/writeback/audit' && request.method === 'GET') {
        try {
          return json(response, { items: await readAudit(requestUrl.searchParams.get('limit')) });
        } catch (error) {
          return errorResponse(response, error, '读取写回审计失败。');
        }
      }
      return json(response, { error: 'Not found' }, 404);
    }
    if (requestUrl.pathname === '/' || requestUrl.pathname.endsWith('.html')) {
      const auth = await authorize(request);
      if (!auth.ok) return accessDenied(response, auth);
    }
    return serveStatic(request, response);
  }).listen(PORT, HOST, () => {
    console.log(`直播中心已启动：http://${HOST}:${PORT}`);
    console.log(FEISHU_APP_ID && FEISHU_APP_SECRET ? '已配置飞书班表读写。' : '请先配置飞书应用凭据。');
    if (!RECOVERY_READ_ONLY) {
      refreshCachedSchedules();
      setInterval(refreshCachedSchedules, HOURLY_REFRESH_MS);
    }
  });
}

if (require.main === module) startServer();

module.exports = {
  ROOMS,
  REST_SCHEDULE_SOURCES,
  TOTAL_SCHEDULE_WIKI_URL,
  buildPlanningImportPlan,
  buildMakeupImportPlan,
  buildWritebackPlan,
  columnName,
  dateMarkerMatches,
  directLocalRequest,
  findDateBlock,
  findDateBlockWithMeta,
  findTimelinePairs,
  getSchedule,
  headerDateKey,
  isOnShift,
  localDateKey,
  longestTimeSlotRun,
  parseRoomSchedule,
  parseMakeupScheduleRows,
  parseScheduleSheets,
  readMakeupSchedule,
  resolveRosterColumns,
  roleMetadata,
  sessionFromAuth,
  shiftFromCell,
  timeRangeFromCell,
};
