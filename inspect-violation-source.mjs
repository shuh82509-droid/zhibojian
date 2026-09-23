import { readFile } from "node:fs/promises";

const configPath = "C:/Users/Administrator/AppData/Roaming/FanDo/openclaw/openclaw.json";
const endpoint = "https://cloud.fandow.com/gpt/ai-platform/mcp/data/";
const config = JSON.parse(await readFile(configPath, "utf8"));
const token = config?.mcp?.servers?.["fandow-data-mcp"]?.token;
if (!token) throw new Error("OpenClaw 中未找到 fandow-data-mcp token");

function parse(text) {
  try { return JSON.parse(text); } catch {
    const lines = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
    return JSON.parse(lines.at(-1) || "{}");
  }
}

async function send(body, sessionId = "") {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
  return { payload: parse(await response.text()), sessionId: response.headers.get("Mcp-Session-Id") || sessionId };
}

const initialized = await send({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "live-hub-source-inspector", version: "1.0.0" } },
});
await send({ jsonrpc: "2.0", method: "notifications/initialized" }, initialized.sessionId);
const result = await send({
  jsonrpc: "2.0", id: 2, method: "tools/call",
  params: { name: "search_data_dictionary", arguments: { keyword: "直播间 违规 违规内容 风险等级 主播 处置状态", limit: 50 } },
}, initialized.sessionId);

const content = result.payload?.result?.content;
const textPayload = Array.isArray(content) ? content.find((item) => item?.type === "text")?.text : "";
const data = textPayload ? JSON.parse(textPayload) : result.payload;
const candidates = [];
function visit(value) {
  if (Array.isArray(value)) return value.forEach(visit);
  if (!value || typeof value !== "object") return;
  const table = value.full_table_name || value.table_name || value.table || value.name || "";
  const schema = value.schema_name || value.database_name || value.database || value.schema || "";
  const fields = value.fields || value.columns || value.column_names || value.description || value.comment || "";
  if (/违规|violation|compliance|risk/i.test(JSON.stringify([table, fields]))) candidates.push({ schema, table, fields });
  Object.values(value).forEach(visit);
}
visit(data);
console.log(JSON.stringify({ count: candidates.length, candidates: candidates.slice(0, 30), raw: data }, null, 2).slice(0, 30000));
