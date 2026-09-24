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
const { ROOM_PLANNING, SHIFT_TIMES, VERIFIED_ANCHOR_ROOMS, formatShiftCell, linkOvernightDrafts, syncDraftRestDays, generateDraft, generateMakeupDraft, parseRestSources, summarizeAnchorResources, summarizeAttendance, summarizeResourceAverages } = require('./planning-engine');
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
const TOTAL_SCHEDULE_SHEET_TITLE = process.env.TOTAL_SCHEDULE_SHEET_TITLE || '排班表';
// September 2026 is the business-confirmed schedule workbook supplied for this
// module update. Keep the current target configurable for future monthly books.
const TOTAL_SCHEDULE_WIKI_TOKEN = process.env.TOTAL_SCHEDULE_WIKI_TOKEN || 'UKVDwxpz7iKAv8k5KxTcxiDVnuf';
const SEPTEMBER_TOTAL_SCHEDULE_TOKEN = 'Wj4zs3oDfhGUfetlTXicxblmnHe';
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
const PLANNING_IMPORT_GUARD_PATH = process.env.PLANNING_IMPORT_GUARD_PATH || path.join(DATA_DIR, 'planning-import-guard.json');
const PLANNING_STORE_PATH = process.env.PLANNING_STORE_PATH || path.join(DATA_DIR, 'planning-workbench.json');
const PLANNING_BASELINE_MANIFEST_PATH = process.env.PLANNING_BASELINE_MANIFEST_PATH || path.join(DATA_DIR, 'planning-baseline-manifest.json');
const PLANNING_EPOCH_PATH = process.env.PLANNING_EPOCH_PATH || path.join(DATA_DIR, 'planning-epoch.json');
// A recovered process is never made writable merely by removing the global
// read-only flag. Drafts and the approved formal total sheet have separate
// explicit gates; legacy room and makeup sheets have no new baseline yet.
const PLANNING_DRAFT_WRITES_ENABLED = process.env.PLANNING_DRAFT_WRITES_ENABLED === '1';
const PLANNING_TOTAL_IMPORT_ENABLED = process.env.PLANNING_TOTAL_IMPORT_ENABLED === '1';
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
  if (!RECOVERY_READ_ONLY) await readPlanningEpoch();
  const handle = await fs.open(AUDIT_LOG_PATH, 'r+');
  try {
    const line=`${JSON.stringify(entry)}\n`,{size}=await handle.stat();
    const {bytesWritten}=await handle.write(line,size,'utf8');
    if (bytesWritten!==Buffer.byteLength(line,'utf8')) throw planningEpochError('排班审计记录写入不完整，已停止后续写入。');
    await handle.sync();
  }
  finally { await handle.close(); }
}

async function readAudit(limit = 50) {
  if (!RECOVERY_READ_ONLY) await readPlanningEpoch();
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  try {
    const content = await fs.readFile(AUDIT_LOG_PATH, 'utf8');
    const lines=content.trim().split(/\r?\n/u).filter(Boolean);
    if (RECOVERY_READ_ONLY && JSON.parse(lines[0] || 'null')?.action === 'planning-epoch-initialized') {
      throw Object.assign(new Error('旧排班写回审计仍待恢复；新基线审计不能代替旧历史。'), {status:503,code:'history_recovery_pending'});
    }
    return lines.slice(-safeLimit).reverse().map((line) => JSON.parse(line));
  } catch (error) {
    if (RECOVERY_READ_ONLY) throw Object.assign(new Error('历史排班写回审计记录尚待恢复，暂时无法读取；不能据此判断此前没有发生写回。'), {status:503,code:'history_recovery_pending'});
    if (error.code === 'ENOENT') throw planningEpochError('新排班审计文件已缺失，不能将历史当成空白。');
    throw error;
  }
}

async function readSpreadsheetRange(spreadsheetToken, range, valueRenderOption = 'ToString') {
  if (!['ToString', 'Formula'].includes(valueRenderOption)) throw Object.assign(new Error('不支持的单元格读取模式。'), {status:400});
  if (sourceSnapshot) return sourceSnapshot.range(spreadsheetToken, range);
  const token = await getTenantToken();
  const query = new URLSearchParams({ valueRenderOption, dateTimeRenderOption: 'FormattedString' });
  const response = await fetch(`${FEISHU_API}/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}?${query}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) throw Object.assign(new Error(`飞书表格读取失败：${payload.msg || response.status}`), { status: response.status === 403 ? 403 : 502 });
  return { token, rows: spreadsheetValueRows(payload), actualRange:payload.data.valueRange.range, revision: Number(payload.data?.revision || payload.data?.valueRange?.revision || 0) };
}

function spreadsheetValueRows(payload) {
  const valueRange = payload?.data?.valueRange;
  // Feishu documents valueRange.range="" when the queried range has no data.
  // Only that explicit signal may stand in for an omitted values array; a
  // missing valueRange/range is an unreadable response, never an empty sheet.
  if (!valueRange || typeof valueRange.range !== 'string' ||
      (valueRange.range !== '' && !Array.isArray(valueRange.values)) ||
      (valueRange.values !== undefined && !Array.isArray(valueRange.values)) ||
      (valueRange.range === '' && valueRange.values?.length) ||
      (valueRange.range !== '' && (!valueRange.values.length || valueRange.values.some(row=>!Array.isArray(row))))) {
    throw Object.assign(new Error('飞书表格未返回可核验的单元格数据，已停止读回。'), {status:502,code:'SHEET_READBACK_UNVERIFIED'});
  }
  return (valueRange.values || []).map((row) => row.map(flattenCell));
}

async function readPlanningStore() {
  if (!RECOVERY_READ_ONLY) return (await readPlanningEpoch()).store;
  try {
    const value = JSON.parse(await fs.readFile(PLANNING_STORE_PATH, 'utf8'));
    if (value?.historyStatus === 'pending_recovery' && value?.epochId) throw new Error('New epoch is not recovered historical drafts');
    const record = item => Boolean(item) && typeof item === 'object' && !Array.isArray(item);
    if (!record(value) || !record(value.drafts) || !['makeupDrafts','restProfiles','restSettings'].every(key => !Object.hasOwn(value,key) || record(value[key]))) {
      throw new Error('Invalid historical planning store structure');
    }
    return value && typeof value === 'object' ? value : { schemaVersion: 3, drafts: {}, makeupDrafts: {}, restProfiles: {}, restSettings: {}, updatedAt: null };
  } catch (error) {
    throw Object.assign(new Error('历史排班草稿与休息配置尚待恢复，暂时无法读取；已发布到飞书的原始排班可从当前排班查看。'), {status:503,code:'history_recovery_pending'});
  }
}

async function writePlanningStore(store, auth) {
  assertPlanningManager(auth);
  if (RECOVERY_READ_ONLY) throw Object.assign(new Error(RECOVERY_MESSAGE), {status:423,code:'recovery_read_only'});
  if (sourceSnapshot) throw Object.assign(new Error('当前仅有只读来源快照，不能建立或修改排班草稿。'), {status:423,code:'planning_source_snapshot'});
  if (!PLANNING_DRAFT_WRITES_ENABLED) throw Object.assign(new Error('新基线草稿保存尚未启用。'), {status:423,code:'planning_draft_writes_disabled'});
  const {epoch,store:current} = await readPlanningEpoch();
  if (store?.epochId !== epoch.epochId || store?.baselineHash !== epoch.baselineHash || store?.historyStatus !== 'pending_recovery') throw planningEpochError('新草稿与正式排班基线不一致，已停止保存。');
  if (store.storeRevision !== current.storeRevision) throw Object.assign(new Error('草稿在读取后已发生变化，请重新读取后保存。'), {status:409,code:'PLANNING_STORE_CHANGED'});
  const next = {...store,storeRevision:current.storeRevision + 1};
  const temporary = `${PLANNING_STORE_PATH}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(next), 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temporary, PLANNING_STORE_PATH);
  await syncPlanningDirectory(path.dirname(PLANNING_STORE_PATH));
}

