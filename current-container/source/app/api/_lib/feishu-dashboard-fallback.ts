import { feishuReadJson } from "./coco.ts";

type JsonRecord = Record<string, unknown>;
type SheetRow = unknown[];

export type FallbackSession = {
  id: string;
  key: string;
  shop: string;
  title: string;
  startAt: string;
  durationSeconds: number | null;
  durationBasis?: string;
  watchersStatus?: string;
  status: string;
  gmv: number | null;
  cost: number | null;
  refund: number | null;
  watchers: number | null;
  conversion: number | null;
  online: number | null;
  audience: Array<{ label: string; value: number }>;
  account: { avatarUrl: string; accountName: string };
  platform: string;
  observedAt: string;
};

type TrendPoint = { hour: string; gmv: number | null; roi: number | null; conversion: number | null };
type TrafficPoint = { label: string; value: number | null; color: string };
export type AnchorTrendPoint = {
  date: string;
  gmv: number;
  roi: number;
  conversion: number | null;
  hours: number;
};

type Source = {
  code: string;
  shop: string;
  room: string;
  platform: string;
  sheetId: string;
  maxColumn: string;
  columns: {
    cumulativeGmv: number;
    cumulativeCost: number;
    cumulativeRefund?: number;
    halfHourGmv?: number;
    halfHourCost?: number;
    watchers?: number;
    conversion?: number;
    online?: number;
    liveRecommendation?: number;
    shortVideo?: number;
  };
};

const FEISHU_API = "https://open.feishu.cn/open-apis";
const ROOT_SPREADSHEET = "YB0osgtwbhvUdutIiJQcy2Elnmg";
const VIDEO_WIKI_TOKEN = "VvyAwiXd7ifxcTkoiaLcSU9BnjT";
const CACHE_MS = 60 * 60 * 1000;
let videoSpreadsheetToken = "";
const sources: Source[] = [
  {
    code: "guanqi",
    shop: "WIS官方旗舰店",
    room: "官旗",
    platform: "抖音",
    sheetId: "pIennk",
    maxColumn: "U",
    columns: { cumulativeGmv: 3, cumulativeCost: 4, cumulativeRefund: 5, halfHourGmv: 6, halfHourCost: 7, watchers: 9, conversion: 14, online: 12, liveRecommendation: 16, shortVideo: 17 },
  },
  {
    code: "brand-selection",
    shop: "WIS官方旗舰店甄选",
    room: "品牌精选",
    platform: "抖音",
    sheetId: "BOjfJg",
    maxColumn: "Z",
    columns: { cumulativeGmv: 3, cumulativeCost: 4, halfHourGmv: 5, halfHourCost: 6, conversion: 13, online: 10, shortVideo: 15 },
  },
  {
    code: "preferred",
    shop: "WIS官方旗舰店优选",
    room: "优选",
    platform: "抖音",
    sheetId: "l5eJH0",
    maxColumn: "AO",
    columns: { cumulativeGmv: 3, cumulativeCost: 4, halfHourGmv: 6, halfHourCost: 5, watchers: 16, conversion: 10, online: 12 },
  },
  {
    code: "wangou",
    shop: "WIS燕窝面膜护肤店",
    room: "王鸥美肤",
    platform: "视频号",
    sheetId: "XAElcN",
    maxColumn: "W",
    columns: { cumulativeGmv: 3, cumulativeCost: 4, cumulativeRefund: 5, halfHourGmv: 6, halfHourCost: 7, watchers: 9, conversion: 11, online: 12, liveRecommendation: 15, shortVideo: 16 },
  },
];

const cache = new Map<string, { expiresAt: number; value: FeishuDashboardFallback }>();
const anchorTrendCache = new Map<string, { expiresAt: number; value: FeishuAnchorTrends }>();
const monthlyProgressCache = new Map<string, { expiresAt: number; value: FeishuMonthlyProgress }>();
const resolvedSourceCache = new Map<string, Promise<Source>>();
const sourceDateColumnCache = new Map<string, { expiresAt: number; rows: SheetRow[] }>();

export type FeishuDashboardFallback = {
  sessions: FallbackSession[];
  recentSessions: FallbackSession[];
  trafficBySession: Record<string, TrafficPoint[]>;
  trendBySession: Record<string, TrendPoint[]>;
  sourceStatus: Record<string, { found: boolean; firstRow: number | null; lastRow: number | null }>;
};

