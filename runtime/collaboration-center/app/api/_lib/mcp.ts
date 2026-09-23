type JsonRecord = Record<string, unknown>;

const MCP_URL = "https://cloud.fandow.com/gpt/ai-platform/mcp/data/";

function readJson(payload: string): JsonRecord {
  try {
    return JSON.parse(payload) as JsonRecord;
  } catch {
    const dataLines = payload
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    return JSON.parse(dataLines.at(-1) ?? "{}") as JsonRecord;
  }
}

async function send(
  body: JsonRecord,
  token: string,
  sessionId?: string,
): Promise<{ body: JsonRecord; sessionId?: string }> {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`MCP 请求失败：${response.status}`);
  }

  return {
    body: readJson(await response.text()),
    sessionId: response.headers.get("Mcp-Session-Id") ?? sessionId,
  };
}

function toolContent(result: JsonRecord): JsonRecord {
  const content = (result.result as JsonRecord | undefined)?.content;
  if (!Array.isArray(content)) return result;
  const text = content.find(
    (item) => typeof item === "object" && item !== null && (item as JsonRecord).type === "text",
  ) as JsonRecord | undefined;
  if (typeof text?.text !== "string") return result;
  return JSON.parse(text.text) as JsonRecord;
}

function assertToolSuccess(result: JsonRecord): JsonRecord {
  if (result.ok !== false) return result;
  const error = result.error as JsonRecord | undefined;
  const message = typeof error?.message === "string" ? error.message : "数据 MCP 返回失败";
  throw new Error(message);
}

export async function callMcpTool(tool: string, args: JsonRecord) {
  const token = process.env.FANDOW_DATA_MCP_TOKEN;
  if (!token) throw new Error("未配置 FANDOW_DATA_MCP_TOKEN");

  const init = await send(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "wis-live-dashboard", version: "1.0.0" },
      },
    },
    token,
  );

  await send(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    token,
    init.sessionId,
  );

  const response = await send(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: tool, arguments: args },
    },
    token,
    init.sessionId,
  );

  return assertToolSuccess(toolContent(response.body));
}

export function rowsFrom(result: JsonRecord): JsonRecord[] {
  const data = result.data as JsonRecord | undefined;
  return Array.isArray(data?.rows) ? (data.rows as JsonRecord[]) : [];
}