async function planningStorageHealth() {
  if (RECOVERY_READ_ONLY) {
    await fs.access(DATA_DIR, fsConstants.R_OK);
    return {directory:DATA_DIR,store:PLANNING_STORE_PATH,access:'read-only',historyStatus:'pending_recovery'};
  }
  const {epoch} = await readPlanningEpoch();
  await fs.access(DATA_DIR, fsConstants.R_OK | fsConstants.W_OK);
  await Promise.all([PLANNING_STORE_PATH,AUDIT_LOG_PATH,PLANNING_EPOCH_PATH].map(file=>fs.access(file,fsConstants.R_OK | fsConstants.W_OK)));
  return { directory: DATA_DIR, store: PLANNING_STORE_PATH, access: 'read-write', epochId:epoch.epochId, historyStatus:'pending_recovery' };
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

async function readPlanningBaselineManifest(manifestPath = PLANNING_BASELINE_MANIFEST_PATH) {
  let content;
  try { content = await fs.readFile(manifestPath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let value;
  try { value = JSON.parse(content); }
  catch { throw Object.assign(new Error('正式排班新基线清单损坏，来源待核验。'), {status:503,code:'planning_baseline_invalid'}); }
  const checkedAt = value?.checkedAt;
  const valid = value && typeof value === 'object' && !Array.isArray(value) &&
    value.schemaVersion === 1 && value.spreadsheetToken === SEPTEMBER_TOTAL_SCHEDULE_TOKEN &&
    value.sheetId === REST_SCHEDULE_SOURCES['2026-09'].sheetId &&
    Number.isSafeInteger(value.revision) && value.revision > 0 &&
    typeof checkedAt === 'string' && Number.isFinite(Date.parse(checkedAt)) &&
    new Date(checkedAt).toISOString() === checkedAt && Date.parse(checkedAt) <= Date.now() + 300000 &&
    value.historyStatus === 'pending_recovery';
  if (!valid) throw Object.assign(new Error('正式排班新基线清单未通过来源、版本或历史状态核验。'), {status:503,code:'planning_baseline_invalid'});
  // Do not turn source metadata into a history store or return arbitrary keys.
  return {schemaVersion:1,spreadsheetToken:value.spreadsheetToken,sheetId:value.sheetId,
    revision:value.revision,checkedAt,historyStatus:'pending_recovery'};
}

function planningEpochError(message = '新排班基线的草稿或审计周期尚未完整初始化，已保持只读。') {
  return Object.assign(new Error(message), {status:503,code:'planning_epoch_uninitialized'});
}
const planningRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const planningIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
async function syncPlanningDirectory(directory) {
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function readPlanningEpoch({manifestPath=PLANNING_BASELINE_MANIFEST_PATH,epochPath=PLANNING_EPOCH_PATH,storePath=PLANNING_STORE_PATH,auditPath=AUDIT_LOG_PATH}={}) {
  const manifest = await readPlanningBaselineManifest(manifestPath);
  if (!manifest) throw planningEpochError('正式排班新基线尚未核验，不能将旧历史当成空白开启写入。');
  let epoch, store, firstLine, auditTerminated;
  try {
    epoch=JSON.parse(await fs.readFile(epochPath,'utf8'));
    store=JSON.parse(await fs.readFile(storePath,'utf8'));
    const handle=await fs.open(auditPath,'r');
    try { const buffer=Buffer.alloc(4096),{bytesRead}=await handle.read(buffer,0,buffer.length,0); const prefix=buffer.subarray(0,bytesRead).toString('utf8'); auditTerminated=prefix.includes('\n'); firstLine=prefix.split('\n')[0]; }
    finally { await handle.close(); }
  } catch { throw planningEpochError(); }
  let audit;
  try { audit=JSON.parse(firstLine); } catch { throw planningEpochError(); }
  const baselineHash=hashValue(manifest),epochId=epoch?.epochId;
  const valid=planningRecord(epoch)&&epoch.schemaVersion===1&&typeof epochId==='string'&&/^[0-9a-f-]{36}$/u.test(epochId)&&
    epoch.baselineHash===baselineHash&&epoch.historyStatus==='pending_recovery'&&planningIso(epoch.createdAt)&&
    Date.parse(epoch.createdAt)>=Date.parse(manifest.checkedAt)&&Date.parse(epoch.createdAt)<=Date.now()+300000&&
    planningRecord(store)&&store.schemaVersion===3&&store.epochId===epochId&&store.baselineHash===baselineHash&&
    Number.isSafeInteger(store.storeRevision)&&store.storeRevision>=0&&
    store.historyStatus==='pending_recovery'&&['drafts','makeupDrafts','restProfiles','restSettings'].every(key=>planningRecord(store[key]))&&
    auditTerminated&&planningRecord(audit)&&audit.action==='planning-epoch-initialized'&&audit.epochId===epochId&&
    audit.baselineHash===baselineHash&&audit.historyStatus==='pending_recovery'&&audit.at===epoch.createdAt;
  if (!valid) throw planningEpochError('新排班草稿、审计与已核验正式基线不一致，已停止写入。');
  return {manifest,epoch:{schemaVersion:1,epochId,baselineHash,createdAt:epoch.createdAt,historyStatus:'pending_recovery'},store};
}
// Offline-only initializer. No HTTP route calls this function and no Feishu
// API is called here. Existing files, including historical files, are never
// overwritten; a partial local initialization remains fail-closed.
async function initializePlanningEpoch({confirm=false,manifestPath=PLANNING_BASELINE_MANIFEST_PATH,epochPath=PLANNING_EPOCH_PATH,storePath=PLANNING_STORE_PATH,auditPath=AUDIT_LOG_PATH,guardPath=PLANNING_IMPORT_GUARD_PATH}={}) {
  if (confirm !== true) throw planningEpochError('需明确确认后才能建立新的本地排班草稿与审计周期。');
  const manifest=await readPlanningBaselineManifest(manifestPath);
  if (!manifest) throw planningEpochError('正式排班新基线尚未核验。');
  for (const file of [epochPath,storePath,auditPath,guardPath]) {
    try { await fs.access(file); throw planningEpochError('目标目录已有排班周期、草稿、审计或写回意图；不会覆盖。'); }
    catch(error) { if (error.code !== 'ENOENT') throw error; }
  }
  const directory=path.dirname(epochPath);
  if (![manifestPath,storePath,auditPath,guardPath].every(file=>path.dirname(file)===directory)) throw planningEpochError('新基线文件必须位于同一个专用持久目录。');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const createdAt=new Date().toISOString(),baselineHash=hashValue(manifest),epochId=randomUUID();
  const epoch={schemaVersion:1,epochId,baselineHash,createdAt,historyStatus:'pending_recovery'};
  const store={schemaVersion:3,epochId,baselineHash,historyStatus:'pending_recovery',storeRevision:0,drafts:{},makeupDrafts:{},restProfiles:{},restSettings:{},updatedAt:null};
  const audit={id:epochId,action:'planning-epoch-initialized',at:createdAt,epochId,baselineHash,historyStatus:'pending_recovery'};
  for (const [file,content] of [[storePath,JSON.stringify(store)],[auditPath,JSON.stringify(audit)+'\n'],[epochPath,JSON.stringify(epoch)]]) {
    const handle=await fs.open(file,'wx',0o600);
    try { await handle.writeFile(content,'utf8'); await handle.sync(); }
    finally { await handle.close(); }
  }
  await syncPlanningDirectory(directory);
  await readPlanningEpoch({manifestPath,epochPath,storePath,auditPath});
  return epoch;
}

async function draftCapability(auth) {
  if (!canManagePlanning(auth)) return {enabled:false,code:'planning_admin_required',message:'仅排班管理员可保存新基线草稿或配置。'};
  if (RECOVERY_READ_ONLY) return {enabled:false,code:'recovery_read_only',message:RECOVERY_MESSAGE};
  if (sourceSnapshot) return {enabled:false,code:'planning_source_snapshot',message:'当前仅有只读来源快照，不能保存排班草稿。'};
  if (!PLANNING_DRAFT_WRITES_ENABLED) return {enabled:false,code:'planning_draft_writes_disabled',message:'新基线草稿保存仍处于只读验收。'};
  try { await planningStorageHealth();return {enabled:true,code:'available',message:''}; }
  catch { return {enabled:false,code:'planning_storage_unavailable',message:'新基线草稿或审计存储不可核验，不能保存。'}; }
}
async function totalImportCapability(auth) {
  if (!canManagePlanning(auth)) return {enabled:false,code:'planning_admin_required',message:'仅排班管理员可向正式总表导入。'};
  if (RECOVERY_READ_ONLY) return {enabled:false,code:'recovery_read_only',message:RECOVERY_MESSAGE};
  if (sourceSnapshot) return {enabled:false,code:'planning_source_snapshot',message:'当前仅有只读来源快照，不能向正式总表写入。'};
  if (!PLANNING_TOTAL_IMPORT_ENABLED) return {enabled:false,code:'total_import_disabled',message:'正式排班总表导入仍处于只读验收，不能提交。'};
  try {
    await planningStorageHealth();
    const {manifest}=await readPlanningEpoch();
    const guard=await readPlanningImportGuard();
    if (guard && ['intent','uncertain'].includes(guard.state)) return {enabled:false,code:'write_result_pending',message:`上一次正式总表写回结果待核验（审计 ${String(guard.id).slice(0,64)}），请先核销，不能再次提交。`};
    const target=await resolveTotalScheduleTarget();
    if (target.spreadsheetToken!==manifest.spreadsheetToken||target.sheetId!==manifest.sheetId) return {enabled:false,code:'planning_source_changed',message:'当前总表与新基线来源不一致，已暂停写入。'};
    return {enabled:true,code:'available',message:''};
  } catch (error) { return {enabled:false,code:error?.code==='planning_epoch_uninitialized'?'planning_epoch_uninitialized':error?.code==='TOTAL_SCHEDULE_GUARD_UNREADABLE'?'total_import_guard_unreadable':'planning_source_or_storage_unavailable',message:error?.code==='TOTAL_SCHEDULE_GUARD_UNREADABLE'?'正式总表写回核验记录不可读，不能再次提交；请先恢复审计。':'新基线来源或审计存储待核验，不能写回。'}; }
}
async function assertTotalImportReady(target) {
  if (RECOVERY_READ_ONLY) throw Object.assign(new Error(RECOVERY_MESSAGE), {status:423,code:'recovery_read_only'});
  if (sourceSnapshot) throw Object.assign(new Error('当前仅有只读来源快照，不能向正式总表写入。'), {status:423,code:'planning_source_snapshot'});
  if (!PLANNING_TOTAL_IMPORT_ENABLED) throw Object.assign(new Error('正式排班总表写入尚未开启。'), {status:423,code:'total_import_disabled'});
  await planningStorageHealth();
  const {manifest}=await readPlanningEpoch();
  if (target?.spreadsheetToken!==manifest.spreadsheetToken||target?.sheetId!==manifest.sheetId) throw Object.assign(new Error('总表目标与新基线来源不一致，已停止写入。'), {status:409,code:'planning_source_changed'});
}

function attendanceTimeKey(value) {
  const cleaned = String(value || '').replace(/[：]/gu, ':').replace(/[—–～~至]/gu, '-').replace(/\s+/gu, '');
  const match = cleaned.match(/(\d{1,2}):(\d{2})-(?:次日)?(\d{1,2}):(\d{2})/u);
  if (!match) return '';
  const start = Number(match[1]) * 60 + Number(match[2]); const end = Number(match[3]) * 60 + Number(match[4]);
  if (start > 1439 || end > 1439) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}-${end <= start ? '次日' : ''}${String(Number(match[3])).padStart(2, '0')}:${match[4]}`;
}

function attendanceShiftTemplates(rows) {
  const legend = rows.slice(0, 4).flat().map(flattenCell).find((cell) => cell.includes('班次信息:')) || '';
  const templates = new Map();
  for (const match of legend.matchAll(/([A-Za-z][A-Za-z0-9]*)[（(]([^）)]+)[）)]/gu)) {
    const time = attendanceTimeKey(match[2]);
    if (!time) continue;
    const entries = templates.get(match[1]) || []; entries.push({ time, value: match[0] }); templates.set(match[1], entries);
  }
  return templates;
}

function attendanceShiftCell(item, templates) {
  if (item.rest || item.shiftCode === '休') return '休息';
  const code = String(item.shiftCode || '').trim();
  const time = attendanceTimeKey(item.shiftTime || SHIFT_TIMES[code]);
  const matches = (templates.get(code) || []).filter((candidate) => candidate.time === time);
  return matches.length === 1 ? matches[0].value : '';
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
    row.forEach((cell, columnIndex) => { const key = headerDateKey(cell, yearHint); if (columnIndex >= 4 && dates.has(key)) candidate.set(key, columnIndex); });
    if (candidate.size > headerMap.size) { headerRow = rowIndex; headerMap = candidate; }
  });
  const isFormalTotalSheet = flattenCell(rows[headerRow]?.[0]) === 'UID'
    && flattenCell(rows[headerRow]?.[1]) === '部门'
    && flattenCell(rows[headerRow]?.[2]) === '工号';
  if (!isFormalTotalSheet || headerRow < 0 || headerMap.size !== dates.size) {
    throw Object.assign(new Error('排班总表表头、日期列或人员列与正式来源不符，已阻断写回。'), { status: 422, code: 'TOTAL_SCHEDULE_SCHEMA_MISMATCH' });
  }
  const dateCounts = new Map();
  rows[headerRow].forEach((cell, columnIndex) => {
    if (columnIndex < 4) return;
    const key = headerDateKey(cell, yearHint);
    if (dates.has(key)) dateCounts.set(key, (dateCounts.get(key) || 0) + 1);
  });
  if ([...dateCounts.values()].some((count) => count !== 1)) {
    throw Object.assign(new Error('排班总表存在重复日期列，已阻断写回。'), { status: 422, code: 'DUPLICATE_TOTAL_DATE' });
  }
  const nameRows = new Map();
  rows.slice(headerRow + 1).forEach((row, index) => {
    const rowIndex = headerRow + 1 + index;
    const name = flattenCell(row?.[3]).replace(/\s+/gu, '').trim();
    if (!name) return;
    const entries = nameRows.get(name) || [];
    entries.push({ rowIndex, department: flattenCell(row?.[1]), uid: flattenCell(row?.[0]), employeeNo: flattenCell(row?.[2]) });
    nameRows.set(name, entries);
  });
  const templates = attendanceShiftTemplates(rows);
  if (!templates.size) throw Object.assign(new Error('正式总表缺少可核验的班次格式说明，已阻断写回。'), { status: 422, code: 'TOTAL_SCHEDULE_SHIFT_LEGEND_MISSING' });
  const targets = new Map(); const unresolved = []; let noChangeCount = 0;
  for (const item of draft.assignments || []) {
    const name = String(item.name || '').replace(/\s+/gu, '').trim(); const matches = nameRows.get(name) || []; const columnIndex = headerMap.get(item.date);
    const formattedShift = attendanceShiftCell(item, templates);
    const reason = !matches.length ? '正式总表姓名列未找到此人' : matches.length !== 1 ? '正式总表存在同名人员，须用唯一身份核验' : !matches[0].department.startsWith('凡岛-品牌营销部-直播中心') ? '人员不在直播中心部门' : !matches[0].uid || !matches[0].employeeNo ? '人员唯一标识不完整' : !Number.isInteger(columnIndex) ? '总表未找到日期列' : !formattedShift ? '班次时间不符合原表考勤模板' : '';
    if (reason) { unresolved.push({ date: item.date, name: item.name, reason }); continue; }
    const { rowIndex } = matches[0];
    if (flattenCell(rows[rowIndex]?.[columnIndex]) === formattedShift) { noChangeCount++; continue; }
    const key = String(rowIndex);
    if (!targets.has(key)) targets.set(key, new Map());
    if (targets.get(key).has(columnIndex)) { unresolved.push({ date: item.date, name: item.name, reason: '同一单元格被多个班次占用' }); continue; }
    targets.get(key).set(columnIndex, formattedShift);
  }
  // Each value range covers only assigned cells. A wide row write would flatten
  // intervening formulas and overwrite a colleague's unrelated shift.
  const ranges = [...targets.entries()].flatMap(([rowKey, cells]) => {
    const rowIndex = Number(rowKey); const columns = [...cells.keys()].sort((a, b) => a - b); const groups = [];
    columns.forEach((columnIndex) => {
      const group = groups.at(-1);
      if (group && columnIndex === group.at(-1) + 1) group.push(columnIndex); else groups.push([columnIndex]);
    });
    return groups.map((group) => {
      const startColumn = group[0]; const endColumn = group.at(-1);
      return { range: `${target.sheetId}!${columnName(startColumn)}${rowIndex + 1}:${columnName(endColumn)}${rowIndex + 1}`, before: group.map((columnIndex) => flattenCell(rows[rowIndex]?.[columnIndex])), after: group.map((columnIndex) => cells.get(columnIndex)), row: rowIndex + 1 };
    });
  });
  const overwrites = ranges.flatMap((range) => range.before.map((value, index) => value && value !== range.after[index] ? ({ range: range.range, before: value, after: range.after[index] }) : null).filter(Boolean));
  const fingerprint = { roomCode: draft.roomCode, role: draft.role, startDate: draft.startDate, endDate: draft.endDate, headerRow, revision, assignments: (draft.assignments || []).map(({ date, name, shiftCode, rest, shiftTime }) => ({ date, name, shiftCode, rest: Boolean(rest), shiftTime })), ranges: ranges.map(({ range, before, after }) => ({ range, before, after })) };
  return { target, roomCode: draft.roomCode, roomName: draft.roomName, role: draft.role, startDate: draft.startDate, endDate: draft.endDate, headerRow: headerRow + 1, assignmentCount: (draft.assignments || []).length, resolvedCount: (draft.assignments || []).length - unresolved.length, noChangeCount, ranges, unresolved, overwrites, revision: Number(revision || 0), expectedHash: hashValue({ ...fingerprint, target }) };
}
async function previewPlanningImport(draft) {
  const target = await resolveTotalScheduleTarget();
  const source = await readSpreadsheetRange(target.spreadsheetToken, fullScheduleRange(target));
  const plan = buildPlanningImportPlan(draft, source.rows, source.revision, target);
  await assertNoPlanningFormulaCells(plan);
  return { plan, source };
}

// Formula rendering returns the expression (rather than its displayed value).
// Never replace a formula with static attendance text, even after an overwrite
// checkbox. Identical display values were already excluded from plan.ranges.
async function assertNoPlanningFormulaCells(plan) {
  for (const item of plan.ranges) {
    const source = await readSpreadsheetRange(plan.target.spreadsheetToken, item.range, 'Formula');
    assertPlanningFormulaRow(item, alignPlanningRangeRow(item.range, source.actualRange, source.rows));
  }
}

function planningA1RowRange(range) {
  const match = String(range || '').match(/^([^!]+)!([A-Z]+)(\d+):([A-Z]+)(\d+)$/u);
  if (!match || match[3] !== match[5]) return null;
  const column = letters => [...letters].reduce((value, letter)=>value*26+letter.charCodeAt(0)-64,0)-1;
  const first = column(match[2]), last = column(match[4]);
  return last >= first ? {sheetId:match[1],row:Number(match[3]),first,last} : null;
}

function alignPlanningRangeRow(requestedRange, actualRange, rows) {
  const requested = planningA1RowRange(requestedRange);
  if (!requested || typeof actualRange !== 'string') throw Object.assign(new Error('排班单元格回读坐标不可核验。'), {status:502,code:'SHEET_READBACK_UNVERIFIED'});
  const aligned = Array(requested.last-requested.first+1).fill('');
  if (actualRange === '') {
    if (rows.length) throw Object.assign(new Error('空范围却返回单元格值，已停止回读。'), {status:502,code:'SHEET_READBACK_UNVERIFIED'});
    return aligned;
  }
  const actual = planningA1RowRange(actualRange);
  if (!actual || actual.sheetId !== requested.sheetId || actual.row !== requested.row || actual.first < requested.first || actual.last > requested.last || rows.length !== 1 || !Array.isArray(rows[0]) || rows[0].length > actual.last-actual.first+1) {
    throw Object.assign(new Error('排班单元格回读范围与请求坐标不符，已停止回读。'), {status:502,code:'SHEET_READBACK_UNVERIFIED'});
  }
  rows[0].forEach((value,index)=>{aligned[actual.first-requested.first+index]=value;});
  return aligned;
}

function changedRowRanges(range, before, after) {
  const target = planningA1RowRange(range);
  if (!target || !Array.isArray(before) || !Array.isArray(after) || before.length !== after.length || after.length !== target.last-target.first+1) {
    throw Object.assign(new Error('待写回单元格坐标与前后值不一致。'), {status:422,code:'SHEET_WRITE_RANGE_INVALID'});
  }
  const changed = after.map((value,index)=>value !== before[index] ? index : -1).filter(index=>index>=0);
  const groups = [];
  changed.forEach(index=>{const group=groups.at(-1);if(group&&index===group.at(-1)+1)group.push(index);else groups.push([index]);});
  return groups.map(group=>({
    range:`${target.sheetId}!${columnName(target.first+group[0])}${target.row}:${columnName(target.first+group.at(-1))}${target.row}`,
    before:group.map(index=>before[index]),
    after:group.map(index=>after[index]),
    row:target.row,
  }));
}

function assertPlanningFormulaRow(item, row) {
  if (item.before.some((value, index) => value && (index >= row.length || row[index] === ''))) {
    throw Object.assign(new Error(`无法核验 ${item.range} 的原始公式，已阻断写回。`), {status:409,code:'TOTAL_SCHEDULE_FORMULA_UNVERIFIED'});
  }
  if (row.some(value => /^=/u.test(String(value).trim()))) {
    throw Object.assign(new Error(`目标范围 ${item.range} 包含公式，不能静态覆盖；请在原表核验。`), {status:409,code:'TOTAL_SCHEDULE_FORMULA_PROTECTED'});
  }
}

async function readPlanningImportGuard() {
  const epoch = RECOVERY_READ_ONLY ? null : (await readPlanningEpoch()).epoch;
  try {
    const guard = JSON.parse(await fs.readFile(PLANNING_IMPORT_GUARD_PATH, 'utf8'));
    if (guard?.schemaVersion !== 1 || !guard.id || !['intent','uncertain','verified','not_applied'].includes(guard.state) || !Array.isArray(guard.ranges) ||
      (epoch && (guard.epochId !== epoch.epochId || guard.baselineHash !== epoch.baselineHash))) throw new Error('guard_invalid');
    return guard;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw Object.assign(new Error('排班写回的持久核验记录不可读，已停止新写入；请先恢复该记录。'), {status:503,code:'TOTAL_SCHEDULE_GUARD_UNREADABLE'});
  }
}
async function writePlanningImportGuard(guard) {
  if (RECOVERY_READ_ONLY) throw Object.assign(new Error(RECOVERY_MESSAGE), {status:423,code:'recovery_read_only'});
  const {epoch}=await readPlanningEpoch();
  if (guard?.epochId !== epoch.epochId || guard?.baselineHash !== epoch.baselineHash) throw planningEpochError('排班写回意图与当前新基线周期不一致，已停止写入。');
  const temporary = `${PLANNING_IMPORT_GUARD_PATH}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(guard)); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temporary, PLANNING_IMPORT_GUARD_PATH);
  await syncPlanningDirectory(path.dirname(PLANNING_IMPORT_GUARD_PATH));
}
function planningReadbackState(ranges, readbacks) {
  if (!Array.isArray(readbacks) || readbacks.length !== ranges.length) return 'unverified';
  let allAfter = true, allBefore = true;
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index], row = readbacks[index];
    if (!Array.isArray(row) || row.length !== range.after.length) return 'unverified';
    if (row.some((value, i) => value !== range.after[i])) allAfter = false;
    if (row.some((value, i) => value !== range.before[i])) allBefore = false;
  }
  return allAfter ? 'after' : allBefore ? 'before' : 'mixed';
}
async function readPlanningImportTargets(guard) {
  const values = [];
  for (const item of guard.ranges) {
    const checked = await readSpreadsheetRange(guard.spreadsheetToken, item.range);
    values.push(alignPlanningRangeRow(item.range, checked.actualRange, checked.rows));
  }
  return values;
}
function planningUncertainError(id) {
  return Object.assign(new Error(`飞书排班写入结果待核验（审计 ${id}）。请先查看原表对应单元格及写回审计，不要重复提交。`), {status:409,code:'SCHEDULE_WRITE_UNCERTAIN'});
}
function canManagePlanning(auth) {
  const permissions = auth?.permissions || {};
  return auth?.mode === 'internal' || permissions.super_admin || permissions.operation_admin || permissions.manage_permissions;
}
function assertPlanningManager(auth) {
  if (!canManagePlanning(auth)) throw Object.assign(new Error('仅排班管理员可保存草稿、修改配置或提交正式排班。'), {status:403,code:'PLANNING_ADMIN_REQUIRED'});
}
async function planningImportGuardStatus() {
  const guard = await readPlanningImportGuard();
  if (!guard) return {state:'none'};
  let observed = guard.observed || null;
  if (['intent','uncertain'].includes(guard.state)) {
    try { observed = planningReadbackState(guard.ranges, await readPlanningImportTargets(guard)); }
    catch { observed = 'unverified'; }
  }
  return {id:guard.id,kind:guard.kind || 'planning-import',state:guard.state,at:guard.at,checkedAt:guard.checkedAt || null,roomCode:guard.roomCode,role:guard.role,date:guard.date,month:guard.month,ranges:guard.ranges,observed};
}
async function reconcilePlanningImport(input, auth) {
  assertPlanningManager(auth);
  const guard = await readPlanningImportGuard();
  if (!guard || !['intent','uncertain'].includes(guard.state) || input?.intentId !== guard.id || input?.confirm !== true) throw Object.assign(new Error('核销编号或确认信息与当前待核验写回不一致。'), {status:409});
  const values = await readPlanningImportTargets(guard);
  const observed = planningReadbackState(guard.ranges, values);
  if (observed === 'mixed' || observed === 'unverified') throw planningUncertainError(guard.id);
  if (observed === 'before' && (input.confirmNotApplied !== true || Date.now() - Date.parse(guard.at) < 10 * 60 * 1000)) {
    throw Object.assign(new Error('目前仅回读到原值，但不能排除延迟写入；十分钟后由管理员核对原表并明确确认未写入。'), {status:409,code:'TOTAL_SCHEDULE_RECONCILE_WAIT'});
  }
  const state = observed === 'after' ? 'verified' : 'not_applied';
  const reconciled = {...guard,state,observed,checkedAt:new Date().toISOString(),reconciledBy:actorFromAuth(auth)};
  // The existing intent/uncertain guard remains blocking until both the audit
  // and the reconciled guard are durable. A failed audit must not unlock POST.
  await appendAudit({id:guard.id,at:reconciled.checkedAt,action:'planning-import-reconciled',actor:reconciled.reconciledBy,state,observed,ranges:guard.ranges.map(item=>item.range)});
  await writePlanningImportGuard(reconciled);
  return {ok:true,id:guard.id,state,observed,readbackVerified:true};
}
async function writePlanningRanges(token, spreadsheetToken, ranges) {
  if (RECOVERY_READ_ONLY) throw Object.assign(new Error(RECOVERY_MESSAGE), {status:423,code:'recovery_read_only'});
  const response = await fetch(`${FEISHU_API}/sheets/v2/spreadsheets/${spreadsheetToken}/values_batch_update`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ valueRanges: ranges.map((item) => ({ range: item.range, values: [item.after] })) }), signal: AbortSignal.timeout(30_000) });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) throw Object.assign(new Error(`排班总表写入失败：${payload.msg || response.status}`), { status: 502 });
  const data = payload.data;
  if (data?.spreadsheetToken !== spreadsheetToken || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      !Array.isArray(data.responses) || data.responses.length !== ranges.length ||
      data.responses.some((item,index)=>item?.spreadsheetToken !== spreadsheetToken || item.updatedRange !== ranges[index].range ||
        item.updatedRows !== 1 || item.updatedColumns !== ranges[index].after.length || item.updatedCells !== ranges[index].after.length)) {
    throw Object.assign(new Error('飞书写入响应的范围、数量或版本不可核验，需回读原表；禁止盲重试。'), {status:502,code:'SHEET_WRITE_RESPONSE_UNVERIFIED'});
  }
  return data;
}

