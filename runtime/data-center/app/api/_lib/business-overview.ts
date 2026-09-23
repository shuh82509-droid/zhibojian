import { getTenantAccessToken } from "./coco";
import { loadFeishuMonthlyProgress } from "./feishu-dashboard-fallback";
import { selectKpiSheet, targetCompletion } from "./kpi-source";

type JsonRecord = Record<string, unknown>;
type TargetMap = Record<string, number>;

const FEISHU_API = "https://open.feishu.cn/open-apis";
const KPI_WIKI_TOKEN = "Lb2vwOidyiViRBkGLIHcfTP5nWe";
const PLAN_WIKI_TOKEN = "IFpowLFu1iiVzZk3kehc4QmUn8b";
const CACHE_MS = 60 * 60 * 1000;
let cache: { key: string; expiresAt: number; value: BusinessOverview } | null = null;

export type BusinessOverview = {
  date: string;
  month: string;
  reports: Array<{ label: string; kind: string; url: string }>;
  targets: Array<{
    code: string; room: string; actual: number | null; target: number | null; completion: number | null; daysFound: number; basis: string;
    daily: Array<{ date: string; gmv: number | null; roi: number | null; conversion: number | null }>;
  }>;
  calendar: Array<{ date: string; room: string; title: string }>;
  concerns: string[];
  sources: { kpi: string; plan: string };
  warnings: string[];
  fetchedAt: string;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function text(value: unknown) { return String(value ?? "").trim(); }

async function feishuGet(path: string) {
  const token = await getTenantAccessToken();
  const response = await fetch(`${FEISHU_API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  const payload = record(await response.json());
  if (!response.ok || Number(payload.code ?? 0) !== 0) throw new Error(text(payload.msg) || `Feishu request failed (${response.status})`);
  return record(payload.data);
}

async function wikiNode(token: string) {
  return record((await feishuGet(`/wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}`)).node);
}

async function readValues(spreadsheet: string, range: string) {
  const query = new URLSearchParams({ valueRenderOption: "ToString", dateTimeRenderOption: "FormattedString" });
  const data = await feishuGet(`/sheets/v2/spreadsheets/${spreadsheet}/values/${encodeURIComponent(range)}?${query}`);
  const values = record(data.valueRange).values;
  return Array.isArray(values) ? values.map((row) => Array.isArray(row) ? row : []) : [];
}

function targetAmount(value: string) {
  const match = value.replace(/\s/g, "").match(/GSV[≥>=]*(\d+(?:\.\d+)?)万/i);
  return match ? Number(match[1]) * 10_000 : 0;
}

async function loadTargets(month: string): Promise<{ amounts: TargetMap; sheetId: string }> {
  const node = await wikiNode(KPI_WIKI_TOKEN);
  if (node.obj_type !== "sheet" || !node.obj_token) throw new Error("KPI目标汇总不是可读取的电子表格");
  const spreadsheet = text(node.obj_token);
  const list = await feishuGet(`/sheets/v3/spreadsheets/${spreadsheet}/sheets/query`);
  const sheets = Array.isArray(list.sheets) ? list.sheets.map(record) : [];
  const sheet = await selectKpiSheet(sheets, month, id => readValues(spreadsheet, `${id}!A1:O1`));
  const rowCount = Number(record(sheet.grid_properties).row_count || sheet.row_count);
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > 2000) throw new Error('目标表行数范围需要核验，不能截取部分目标');
  const rows = await readValues(spreadsheet, `${sheet.sheet_id}!A1:O${rowCount}`);
  const result: TargetMap = {};
  let pendingCode = "";
  rows.forEach((row) => {
    const description = row.map(text).filter(Boolean).join(" ");
    const code = /官旗/.test(description) ? "guanqi"
      : /品牌精选/.test(description) ? "brand-selection"
        : /优选/.test(description) ? "preferred"
          : /视频号渠道|王鸥/.test(description) ? "wangou" : "";
    const amount = targetAmount(description);
    if (amount && code) result[code] = amount;
    if (/直播间退后成交目标/.test(description) && code) pendingCode = code;
    const netTargetWan = Number(text(row[12]).replace(/,/g, ""));
    if (pendingCode && Number.isFinite(netTargetWan) && netTargetWan > 0 && !/目标/.test(text(row[12]))) {
      result[pendingCode] = netTargetWan * 10_000;
      pendingCode = "";
    }
  });
  return { amounts: result, sheetId: text(sheet.sheet_id) };
}

function inlineText(elements: unknown) {
  if (!Array.isArray(elements)) return "";
  return elements.map((element) => {
    const item = record(element);
    const textRun = record(item.text_run);
    const mentionDoc = record(item.mention_doc);
    const mentionUser = record(item.mention_user);
    const file = record(item.file);
    return text(textRun.content || mentionDoc.title || mentionUser.name || file.name);
  }).join("").replace(/\s+/g, " ").trim();
}

function blockOwnText(block: JsonRecord) {
  const keys = ["text", "paragraph", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "heading7", "heading8", "heading9", "bullet", "ordered", "todo", "quote", "callout", "code"];
  for (const key of keys) {
    const value = record(block[key]);
    const result = inlineText(value.elements);
    if (result) return result;
  }
  return "";
}

async function listDocumentBlocks(documentId: string) {
  const blocks: JsonRecord[] = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ page_size: "500", document_revision_id: "-1" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await feishuGet(`/docx/v1/documents/${encodeURIComponent(documentId)}/blocks?${query}`);
    if (Array.isArray(data.items)) blocks.push(...data.items.map(record));
    pageToken = data.has_more ? text(data.page_token) : "";
  } while (pageToken);
  return blocks;
}

function parsePlanningBlocks(blocks: JsonRecord[], documentId: string, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const byId = new Map(blocks.map((block) => [text(block.block_id), block]));
  const root = byId.get(documentId) || blocks.find((block) => Number(block.block_type) === 1) || {};
  const rootChildren = Array.isArray(root.children) ? root.children.map(text) : [];
  const childLines = (blockId: string, visited = new Set<string>()): string[] => {
    if (!blockId || visited.has(blockId)) return [];
    visited.add(blockId);
    const block = byId.get(blockId);
    if (!block) return [];
    const lines = [blockOwnText(block)].filter(Boolean);
    const children = Array.isArray(block.children) ? block.children.map(text) : [];
    children.forEach((child) => lines.push(...childLines(child, visited)));
    return lines;
  };
  const tableMatrix = (block: JsonRecord) => {
    const table = record(block.table);
    const property = record(table.property);
    const columns = Number(property.column_size || 0);
    const cells = Array.isArray(table.cells) ? table.cells.map(text) : [];
    if (!columns || !cells.length) return [] as string[][];
    const matrix: string[][] = [];
    for (let index = 0; index < cells.length; index += columns) {
      matrix.push(cells.slice(index, index + columns).map((cell) => childLines(cell).filter(Boolean).join("\n")));
    }
    return matrix;
  };

  const monthHeading = `${monthNumber}月`;
  const start = rootChildren.findIndex((id) => blockOwnText(byId.get(id) || {}) === monthHeading);
  if (start < 0) throw new Error(`直播月度规划缺少 ${monthHeading} 章节`);
  let end = rootChildren.length;
  for (let index = start + 1; index < rootChildren.length; index += 1) {
    if (/^\d{1,2}月$/.test(blockOwnText(byId.get(rootChildren[index]) || {}))) { end = index; break; }
  }
  const sectionIds = rootChildren.slice(start + 1, end);
  const calendarTableId = [...sectionIds].reverse().find((id) => {
    const matrix = tableMatrix(byId.get(id) || {});
    return matrix.length > 1 && matrix[0].length === 7 && matrix[0].join(" ").includes("星期一") && matrix[0].join(" ").includes("星期日");
  });
  if (!calendarTableId) throw new Error(`${monthHeading} 未找到 7 列直播日历表格`);

  const calendar: BusinessOverview["calendar"] = [];
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  tableMatrix(byId.get(calendarTableId) || {}).slice(1).flat().forEach((cell) => {
    const lines = cell.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    const dayMatch = lines[0]?.match(/^(\d{1,2})(?:日|七夕)?$/);
    if (!dayMatch) return;
    const day = Number(dayMatch[1]);
    if (day < 1 || day > daysInMonth) return;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    lines.slice(1).forEach((line) => {
      const room = /品牌精选/.test(line) ? "品牌精选" : /王鸥|护肤/.test(line) ? "王鸥美肤" : /优选/.test(line) ? "优选" : /官旗/.test(line) ? "官旗" : "直播中心";
      const title = line.replace(/^(官旗|品牌精选|优选|王鸥美肤|王鸥|护肤)\s*[：:]\s*/, "").trim();
      if (title) calendar.push({ date, room, title: title.slice(0, 160) });
    });
  });

  const roomNames = ["官旗", "品牌精选", "优选", "王鸥美肤"] as const;
  const plans = new Map<string, string[]>();
  let currentRoom = "";
  for (const id of sectionIds) {
    if (id === calendarTableId) break;
    const block = byId.get(id) || {};
    const own = blockOwnText(block).replace(/\s+/g, " ").trim();
    if (/^官旗(?:直播间)?$/.test(own)) currentRoom = "官旗";
    else if (/^品牌精选(?:直播间)?$/.test(own)) currentRoom = "品牌精选";
    else if (/^优选(?:直播间)?$/.test(own)) currentRoom = "优选";
    else if (/^(?:王鸥美肤|王鸥美肤直播间|护肤直播间)$/.test(own)) currentRoom = "王鸥美肤";
    const matrix = tableMatrix(block);
    matrix.forEach((row) => {
      const labelIndex = row.findIndex((cell) => /策划思路|月度规划|规划重点/.test(cell));
      if (currentRoom && labelIndex >= 0) {
        const value = row.slice(labelIndex + 1).join(" ").replace(/\s+/g, " ").trim();
        if (value) plans.set(currentRoom, [...(plans.get(currentRoom) || []), value]);
      }
    });
    if (currentRoom && own.length >= 16 && own.length <= 220 && /月初|月中|月底|机制|视觉|活动|人设|点击|转化|专场|规划/.test(own)) {
      plans.set(currentRoom, [...(plans.get(currentRoom) || []), own]);
    }
  }
  const concerns = roomNames.map((room) => {
    const unique = [...new Set(plans.get(room) || [])].slice(0, 2);
    return unique.length ? `${room}：${unique.join("；")}`.slice(0, 320) : "";
  }).filter(Boolean);
  return { calendar: calendar.sort((a, b) => a.date.localeCompare(b.date)), concerns };
}

async function loadPlanning(month: string) {
  const node = await wikiNode(PLAN_WIKI_TOKEN);
  if (node.obj_type !== "docx" || !node.obj_token) throw new Error("直播月度规划不是可读取的飞书文档");
  const documentId = text(node.obj_token);
  return parsePlanningBlocks(await listDocumentBlocks(documentId), documentId, month);
}

export async function loadBusinessOverview(date: string, forceRefresh = false): Promise<BusinessOverview> {
  const month = date.slice(0, 7);
  if (!forceRefresh && cache?.key === date && cache.expiresAt > Date.now()) return cache.value;
  const warnings: string[] = [];
  const [progressResult, targetResult, planningResult] = await Promise.allSettled([
    loadFeishuMonthlyProgress(date, forceRefresh), loadTargets(month), loadPlanning(month),
  ]);
  if (progressResult.status === "rejected") warnings.push(`月度成交：${progressResult.reason?.message || "读取失败"}`);
  if (targetResult.status === "rejected") warnings.push(`月度目标：${targetResult.reason?.message || "读取失败"}`);
  if (planningResult.status === "rejected") warnings.push(`直播日历：${planningResult.reason?.message || "读取失败"}`);
  const progress = progressResult.status === "fulfilled" ? progressResult.value.rooms : [];
  const targets = targetResult.status === "fulfilled" ? targetResult.value.amounts : {};
  const planning = planningResult.status === "fulfilled" ? planningResult.value : { calendar: [], concerns: [] };
  const cumulativeOnlyRooms = progress.filter(item => item.basis === "cumulative_gmv").map(item => item.room);
  if (cumulativeOnlyRooms.length) warnings.push(`${cumulativeOnlyRooms.join("、")}源表未提供独立退款列，当前按源表累计GMV口径展示；与退后成交目标口径不同，暂不计算完成率，未将缺失退款当作 0。`);
  const value: BusinessOverview = {
    date, month,
    reports: [
      { label: "直播中心工作日报", kind: "早报文档", url: "https://jqx28l0j4lx.feishu.cn/wiki/FTFEwNQdEiLfx6kfGnEcPydonmc" },
      { label: "直播中心早报看板", kind: "早报看板", url: "https://jqx28l0j4lx.feishu.cn/page/Tuu7mvfjndE8Nlab0lXc6D7tnMb" },
    ],
    targets: progress.map((item) => {
      const target = targets[item.code] || null;
      return {
        ...item,
        target,
        completion: targetCompletion(item.actual, target, item.basis),
      };
    }),
    calendar: planning.calendar,
    concerns: planning.concerns,
    sources: {
      kpi: "https://jqx28l0j4lx.feishu.cn/wiki/Lb2vwOidyiViRBkGLIHcfTP5nWe" + (targetResult.status === "fulfilled" ? `?sheet=${encodeURIComponent(targetResult.value.sheetId)}` : ""),
      plan: "https://jqx28l0j4lx.feishu.cn/wiki/IFpowLFu1iiVzZk3kehc4QmUn8b",
    },
    warnings,
    fetchedAt: new Date().toISOString(),
  };
  // Failed reads must not pin an empty overview for an hour after source recovery.
  const sourceFailed = [progressResult, targetResult, planningResult].some(result => result.status === "rejected");
  cache = { key: date, value, expiresAt: Date.now() + (sourceFailed ? 10_000 : CACHE_MS) };
  return value;
}