export type FeishuAnchorTrends = {
  startDate: string;
  endDate: string;
  days: number;
  series: Record<string, AnchorTrendPoint[]>;
  sourceStatus: Record<string, { datesFound: number; firstRow: number | null; lastRow: number | null }>;
  fetchedAt: string;
};

export type FeishuMonthlyProgress = {
  month: string;
  throughDate: string;
  rooms: Array<{
    code: string;
    shop: string;
    room: string;
    actual: number | null;
    daysFound: number;
    basis: "gmv_minus_refund" | "cumulative_gmv" | "daily_channel_net";
    daily: Array<{ date: string; gmv: number | null; roi: number | null; conversion: number | null }>;
  }>;
  fetchedAt: string;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object") {
    const source = value as JsonRecord;
    return text(source.text ?? source.value ?? "");
  }
  return String(value ?? "").trim();
}

function number(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(text(value).replace(/[¥￥,%\s,]/g, "").replace(/万$/, ""));
  if (!Number.isFinite(parsed)) return 0;
  return /万\s*$/.test(text(value)) ? parsed * 10_000 : parsed;
}

function optionalNumber(value: unknown): number | null {
  const raw = text(value);
  if (!raw || /^#/.test(raw)) return null;
  const numeric = raw.replace(/[¥￥,%\s,]/g, "").replace(/万$/, "");
  if (!numeric) return null;
  const parsed = Number(numeric) * (/万\s*$/.test(raw) ? 10_000 : 1);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value: unknown) {
  const raw = text(value);
  const parsed = number(value);
  if (!parsed) return 0;
  return raw.includes("%") || Math.abs(parsed) > 1 ? parsed : parsed * 100;
}

function optionalPercent(value: unknown): number | null {
  const raw = text(value);
  const parsed = optionalNumber(value);
  return parsed === null ? null : raw.includes("%") || Math.abs(parsed) > 1 ? parsed : parsed * 100;
}

function dateKey(value: unknown, yearHint: number) {
  if (typeof value === "number" && value > 20_000 && value < 80_000) {
    return new Date(Math.round((value - 25_569) * 86_400_000)).toISOString().slice(0, 10);
  }
  const raw = text(value);
  let match = raw.match(/(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  match = raw.match(/(\d{1,2})月(\d{1,2})日/);
  return match ? `${yearHint}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : "";
}

function timeRange(value: unknown) {
  const match = text(value).replace(/[：.]/g, ":").replace(/[～~—至]/g, "-")
    .match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const start = `${match[1].padStart(2, "0")}:${match[2]}`;
  const end = `${match[3].padStart(2, "0")}:${match[4]}`;
  return [start, end] as const;
}

function minutes(value: string) {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

function lastValue(rows: SheetRow[], column: number | undefined) {
  if (column === undefined) return null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const raw = rows[index]?.[column];
    if (text(raw) && !/^#/.test(text(raw))) return optionalNumber(raw);
  }
  return null;
}

function lastPercent(rows: SheetRow[], column: number | undefined) {
  if (column === undefined) return null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const raw = rows[index]?.[column];
    if (text(raw) && !/^#/.test(text(raw))) return optionalPercent(raw);
  }
  return null;
}

async function feishuGet(path: string) {
  const payload = await feishuReadJson(path);
  return record(payload.data);
}

async function readValues(range: string, spreadsheet = ROOT_SPREADSHEET) {
  const query = new URLSearchParams({ valueRenderOption: "ToString", dateTimeRenderOption: "FormattedString" });
  const path = `/sheets/v2/spreadsheets/${spreadsheet}/values/${encodeURIComponent(range)}?${query.toString()}`;
  const data = await feishuGet(path);
  const rows = record(data.valueRange).values;
  return Array.isArray(rows) ? rows.map((row) => Array.isArray(row) ? row : []) : [];
}

function normalizedHeader(value: unknown) {
  return text(value).replace(/[\s_（）()【】\[\]：:·]/g, "").toLowerCase();
}

function findHeaderColumn(rows: SheetRow[], patterns: RegExp[], exclusions: RegExp[] = []) {
  const matches: Array<{ column: number; score: number }> = [];
  rows.forEach((row) => row.forEach((cell, column) => {
    const header = normalizedHeader(cell);
    if (!header || exclusions.some((pattern) => pattern.test(header))) return;
    const score = patterns.findIndex((pattern) => pattern.test(header));
    if (score >= 0) matches.push({ column, score });
  }));
  matches.sort((left, right) => left.score - right.score || left.column - right.column);
  return matches[0]?.column;
}

async function resolveSourceColumns(source: Source): Promise<Source> {
  const existing = resolvedSourceCache.get(source.code);
  if (existing) return existing;
  const resolving = (async () => {
    try {
      const rows = await readValues(`${source.sheetId}!A1:${source.maxColumn}120`);
      const resolved = {
        cumulativeGmv: findHeaderColumn(rows, [/^累计(?:gmv|gsv)$/, /^累计成交(?:金额)?$/, /累计.*(?:gmv|gsv|成交)/]) ?? source.columns.cumulativeGmv,
        cumulativeCost: findHeaderColumn(rows, [/^累计(?:消耗|投放|广告消耗)$/, /累计.*(?:消耗|投放)/]) ?? source.columns.cumulativeCost,
        cumulativeRefund: findHeaderColumn(rows, [/^(?:累计)?退款(?:金额)?$/, /退款.*金额/]) ?? source.columns.cumulativeRefund,
        halfHourGmv: findHeaderColumn(rows, [/^(?:半小时|时段|本时段).*(?:gmv|gsv|成交)/, /(?:gmv|gsv|成交).*(?:半小时|时段)/]) ?? source.columns.halfHourGmv,
        halfHourCost: findHeaderColumn(rows, [/^(?:半小时|时段|本时段).*(?:消耗|投放)/, /(?:消耗|投放).*(?:半小时|时段)/]) ?? source.columns.halfHourCost,
        watchers: findHeaderColumn(rows, [/^(?:观看人数|进房人数|累计观看人数)$/, /(?:观看|进房).*人数/], [/转化|占比|率/]) ?? source.columns.watchers,
        conversion: findHeaderColumn(rows, [/^观看.*成交.*转化率$/, /^进房.*成交.*转化率$/, /^成交转化率$/, /观看.*成交/], [/点击|二跳|涨幅|环比/]) ?? source.columns.conversion,
        online: findHeaderColumn(rows, [/^在线人数$/, /在线.*人数/]) ?? source.columns.online,
        liveRecommendation: findHeaderColumn(rows, [/直播推荐.*占比/, /直播推荐/], [/成交|涨幅/]) ?? source.columns.liveRecommendation,
        shortVideo: findHeaderColumn(rows, [/短视频.*占比/, /^短视频$/], [/成交|涨幅/]) ?? source.columns.shortVideo,
      };
      return { ...source, columns: resolved };
    } catch {
      return source;
    }
  })();
  resolvedSourceCache.set(source.code, resolving);
  return resolving;
}

async function getVideoSpreadsheetToken() {
  if (videoSpreadsheetToken) return videoSpreadsheetToken;
  const node = record((await feishuGet(`/wiki/v2/spaces/get_node?token=${VIDEO_WIKI_TOKEN}`)).node);
  if (text(node.obj_type) !== "sheet" || !text(node.obj_token)) throw new Error("视频号渠道根数据节点不可用");
  videoSpreadsheetToken = text(node.obj_token);
  return videoSpreadsheetToken;
}

async function videoDailyRows() {
  return readValues("ULkveo!A:W", await getVideoSpreadsheetToken());
}

function videoDailySession(source: Source, requestedDate: string, rows: SheetRow[]) {
  const year = Number(requestedDate.slice(0, 4));
  const matches = rows.filter((row) => dateKey(row[0], year) === requestedDate);
  if (!matches.length) return null;
  const row = matches.at(-1)!;
  const id = `${source.code}-video-daily-${requestedDate}`;
  const gmv = optionalNumber(row[6]); // G: WIS护肤推荐（王鸥美肤）
  return {
    id, key: `${source.shop}|${id}`, shop: source.shop,
    title: `${source.room} ${requestedDate} 视频号场次汇总`,
    startAt: `${requestedDate}T00:00:00+08:00`, durationSeconds: null,
    durationBasis: "日汇总未返回上播时长",
    status: "ended", gmv, cost: null, refund: null, watchers: null, conversion: null, online: null,
    audience: [], account: { avatarUrl: "", accountName: source.shop }, platform: source.platform,
    observedAt: new Date().toISOString(),
  } satisfies FallbackSession;
}

async function rowsForDate(source: Source, requestedDate: string) {
  const range = await findDateRange(source, requestedDate);
  if (!range) return { rows: [] as SheetRow[], firstRow: null, lastRow: null };
  const { firstRow, lastRow } = range;
  const rows = await readValues(`${source.sheetId}!A${firstRow}:${source.maxColumn}${lastRow}`);
  return { rows, firstRow, lastRow };
}

function dateCellKey(value: unknown, yearHint: number) {
  const parsed = dateKey(value, yearHint);
  if (parsed) return parsed;
  const raw = text(value);
  const match = raw.match(/(^|\D)(\d{1,2})[\/.-](\d{1,2})(\D|$)/);
  return match ? `${yearHint}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
}

async function sourceDateColumn(source: Source) {
  const cached = sourceDateColumnCache.get(source.code);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const rows = await readValues(`${source.sheetId}!A:A`);
  sourceDateColumnCache.set(source.code, { rows, expiresAt: Date.now() + CACHE_MS });
  return rows;
}

async function findDateRange(source: Source, requestedDate: string) {
  const year = Number(requestedDate.slice(0, 4));
  const rows = await sourceDateColumn(source);
  const keys = rows.map((row) => dateCellKey(row[0], year));
  const matches = keys.map((key, index) => key === requestedDate ? index : -1).filter((index) => index >= 0);
  if (!matches.length) return null;

  // The same month/day can occur in historical blocks. Always anchor on the
  // last matching row, then expand to the surrounding date block. Blank cells
  // are included because merged date cells often leave subsequent rows empty.
  const anchor = matches.at(-1)!;
  let first = anchor;
  for (let index = anchor - 1; index >= 0; index -= 1) {
    if (keys[index] && keys[index] !== requestedDate) break;
    if (keys[index] === requestedDate) first = index;
  }
  let endExclusive = rows.length;
  for (let index = anchor + 1; index < rows.length; index += 1) {
    if (keys[index] && keys[index] !== requestedDate) { endExclusive = index; break; }
  }
  return { firstRow: first + 1, lastRow: Math.max(first + 1, endExclusive) };
}

function dateKeysEndingAt(endDate: string, days: number) {
  const result: string[] = [];
  const end = new Date(`${endDate}T12:00:00+08:00`);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const value = new Date(end.getTime() - offset * 86_400_000);
    result.push(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(value));
  }
  return result;
}

function anchorName(value: unknown) {
  const valueText = text(value).replace(/（.*?）|\(.*?\)/g, "").trim();
  if (!valueText || /^(主播|助理|姓名|时间|不断播|暂无|无|合计)$/.test(valueText)) return "";
  return valueText;
}

function anchorDayMetrics(rows: SheetRow[], source: Source) {
  const result = new Map<string, { gmv: number; cost: number; conversion: number | null; hours: number }>();
  let currentAnchor = "";
  rows.forEach((row) => {
    const range = timeRange(row[1]);
    const explicitAnchor = anchorName(row[2]);
    if (explicitAnchor) currentAnchor = explicitAnchor;
    if (!range || !currentAnchor) return;
    const current = result.get(currentAnchor) ?? { gmv: 0, cost: 0, conversion: null, hours: 0 };
    const gmv = source.columns.halfHourGmv === undefined ? 0 : number(row[source.columns.halfHourGmv]);
    const cost = source.columns.halfHourCost === undefined ? 0 : number(row[source.columns.halfHourCost]);
    const durationMinutes = (minutes(range[1]) - minutes(range[0]) + 24 * 60) % (24 * 60);
    current.gmv += Math.max(0, gmv);
    current.cost += Math.max(0, cost);
    current.hours += Math.min(12 * 60, durationMinutes || 30) / 60;
    const conversion = optionalPercent(row[source.columns.conversion ?? -1]);
    if (conversion !== null) current.conversion = conversion;
    result.set(currentAnchor, current);
  });
  return result;
}

export function parseAnchorTrendRows(sourceCode: string, date: string, rows: SheetRow[]) {
  const source = sources.find((item) => item.code === sourceCode);
  if (!source) throw new Error(`Unknown Feishu dashboard source: ${sourceCode}`);
  return [...anchorDayMetrics(rows, source)].map(([name, metrics]) => ({
    name,
    point: {
      date,
      gmv: Number(metrics.gmv.toFixed(2)),
      roi: metrics.cost > 0 ? Number((metrics.gmv / metrics.cost).toFixed(2)) : 0,
      conversion: metrics.conversion === null ? null : Number(metrics.conversion.toFixed(2)),
      hours: Number(metrics.hours.toFixed(2)),
    } satisfies AnchorTrendPoint,
  }));
}

// A pre-filled difference formula is not evidence that a scheduled interval aired.
// Resolve midnight rollover before applying the current Shanghai-time boundary.
function observedIntervals(rows: SheetRow[], source: Source, date: string, now: Date) {
  const midnight = Date.parse(`${date}T00:00:00+08:00`);
  let dayOffset = 0, previousStart = -1;
  return rows.flatMap(row => {
    const range = timeRange(row[1]);
    if (!range) return [];
    const startMinute = minutes(range[0]), endMinute = minutes(range[1]);
    if (startMinute < previousStart) dayOffset += 1440;
    previousStart = startMinute;
    const start = midnight + (dayOffset + startMinute) * 60_000;
    const end = midnight + (dayOffset + endMinute + (endMinute <= startMinute ? 1440 : 0)) * 60_000;
    const cumulative = optionalNumber(row[source.columns.cumulativeGmv]);
    const cumulativeCost = optionalNumber(row[source.columns.cumulativeCost]);
    const delta = optionalNumber(row[source.columns.halfHourGmv ?? -1]);
    const deltaCost = optionalNumber(row[source.columns.halfHourCost ?? -1]);
    const reported = cumulative !== null || cumulativeCost !== null || (delta !== null && delta > 0) || (deltaCost !== null && deltaCost > 0);
    return [{ row, range, start, end: Math.min(end, now.getTime()), observed: start < now.getTime() && reported,
      hour: `${dayOffset ? '次日 ' : ''}${range[0].slice(0, 2)}:00` }];
  });
}

function hourlyTrend(rows: SheetRow[], source: Source, date: string, now: Date): TrendPoint[] {
  const groups = new Map<string, {
    gmv: number;
    cost: number;
    conversion: number | null;
    hasGmv: boolean;
    hasCost: boolean;
  }>();
  let previousCumulative = 0;
  observedIntervals(rows, source, date, now).forEach(({row, hour: label, observed}) => {
    if (!groups.has(label)) groups.set(label, {gmv:0,cost:0,conversion:null,hasGmv:false,hasCost:false});
    if (!observed) return;
    const cumulative = optionalNumber(row[source.columns.cumulativeGmv]);
    const rawGmv = source.columns.halfHourGmv === undefined
      ? cumulative === null ? null : Math.max(0, cumulative - previousCumulative)
      : optionalNumber(row[source.columns.halfHourGmv]);
    const halfHourGmv = rawGmv !== null && rawGmv >= 0 && (rawGmv > 0 || cumulative !== null) ? rawGmv : null;
    const rawCost = source.columns.halfHourCost === undefined
      ? null
      : optionalNumber(row[source.columns.halfHourCost]);
    const halfHourCost = rawCost !== null && rawCost >= 0 && (rawCost > 0 || optionalNumber(row[source.columns.cumulativeCost]) !== null) ? rawCost : null;
    const conversion = optionalPercent(row[source.columns.conversion ?? -1]);
    if (cumulative === null && halfHourGmv === null && halfHourCost === null && conversion === null) return;
    if (cumulative !== null) previousCumulative = Math.max(previousCumulative, cumulative);
    const current = groups.get(label) ?? {
      gmv: 0,
      cost: 0,
      conversion: null,
      hasGmv: false,
      hasCost: false,
    };
    if (halfHourGmv !== null) {
      current.gmv += Math.max(0, halfHourGmv);
      current.hasGmv = true;
    }
    if (halfHourCost !== null) {
      current.cost += Math.max(0, halfHourCost);
      current.hasCost = true;
    }
    if (conversion !== null) current.conversion = conversion;
    groups.set(label, current);
  });
  return [...groups.entries()].map(([hour, value]) => ({
    hour,
    gmv: value.hasGmv ? value.gmv : null,
    roi: value.hasGmv && value.hasCost && value.cost > 0 ? value.gmv / value.cost : null,
    conversion: value.conversion,
  }));
}

function traffic(rows: SheetRow[], source: Source): TrafficPoint[] {
  const shortVideoValue = lastPercent(rows, source.columns.shortVideo);
  const liveRecommendationValue = lastPercent(rows, source.columns.liveRecommendation);
  const shortVideo = shortVideoValue === null ? null : Math.max(0, Math.min(100, shortVideoValue));
  const liveRecommendation = liveRecommendationValue === null
    ? null
    : Math.max(0, Math.min(100 - (shortVideo ?? 0), liveRecommendationValue));
  return [
    { label: "自然推荐", value: liveRecommendation, color: "#17694f" },
    { label: "付费推广", value: null, color: "#3e8f72" },
    { label: "短视频引流", value: shortVideo, color: "#d7f15b" },
    { label: "粉丝关注", value: null, color: "#8aa68f" },
    { label: "同城", value: null, color: "#e7b56c" },
    { label: "分享/私域", value: null, color: "#b798d3" },
    {
      label: "其他",
      value: shortVideo === null || liveRecommendation === null ? null : Math.max(0, 100 - shortVideo - liveRecommendation),
      color: "#dfe7e2",
    },
  ];
}

function makeSession(source: Source, requestedDate: string, rows: SheetRow[], now = new Date()): FallbackSession {
  const intervals = observedIntervals(rows, source, requestedDate, now).filter(item => item.observed);
  const observedRows = intervals.map(item => item.row);
  const first = intervals[0]?.range ?? ["00:00", "00:00"];
  let durationMs = 0, previousEnd = 0;
  for (const interval of intervals) {
    durationMs += Math.max(0, interval.end - Math.max(interval.start, previousEnd));
    previousEnd = Math.max(previousEnd, interval.end);
  }
  const rawWatchers = lastValue(observedRows, source.columns.watchers);
  const watchers = rawWatchers !== null && Number.isSafeInteger(rawWatchers) && rawWatchers >= 0 ? rawWatchers : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  const id = `${source.code}-${requestedDate}`;
  return {
    id,
    key: `${source.shop}|${id}`,
    shop: source.shop,
    title: `${source.room} ${requestedDate} 直播场次`,
    startAt: `${requestedDate}T${first[0]}:00+08:00`,
    durationSeconds: intervals.length ? Math.floor(durationMs / 1000) : null,
    durationBasis: "已回传时段累计（非平台精确时长）",
    status: requestedDate === today ? "live" : "ended",
    gmv: lastValue(observedRows, source.columns.cumulativeGmv),
    cost: lastValue(observedRows, source.columns.cumulativeCost),
    refund: lastValue(observedRows, source.columns.cumulativeRefund),
    watchers,
    watchersStatus: rawWatchers !== null && watchers === null ? "人数单位待核验" : watchers === null ? "待接入" : "已核验",
    conversion: lastPercent(observedRows, source.columns.conversion),
    online: lastValue(observedRows, source.columns.online),
    audience: [],
    account: { avatarUrl: "", accountName: source.shop },
    platform: source.platform,
    observedAt: new Date().toISOString(),
  };
}

export function parseFeishuDashboardRows(sourceCode: string, requestedDate: string, rows: SheetRow[], now = new Date(), resolvedSource?: Source) {
  const source = resolvedSource ?? sources.find((item) => item.code === sourceCode);
  if (!source) throw new Error(`Unknown Feishu dashboard source: ${sourceCode}`);
  const session = makeSession(source, requestedDate, rows, now);
  return { session, traffic: traffic(rows, source), trend: hourlyTrend(rows, source, requestedDate, now) };
}

async function recentFallbackSessions(source: Source, endDate: string) {
  const dates = dateKeysEndingAt(endDate, 15);
  const candidates: Array<{ date: string; range: { firstRow: number; lastRow: number } | null }> = [];
  for (const date of dates) candidates.push({ date, range: await findDateRange(source, date) });
  const ranges = candidates.filter((entry): entry is { date: string; range: { firstRow: number; lastRow: number } } => Boolean(entry.range));
  if (!ranges.length) return [] as FallbackSession[];
  const firstRow = Math.min(...ranges.map((entry) => entry.range.firstRow));
  const lastRow = Math.max(...ranges.map((entry) => entry.range.lastRow));
  const windowRows = await readValues(`${source.sheetId}!A${firstRow}:${source.maxColumn}${lastRow}`);
  return ranges.map(({ date, range }) => makeSession(
    source,
    date,
    windowRows.slice(range.firstRow - firstRow, range.lastRow - firstRow + 1),
  )).sort((left, right) => right.startAt.localeCompare(left.startAt));
}

export async function loadFeishuDashboardFallback(requestedDate: string, forceRefresh = false): Promise<FeishuDashboardFallback> {
  const cached = cache.get(requestedDate);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;

  const entries = await Promise.all(sources.map(async (configuredSource) => {
    const source = await resolveSourceColumns(configuredSource);
    return { source, ...(await rowsForDate(source, requestedDate)) };
  }));
  const sessions: FallbackSession[] = [];
  const trafficBySession: Record<string, TrafficPoint[]> = {};
  const trendBySession: Record<string, TrendPoint[]> = {};
  const sourceStatus: FeishuDashboardFallback["sourceStatus"] = {};
  entries.forEach(({ source, rows, firstRow, lastRow }) => {
    sourceStatus[source.code] = { found: rows.length > 0, firstRow, lastRow };
    if (!rows.length) return;
    const parsed = parseFeishuDashboardRows(source.code, requestedDate, rows, new Date(), source);
    const session = parsed.session;
    sessions.push(session);
    trafficBySession[session.key] = parsed.traffic;
    trendBySession[session.key] = parsed.trend;
  });
  if (!sessions.some((session) => session.shop === "WIS燕窝面膜护肤店")) {
    const source = sources.find((item) => item.code === "wangou")!;
    const daily = videoDailySession(source, requestedDate, await videoDailyRows());
    if (daily) {
      sessions.push(daily);
      trafficBySession[daily.key] = traffic([], source);
      trendBySession[daily.key] = [];
      sourceStatus.wangou = { found: true, firstRow: null, lastRow: null };
    }
  }

    const recentGroups = await Promise.all(entries.map(({ source }) => recentFallbackSessions(source, requestedDate)));
    const recentSessions = recentGroups.flat();
    if (!recentSessions.some((session) => session.shop === "WIS燕窝面膜护肤店")) {
      const source = sources.find((item) => item.code === "wangou")!;
      const rows = await videoDailyRows();
      dateKeysEndingAt(requestedDate, 15).forEach((date) => {
        const daily = videoDailySession(source, date, rows);
        if (daily) recentSessions.push(daily);
      });
    }

    const value = { sessions, recentSessions, trafficBySession, trendBySession, sourceStatus };
  cache.set(requestedDate, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

export async function loadFeishuAnchorTrends(endDate: string, days = 14, forceRefresh = false): Promise<FeishuAnchorTrends> {
  const safeDays = Math.max(1, Math.min(62, Math.round(days || 14)));
  const cacheKey = `${endDate}:${safeDays}`;
  const cached = anchorTrendCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;

  const dates = dateKeysEndingAt(endDate, safeDays);
  const series: Record<string, AnchorTrendPoint[]> = {};
  const sourceStatus: FeishuAnchorTrends["sourceStatus"] = {};

  await Promise.all(sources.map(async (configuredSource) => {
    const source = await resolveSourceColumns(configuredSource);
    const rangeCandidates: Array<{ date: string; range: { firstRow: number; lastRow: number } | null }> = [];
    for (const date of dates) rangeCandidates.push({ date, range: await findDateRange(source, date) });
    const ranges = rangeCandidates.filter((entry): entry is { date: string; range: { firstRow: number; lastRow: number } } => Boolean(entry.range));
    sourceStatus[source.code] = {
      datesFound: ranges.length,
      firstRow: ranges.length ? Math.min(...ranges.map((entry) => entry.range.firstRow)) : null,
      lastRow: ranges.length ? Math.max(...ranges.map((entry) => entry.range.lastRow)) : null,
    };
    if (!ranges.length) return;

    const firstRow = sourceStatus[source.code].firstRow!;
    const lastRow = sourceStatus[source.code].lastRow!;
    const windowRows = await readValues(`${source.sheetId}!A${firstRow}:${source.maxColumn}${lastRow}`);
    ranges.forEach(({ date, range }) => {
      const rows = windowRows.slice(range.firstRow - firstRow, range.lastRow - firstRow + 1);
      parseAnchorTrendRows(source.code, date, rows).forEach(({ name, point }) => {
        const points = series[name] ?? [];
        points.push(point);
        series[name] = points;
      });
    });
  }));

  Object.values(series).forEach((points) => points.sort((left, right) => left.date.localeCompare(right.date)));
  const value = {
    startDate: dates[0],
    endDate: dates.at(-1)!,
    days: safeDays,
    series,
    sourceStatus,
    fetchedAt: new Date().toISOString(),
  };
  anchorTrendCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

export async function loadFeishuMonthlyProgress(endDate: string, forceRefresh = false): Promise<FeishuMonthlyProgress> {
  const month = endDate.slice(0, 7);
  const cached = monthlyProgressCache.get(endDate);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const endDay = Number(endDate.slice(8, 10));
  const dates = Array.from({ length: endDay }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);

  const rooms = await Promise.all(sources.map(async (configuredSource) => {
    const source = await resolveSourceColumns(configuredSource);
    if (source.code === "wangou") {
      const rows = await videoDailyRows();
      const year = Number(endDate.slice(0, 4));
      const matched = rows.filter((row) => {
        const key = dateKey(row[0], year);
        return key >= `${month}-01` && key <= endDate;
      });
      // H is the video-channel daily total and matches the channel-level KPI.
      const verified = matched.map((row) => optionalNumber(row[7])).filter((value): value is number => value !== null);
      const actual = verified.length ? verified.reduce((sum, value) => sum + Math.max(0, value), 0) : null;
      const daily = matched.map((row) => ({
        date: dateKey(row[0], year),
        gmv: optionalNumber(row[7]),
        roi: null,
        conversion: null,
      })).filter((item) => item.date).sort((left, right) => left.date.localeCompare(right.date));
      return {
        code: source.code, shop: source.shop, room: source.room,
        actual: actual === null ? null : Number(actual.toFixed(2)), daysFound: verified.length, basis: "daily_channel_net" as const, daily,
      };
    }
    const rangeCandidates: Array<{ date: string; range: { firstRow: number; lastRow: number } | null }> = [];
    for (const date of dates) rangeCandidates.push({ date, range: await findDateRange(source, date) });
    const ranges = rangeCandidates.filter((entry): entry is { date: string; range: { firstRow: number; lastRow: number } } => Boolean(entry.range));
    const hasRefundColumn = source.columns.cumulativeRefund !== undefined;
    const basis = hasRefundColumn ? "gmv_minus_refund" as const : "cumulative_gmv" as const;
    if (!ranges.length) return { code: source.code, shop: source.shop, room: source.room, actual: null, daysFound: 0, basis, daily: [] };
    const firstRow = Math.min(...ranges.map((entry) => entry.range.firstRow));
    const lastRow = Math.max(...ranges.map((entry) => entry.range.lastRow));
    const windowRows = await readValues(`${source.sheetId}!A${firstRow}:${source.maxColumn}${lastRow}`);
    let actual = 0;
    let verifiedDays = 0;
    const daily: FeishuMonthlyProgress["rooms"][number]["daily"] = [];
    ranges.forEach(({ date, range }) => {
      const rows = windowRows.slice(range.firstRow - firstRow, range.lastRow - firstRow + 1);
      const session = makeSession(source, date, rows);
      daily.push({
        date,
        gmv: session.gmv,
        roi: session.gmv !== null && session.cost !== null && session.cost > 0 ? Number((session.gmv / session.cost).toFixed(2)) : null,
        conversion: session.conversion,
      });
      if (session.gmv === null || (hasRefundColumn && session.refund === null)) return;
      actual += Math.max(0, hasRefundColumn ? session.gmv - (session.refund ?? 0) : session.gmv);
      verifiedDays += 1;
    });
    return {
      code: source.code, shop: source.shop, room: source.room,
      actual: verifiedDays ? Number(actual.toFixed(2)) : null, daysFound: verifiedDays, basis, daily,
    };
  }));

  const value = { month, throughDate: endDate, rooms, fetchedAt: new Date().toISOString() };
  monthlyProgressCache.set(endDate, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}