async function guardedSheetWrite({kind,auth,plan,token,spreadsheetToken,ranges,auditAction,auditDetails={}}) {
  assertPlanningManager(auth);
  await assertTotalImportReady(plan.target);
  if (spreadsheetToken !== plan.target.spreadsheetToken || kind !== 'planning-import') throw Object.assign(new Error('当前写回目标没有获准的新基线，已阻断。'), {status:423,code:'planning_source_unbaselined'});
  if (!Array.isArray(ranges) || !ranges.length || ranges.some(item=>{
    const parsed=planningA1RowRange(item.range);
    return !parsed || parsed.sheetId!==plan.target.sheetId || !Array.isArray(item.before) || !Array.isArray(item.after) ||
      !item.after.length || item.before.length!==item.after.length || item.after.length!==parsed.last-parsed.first+1 ||
      item.after.some((value,index)=>value===item.before[index]);
  })) throw Object.assign(new Error('提交范围与预览不符，或包含同值单元格；已停止写回。'), {status:409,code:'TOTAL_SCHEDULE_RANGE_INVALID'});
  const previous = await readPlanningImportGuard();
  if (previous && ['intent','uncertain'].includes(previous.state)) throw planningUncertainError(previous.id);
  const {epoch}=await readPlanningEpoch();
  const intent = {schemaVersion:1,id:randomUUID(),epochId:epoch.epochId,baselineHash:epoch.baselineHash,kind,state:'intent',at:new Date().toISOString(),actor:actorFromAuth(auth),spreadsheetToken,expectedHash:plan.expectedHash,roomCode:plan.roomCode || null,role:plan.role || null,month:plan.month || null,date:plan.date || null,ranges:ranges.map(({range,before,after})=>({range,before,after}))};
  await writePlanningImportGuard(intent);
  try { await appendAudit({id:intent.id,at:intent.at,action:`${kind}-intent`,actor:intent.actor,ranges:intent.ranges}); }
  catch (error) {
    await writePlanningImportGuard({...intent,state:'not_applied',checkedAt:new Date().toISOString(),errorCode:'intent_audit_failed'});
    throw error;
  }
  try {
    const result = await writePlanningRanges(token,spreadsheetToken,ranges);
    const values = await readPlanningImportTargets(intent);
    if (planningReadbackState(intent.ranges,values) !== 'after') throw new Error('readback_mismatch');
    const verified = {...intent,state:'verified',verifiedAt:new Date().toISOString(),resultRevision:Number(result.revision || result.updatedRevision || 0)};
    // Keep the write intent blocking until both evidence records are synced.
    await appendAudit({id:intent.id,at:verified.verifiedAt,action:auditAction,actor:intent.actor,...auditDetails,ranges:ranges.map(item=>item.range),resultRevision:verified.resultRevision,readbackVerified:true});
    await writePlanningImportGuard(verified);
    return {auditId:intent.id,readbacks:intent.ranges.map((item,index)=>({range:item.range,values:values[index]})),readbackVerified:true,resultRevision:verified.resultRevision};
  } catch (error) {
    let observed = 'unverified';
    try { observed = planningReadbackState(intent.ranges,await readPlanningImportTargets(intent)); }
    catch { /* A failed read never proves that a remote write was not applied. */ }
    const uncertain = {...intent,state:'uncertain',checkedAt:new Date().toISOString(),observed,errorCode:String(error?.code || error?.name || 'write_result_unknown').slice(0,80)};
    try { await writePlanningImportGuard(uncertain); }
    catch (guardError) { console.error('写回结果待核验且持久状态更新失败；写前意图仍应阻断重试',String(guardError?.code || guardError?.message || 'guard_failed')); }
    try { await appendAudit({id:intent.id,at:uncertain.checkedAt,action:`${kind}-uncertain`,actor:intent.actor,observed,errorCode:uncertain.errorCode}); }
    catch (auditError) { console.error('写回结果待核验且审计列表追加失败',String(auditError?.code || auditError?.message || 'audit_failed')); }
    throw planningUncertainError(intent.id);
  }
}
async function commitPlanningImport(input, auth) {
  assertPlanningManager(auth);
  if (input?.confirm !== true || !input?.expectedHash) throw Object.assign(new Error('请先预览并确认导入。'), { status: 409 });
  const previous = await readPlanningImportGuard();
  if (previous && ['intent','uncertain'].includes(previous.state)) throw planningUncertainError(previous.id);
  const draft = normalizePlanningDraft(input.draft || {}); const { plan, source } = await previewPlanningImport(draft);
  const sourceReadAt=new Date().toISOString();
  await assertTotalImportReady(plan.target);
  if (plan.expectedHash !== input.expectedHash) throw Object.assign(new Error('排班总表在预览后发生变化，请重新预览。'), { status: 409, code: 'TOTAL_SCHEDULE_CHANGED', plan });
  if (plan.unresolved.length) throw Object.assign(new Error(`有 ${plan.unresolved.length} 条排班未匹配到总表姓名或日期，已阻断导入。`), { status: 409, code: 'UNRESOLVED_ASSIGNMENTS', plan });
  if (plan.overwrites.length && input.allowOverwrite !== true) throw Object.assign(new Error('目标日期已有排班，需明确同意覆盖后才能导入。'), { status: 409, code: 'OVERWRITE_REQUIRED', plan });
  if (!plan.ranges.length) {
    const audit = {id:randomUUID(),at:new Date().toISOString(),action:'planning-import-no-change',actor:actorFromAuth(auth),roomCode:plan.roomCode,role:plan.role,assignmentCount:plan.assignmentCount,sourceRevision:source.revision || null,sourceReadAt,noWrite:true,readbackVerified:true};
    await appendAudit(audit);
    return {ok:true,plan,auditId:audit.id,readbacks:[],readbackVerified:true,noChange:true};
  }
  const result = await guardedSheetWrite({kind:'planning-import',auth,plan,token:source.token,spreadsheetToken:plan.target.spreadsheetToken,ranges:plan.ranges,auditAction:'planning-import',auditDetails:{roomCode:plan.roomCode,roomName:plan.roomName,role:plan.role,startDate:plan.startDate,endDate:plan.endDate,assignmentCount:plan.assignmentCount,overwrites:plan.overwrites.length}});
  return {ok:true,plan,...result};
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

function fullScheduleRange(sheet) {
  const rowCount = Number(sheet.rowCount); const columnCount = Number(sheet.columnCount);
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > 20000 || !Number.isInteger(columnCount) || columnCount < 5 || columnCount > 200) {
    throw Object.assign(new Error('排班工作表尺寸异常，需核对来源后重试。'), { status: 422, code: 'TOTAL_SCHEDULE_DIMENSIONS_INVALID' });
  }
  return `${sheet.sheetId}!A1:${columnName(columnCount - 1)}${rowCount}`;
}

async function resolveSpreadsheetSheetMetadata(spreadsheetToken, preferredSheetId = '', label = '飞书表格', expectedTitle = '') {
  if (sourceSnapshot) {
    const sheetId = await sourceSnapshot.resolveSheet(spreadsheetToken, preferredSheetId);
    const summary = await sourceSnapshot.summary();
    const sheet = summary.sources.find((item) => item.spreadsheetToken === spreadsheetToken)?.sheets.find((item) => item.sheetId === sheetId);
    if (!sheet || (expectedTitle && sheet.title !== expectedTitle)) throw Object.assign(new Error(`${label}目标工作表与已核验来源不一致。`), { status: 422 });
    return { sheetId, title: sheet.title, rowCount: sheet.rowCount, columnCount: sheet.columnCount };
  }
  const cacheKey = `${spreadsheetToken}:${preferredSheetId}:${expectedTitle}`;
  const cached = resolvedSpreadsheetSheets.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.sheet;
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
    rowCount: Number(sheet.grid_properties?.row_count ?? sheet.gridProperties?.rowCount ?? sheet.grid_properties?.rowCount ?? 0),
    columnCount: Number(sheet.grid_properties?.column_count ?? sheet.gridProperties?.columnCount ?? sheet.grid_properties?.columnCount ?? 0),
  })).filter((sheet) => sheet.id);
  const selected = preferredSheetId ? normalized.find((sheet) => sheet.id === preferredSheetId) : normalized.find((sheet) => sheet.title === expectedTitle);
  if (!selected || (expectedTitle && selected.title !== expectedTitle)) throw Object.assign(new Error(`${label}中未找到精确匹配的目标工作表。`), { status: 422, code: 'TOTAL_SCHEDULE_SHEET_MISMATCH' });
  const sheet = { sheetId: selected.id, title: selected.title, rowCount: selected.rowCount, columnCount: selected.columnCount };
  resolvedSpreadsheetSheets.set(cacheKey, { sheet, expiresAt: Date.now() + WIKI_RESOLUTION_TTL_MS });
  return sheet;
}

async function resolveTotalScheduleTarget() {
  const spreadsheetToken = await resolveWikiSpreadsheetToken(TOTAL_SCHEDULE_WIKI_TOKEN, TOTAL_SCHEDULE_SPREADSHEET_TOKEN, '品牌营销部直播中心排班表');
  if (spreadsheetToken !== SEPTEMBER_TOTAL_SCHEDULE_TOKEN) {
    throw Object.assign(new Error('正式排班总表与已批准的九月工作簿不一致，已阻断写回。'), { status: 422, code: 'TOTAL_SCHEDULE_WORKBOOK_MISMATCH' });
  }
  return {
    spreadsheetToken,
    ...(await resolveSpreadsheetSheetMetadata(spreadsheetToken, TOTAL_SCHEDULE_SHEET_ID, '品牌营销部直播中心排班表', TOTAL_SCHEDULE_SHEET_TITLE)),
    label: '品牌营销部-直播中心排班表_20260901_20260930 （coco）',
    wikiToken: TOTAL_SCHEDULE_WIKI_TOKEN,
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
      started = true;
      const normalized = name.replace(/\s+/gu, '');
      nameRows.set(normalized,[...(nameRows.get(normalized)||[]),rowIndex]);
    }
    for (const person of draft.roster || []) {
      const matches = nameRows.get(String(person.name || '').replace(/\s+/gu, '')) || [];
      if (matches.length !== 1) { unresolved.push({ date: draft.month, name: person.name, reason: matches.length ? '化妆师表本月区块存在重名，须核验身份' : '化妆师表本月区块未找到姓名' }); continue; }
      const rowIndex = matches[0];
      if (missingDates.length) continue;
      const columns = (draft.dates || []).map((date) => headerMap.get(date)); const startColumn = Math.min(...columns); const endColumn = Math.max(...columns);
      const before = Array.from({ length: endColumn - startColumn + 1 }, (_, offset) => flattenCell(rows[rowIndex]?.[startColumn + offset])); const after = [...before];
      (draft.dates || []).forEach((date) => { after[headerMap.get(date) - startColumn] = assignmentMap.get(`${person.name}|${date}`) || ''; });
      ranges.push(...changedRowRanges(`${target.sheetId}!${columnName(startColumn)}${rowIndex + 1}:${columnName(endColumn)}${rowIndex + 1}`,before,after));
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
    if (endRow > 220) throw Object.assign(new Error('化妆师来源已接近当前读取边界，不能在未核验尾部数据时追加月份。'), {status:422,code:'MAKEUP_APPEND_BOUNDARY_UNVERIFIED'});
    values.forEach((after,index)=>{
      const row = startRow+index;
      const before = Array.from({length:after.length},(_,column)=>flattenCell(rows[row-1]?.[column]));
      ranges.push({range:`${target.sheetId}!A${row}:${columnName(endColumn)}${row}`,before,after,values:[after],row,monthLabel:`${monthNumber}月`});
    });
  }
  const overwrites = mode === 'update' ? ranges.flatMap((range) => range.before.map((value, index) => value && value !== range.after[index] ? ({ range: range.range, before: value, after: range.after[index] }) : null).filter(Boolean)) : [];
  const fingerprint = { target, month: draft.month, revision: Number(revision || 0), mode, ranges: ranges.map((item) => ({ range: item.range, before: item.before, after:item.after })) };
  return { target, month: draft.month, mode, assignmentCount: (draft.assignments || []).length, resolvedCount: (draft.assignments || []).length - unresolved.length, ranges, unresolved, overwrites, revision: Number(revision || 0), expectedHash: hashValue(fingerprint) };
}

async function previewMakeupImport(draft) {
  const spreadsheetToken = await resolveWikiSpreadsheetToken(MAKEUP_SOURCE_WIKI_TOKEN, MAKEUP_SPREADSHEET_TOKEN, '化妆师排班');
  const target = { spreadsheetToken, sheetId: MAKEUP_SHEET_ID, label: '化妆师排班', wikiToken: MAKEUP_SOURCE_WIKI_TOKEN };
  const source = await readSpreadsheetRange(spreadsheetToken, `${MAKEUP_SHEET_ID}!A1:ZZ220`);
  const plan = buildMakeupImportPlan(draft, source.rows, source.revision, target);
  await assertNoPlanningFormulaCells(plan);
  return { plan, source };
}
async function commitMakeupImport() {
  throw Object.assign(new Error('化妆师源表尚无独立核验的新基线，不能提交或记为无变化。'), {status:423,code:'planning_source_unbaselined'});
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

async function verifiedAnchorRoomsForMonth(month) {
  const verified = { ...VERIFIED_ANCHOR_ROOMS };
  const sheets = await readScheduleSheets();
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const observed = new Map();
  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    ROOMS.forEach((room) => {
      const parsed = parseRoomSchedule(room, sheetRows(sheets[room.code]), date);
      parsed.room.anchors.forEach((shift) => namesFromCell(shift[2]).forEach((name) => {
        if (!/^[\p{Script=Han}·]{2,12}$/u.test(name)) return;
        const rooms = observed.get(name) || new Set(); rooms.add(room.name); observed.set(name, rooms);
      }));
    });
  }
  observed.forEach((rooms, name) => { verified[name] = rooms.size === 1 ? [...rooms][0] : '直播间待核验'; });
  return verified;
}

async function readRestBoard(month, store) {
  const safeMonth = /^20\d{2}-\d{2}$/u.test(String(month || '')) ? String(month) : localDateKey().slice(0, 7);
  if (sourceSnapshot && !REST_SCHEDULE_SOURCES[safeMonth]) return {available:false,month:safeMonth,entitlement:null,people:[],historyStatus:'pending_recovery',source:{mode:'verified_backup',permissionStatus:'月份未备份'},reason:'该月份不在已核验的原表备份中，不能使用其他月份补齐。'};
  const selectedSource = safeMonth === localDateKey().slice(0, 7) ? null : REST_SCHEDULE_SOURCES[safeMonth];
  let sourceMeta = selectedSource ? { ...selectedSource } : { label: '品牌营销部-直播中心排班表', wikiToken: REST_SOURCE_WIKI_TOKEN, spreadsheetToken: '', sheetId: TOTAL_SCHEDULE_SHEET_ID };
  try {
    if (!sourceMeta.spreadsheetToken && selectedSource) sourceMeta.spreadsheetToken = await resolveWikiSpreadsheetToken(sourceMeta.wikiToken, '', sourceMeta.label);
    if (!sourceMeta.spreadsheetToken) sourceMeta = { ...sourceMeta, ...(await resolveTotalScheduleTarget()) };
    const readSources = [];
    if (!sourceMeta.rowCount || !sourceMeta.columnCount) sourceMeta = { ...sourceMeta, ...(await resolveSpreadsheetSheetMetadata(sourceMeta.spreadsheetToken, sourceMeta.sheetId, '主播休息排班源')) };
    const currentValue = await readSpreadsheetRange(sourceMeta.spreadsheetToken, fullScheduleRange(sourceMeta));
    readSources.push({ month: safeMonth, rows: currentValue.rows, revision: currentValue.revision, ...sourceMeta });
    const priorMonth = previousMonth(safeMonth); const priorSource = REST_SCHEDULE_SOURCES[priorMonth];
    if (priorSource) {
      try {
        const priorToken = priorSource.spreadsheetToken || await resolveWikiSpreadsheetToken(priorSource.wikiToken, '', priorSource.label);
        const priorMetadata = await resolveSpreadsheetSheetMetadata(priorToken, priorSource.sheetId, '上月主播休息排班源');
        const priorValue = await readSpreadsheetRange(priorToken, fullScheduleRange(priorMetadata));
        readSources.unshift({ month: priorMonth, rows: priorValue.rows, revision: priorValue.revision, ...priorSource, spreadsheetToken: priorToken });
      } catch {
        // 上月来源仅用于识别跨月连班；无权限时仍应保留本月真实排班结果。
      }
    }
    const entitlement = store?.restSettings?.[safeMonth]?.entitlement ?? null;
    const profiles = Object.fromEntries(Object.entries(store?.restProfiles || {}).map(([name, profile]) => [name, { ...profile, entitlement }]));
    let verifiedAnchorRooms = { ...VERIFIED_ANCHOR_ROOMS }; let liveRosterStatus = '待核验';
    try { verifiedAnchorRooms = await verifiedAnchorRoomsForMonth(safeMonth); liveRosterStatus = '已读取四间直播间原始班表'; }
    catch { /* 原始直播间班表暂不可用时，保留已核验的主播名单并显式标注覆盖范围。 */ }
    const people = parseRestSources(readSources, safeMonth, profiles, verifiedAnchorRooms);
    const matched = new Set(people.map((person) => person.name));
    const missing = Object.entries(verifiedAnchorRooms).filter(([name]) => !matched.has(name)).map(([name, roomName]) => ({ name, roomName, reason: '正式排班总表未找到唯一主播行，休息数据待核验' }));
    const ambiguous = people.filter((person) => person.sourceStatus !== 'matched').map((person) => ({ name: person.name, roomName: person.roomName, reason: person.sourceReason }));
    const unmatched = [...missing, ...ambiguous];
    if (sourceSnapshot && !store) for (const person of people) person.roomName='直播间待核验';
    const currentRevision = readSources.find((source) => source.month === safeMonth)?.revision || 0;
    return { available: true, month: safeMonth, entitlement, people, unmatched, source: { ...sourceMeta, revision: currentRevision, permissionStatus: '已读取', crossMonth: readSources.length > 1, liveRosterStatus, ...(currentValue.source||{}), ...(sourceSnapshot ? {scopeNote:'只读备份与直播间原始班表存在时效边界；未匹配主播单列待核验。'} : {}) }, checkedAt: new Date().toISOString(), historyStatus: sourceSnapshot && !store ? 'pending_recovery' : undefined, reason: people.length ? (sourceSnapshot && !store ? '原表只读备份；手工月应休、补班说明尚待恢复，剩余休假不作推断。' : '') : '当前月份没有匹配到已排班主播；空白单元格不会被计算为休息或上班。' };
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
      const baseline = await readPlanningBaselineManifest();
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
      return json(response, { ok: true, rooms: ROOM_PLANNING, shiftTimes: SHIFT_TIMES, drafts: store.drafts || {}, makeupDrafts: store.makeupDrafts || {}, updatedAt: store.updatedAt || null, totalSchedule: { ...target, url: TOTAL_SCHEDULE_WIKI_URL }, draftCapability:await draftCapability(auth),totalImportCapability:await totalImportCapability(auth), ...(baseline ? {planningBaseline:baseline,historyStatus:baseline.historyStatus,epochId:store.epochId||null} : {}) });
    }
    if (request.method === 'POST' && route === '/api/planning/generate') { validateWriteOrigin(request, auth); return json(response, { ok: true, draft: generateDraft(await readJsonBody(request)) }); }
    if (request.method === 'POST' && route === '/api/planning/draft') {
      validateWriteOrigin(request, auth); assertPlanningManager(auth); const draft = normalizePlanningDraft(await readJsonBody(request)); const store = await readPlanningStore(); const key = planningDraftKey(draft); const actor = actorFromAuth(auth); const saved = { ...draft, key, updatedAt: new Date().toISOString(), updatedBy: actor.name };
      const linked=linkOvernightDrafts(saved,{...(store.drafts||{}),[key]:saved});
      await writePlanningStore({ ...store, schemaVersion: 3, drafts:linked.drafts, updatedAt:saved.updatedAt }, auth); return json(response, { ok:true, draft:linked.drafts[key], drafts:linked.drafts, linkedKeys:linked.linkedKeys });
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
      validateWriteOrigin(request, auth); assertPlanningManager(auth); const body = await readJsonBody(request); const store = await readPlanningStore(); const current = store?.restSettings?.[String(body?.month || '')] || {};
      const setting = normalizeRestSetting(body, current); const actor = actorFromAuth(auth); const saved = { ...setting, updatedBy: actor.name };
      await writePlanningStore({ ...store, schemaVersion: 3, restSettings: { ...(store.restSettings || {}), [saved.month]: saved }, updatedAt: saved.updatedAt }, auth); return json(response, { ok: true, setting: saved });
    }
    if (request.method === 'POST' && route === '/api/planning/rest-profile') {
      validateWriteOrigin(request, auth); assertPlanningManager(auth); const body = await readJsonBody(request); const store = await readPlanningStore(); const current = store?.restProfiles?.[String(body?.name || '').trim()] || {};
      const profile = normalizeRestProfile(body, current); const actor = actorFromAuth(auth); const saved = { ...profile, updatedBy: actor.name };
      await writePlanningStore({ ...store, schemaVersion: 3, restProfiles: { ...(store.restProfiles || {}), [saved.name]: saved }, updatedAt: saved.updatedAt }, auth); return json(response, { ok: true, profile: saved });
    }
    if (request.method === 'GET' && route === '/api/planning/makeup') return json(response, { ok: true, data: await readMakeupSchedule(requestUrl.searchParams.get('date')) });
    if (request.method === 'POST' && route === '/api/planning/makeup/generate') { validateWriteOrigin(request, auth); return json(response, { ok: true, draft: generateMakeupDraft(await readJsonBody(request)) }); }
    if (request.method === 'POST' && route === '/api/planning/makeup/draft') {
      validateWriteOrigin(request, auth); assertPlanningManager(auth); const draft = generateMakeupDraft(await readJsonBody(request)); const store = await readPlanningStore(); const actor = actorFromAuth(auth); const saved = { ...draft, updatedBy: actor.name, updatedAt: new Date().toISOString() };
      await writePlanningStore({ ...store, schemaVersion: 3, makeupDrafts: { ...(store.makeupDrafts || {}), [saved.month]: saved }, updatedAt: saved.updatedAt }, auth); return json(response, { ok: true, draft: saved });
    }
    if (request.method === 'POST' && route === '/api/planning/makeup/import/preview') { validateWriteOrigin(request, auth); throw Object.assign(new Error('化妆师源表尚无独立核验的新基线，预览导入已暂停。'), {status:423,code:'planning_source_unbaselined'}); }
    if (request.method === 'POST' && route === '/api/planning/makeup/import') { validateWriteOrigin(request, auth); return json(response, await commitMakeupImport(await readJsonBody(request), auth)); }
    if (request.method === 'GET' && route === '/api/planning/import/status') {
      if (!canManagePlanning(auth)) throw Object.assign(new Error('当前账号无权查看排班写回核验记录。'), {status:403,code:'PLANNING_ADMIN_REQUIRED'});
      return json(response,{ok:true,data:await planningImportGuardStatus()});
    }
    if (request.method === 'POST' && route === '/api/planning/import/reconcile') { validateWriteOrigin(request, auth); return json(response,await reconcilePlanningImport(await readJsonBody(request),auth)); }
    if (request.method === 'POST' && route === '/api/planning/import/preview') { validateWriteOrigin(request, auth); const draft = normalizePlanningDraft((await readJsonBody(request)).draft || {}); const { plan } = await previewPlanningImport(draft); return json(response, { ok: true, plan }); }
    if (request.method === 'POST' && route === '/api/planning/import') { validateWriteOrigin(request, auth); assertPlanningManager(auth); return json(response, await commitPlanningImport(await readJsonBody(request), auth)); }
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
  if (origin && !['https://app.fandow.top','https://hub.fandow.com'].includes(origin)) {
    throw Object.assign(new Error('拒绝跨站写回请求。'), { status: 403 });
  }
}

async function previewWriteback(input) {
  const room = ROOMS.find((item) => item.code === input.roomCode);
  if (!room) throw Object.assign(new Error('未找到对应直播间。'), { status: 404 });
  const source = await readRoomFresh(room);
  const plan = buildWritebackPlan(room, source.rows, input, source.revision);
  const changedRanges = changedRowRanges(plan.range,plan.before,plan.after);
  await assertNoPlanningFormulaCells({target:{spreadsheetToken:SCHEDULE_SPREADSHEET_TOKEN},ranges:changedRanges});
  return {plan:{...plan,changedRanges},source};
}
async function commitWriteback() {
  throw Object.assign(new Error('直播间原表尚无独立核验的新基线，不能提交或记为无变化。'), {status:423,code:'planning_source_unbaselined'});
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
    sourceStatus: parsed.sourceStatus, writeback: {},
    writebackCapability:{enabled:false,code:RECOVERY_READ_ONLY?'recovery_read_only':'planning_source_unbaselined',message:RECOVERY_READ_ONLY?'当前班表来自只读来源快照，写回尚未恢复；时间可查看，不能提交。':'直播间原表尚无独立核验的新基线，时间可查看，不能提交。'},
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
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return '排班请求超时，结果待核验；请先回读，勿直接重复提交。';
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
      let baseline=null;let baselineValid=true;
      try { baseline=await readPlanningBaselineManifest(); } catch(error) { baselineValid=false;storageError=userFacingErrorMessage(error); }
      const healthy = Boolean((sourceSnapshot ? backupReady : FEISHU_APP_ID && FEISHU_APP_SECRET) && storage && baselineValid);
      return json(response, {
        ok: healthy,
        service: 'dispatch-center',
        source: sourceSnapshot ? 'verified_backup' : 'feishu-sheets',
        ...(sourceSnapshot ? {mode:'degraded-read-only',historyStatus:'pending_recovery',realTime:false} : {}),
        writeback: RECOVERY_READ_ONLY ? 'paused_recovery' : 'paused_unbaselined_source',
        planning: RECOVERY_READ_ONLY || sourceSnapshot ? 'history_pending_recovery' : PLANNING_TOTAL_IMPORT_ENABLED ? 'new-epoch-import-enabled-old-history-pending' : PLANNING_DRAFT_WRITES_ENABLED ? 'new-epoch-drafts-enabled-import-paused-old-history-pending' : 'new-epoch-read-only-old-history-pending',
        planningBaseline: baseline ? {available:true,checkedAt:baseline.checkedAt,historyStatus:baseline.historyStatus} : {available:false},
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
          try { return json(response, {ok:true,recovery:recoveryPayload(),sourceSnapshot:sourceSnapshot ? await sourceSnapshot.summary() : null,planningBaseline:await readPlanningBaselineManifest()}); }
          catch(error) { return errorResponse(response,error); }
        }
      }

      if (requestUrl.pathname === '/api/session' && request.method === 'GET') {
        return json(response, sessionFromAuth(auth));
      }

      if (requestUrl.pathname === '/api/planning' || requestUrl.pathname.startsWith('/api/planning/')) {
        const storedWrites = new Set(["/api/planning/draft","/api/planning/rest-setting","/api/planning/rest-profile","/api/planning/makeup/draft","/api/planning/makeup/import","/api/planning/import","/api/planning/import/reconcile"]);
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
          throw Object.assign(new Error('直播间原表尚无独立核验的新基线，写回预览已暂停。'), {status:423,code:'planning_source_unbaselined'});
        } catch (error) {
          return errorResponse(response, error, '生成写回预览失败。');
        }
      }

      if (requestUrl.pathname === '/api/schedule/writeback' && request.method === 'POST') {
        try {
          validateWriteOrigin(request, auth);
          const input = await readJsonBody(request);
          return json(response, await serializePlanningMutation(()=>commitWriteback(input, auth)));
        } catch (error) {
          return errorResponse(response, error, '排班写回失败。');
        }
      }

      if (requestUrl.pathname === '/api/schedule/writeback/audit' && request.method === 'GET') {
        try {
          const items = await readAudit(requestUrl.searchParams.get('limit'));
          const epoch = RECOVERY_READ_ONLY ? null : (await readPlanningEpoch()).epoch;
          return json(response, {items,historyStatus:epoch?.historyStatus || 'pending_recovery',epochId:epoch?.epochId || null});
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
    console.log(FEISHU_APP_ID && FEISHU_APP_SECRET ? '已配置飞书班表凭据；写入另受基线与显式开关控制。' : '请先配置飞书应用凭据。');
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
  alignPlanningRangeRow,
  assertPlanningFormulaRow,
  changedRowRanges,
  fullScheduleRange,
  buildMakeupImportPlan,
  buildWritebackPlan,
  columnName,
  dateMarkerMatches,
  directLocalRequest,
  findDateBlock,
  findDateBlockWithMeta,
  findTimelinePairs,
  getSchedule,
  guardedSheetWrite,
  headerDateKey,
  isOnShift,
  localDateKey,
  longestTimeSlotRun,
  parseRoomSchedule,
  parseMakeupScheduleRows,
  parseScheduleSheets,
  planningReadbackState,
  readPlanningBaselineManifest,
  readPlanningEpoch,
  initializePlanningEpoch,
  writePlanningStore,
  readPlanningImportGuard,
  totalImportCapability,
  reconcilePlanningImport,
  readMakeupSchedule,
  resolveRosterColumns,
  roleMetadata,
  sessionFromAuth,
  shiftFromCell,
  spreadsheetValueRows,
  timeRangeFromCell,
  validateWriteOrigin,
  writePlanningImportGuard,
};
