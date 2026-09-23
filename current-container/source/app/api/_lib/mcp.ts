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
    signal: AbortSignal.timeout(9000),
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
  if (result.error && result.jsonrpc) throw new Error(String((result.error as JsonRecord).message || '数据 MCP 请求失败'));
  if (result.ok !== false) return result;
  const error = result.error as JsonRecord | undefined;
  const message = typeof error?.message === "string" ? error.message : "数据 MCP 返回失败";
  throw new Error(message);
}

async function callOnce(tool: string, args: JsonRecord) {
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

async function callWithTransientRetry(tool: string, args: JsonRecord) {
  try {
    return await callOnce(tool, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/公司身份服务请求超时|MCP 请求失败：(?:429|5\d\d)|\btimeout\b|timed out/i.test(message)) throw error;
    return callOnce(tool, args);
  }
}

// Avoid overwhelming the company identity service when one page requests seven
// datasets. Only successful results are cached; failed access is never bypassed.
let activeCalls = 0;
const MAX_ACTIVE_CALLS = 2;
const QUEUE_TIMEOUT_MS = 10000;
const AUTH_BLOCK_MS = 60000;
let sourceBlock: { at: number; message: string } | null = null;
const waiters: Array<() => void> = [];
const pending = new Map<string, Promise<JsonRecord>>();
const cached = new Map<string, { at: number; value: JsonRecord }>();
async function acquire() {
  if (activeCalls < MAX_ACTIVE_CALLS) { activeCalls++; return; }
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const enter = () => { clearTimeout(timer); resolve(); };
    waiters.push(enter);
    timer = setTimeout(() => {
      const index = waiters.indexOf(enter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error("公司数据服务排队超时，可稍后刷新"));
    }, QUEUE_TIMEOUT_MS);
  });
}
function release() {
  const next=waiters.shift();
  if(next)next();else activeCalls--;
}
export function sourceFailureMessage(message: string): string {
  if (/登录状态无效|授权.*失效|未授权|401|403|token.*expired/i.test(message)) return "实时数据源授权已失效，需重新授权";
  if (/超时|timeout|timed out/i.test(message)) return "公司数据服务暂时超时，可稍后刷新";
  return "实时数据源暂不可用，可稍后刷新";
}
function isSourceAuthFailure(message: string) {
  return /登录状态无效|授权.*失效|未授权|401|403|token.*expired/i.test(message);
}
export async function callMcpTool(tool: string, args: JsonRecord): Promise<JsonRecord> {
  if (sourceBlock && Date.now() - sourceBlock.at < AUTH_BLOCK_MS) throw new Error(sourceBlock.message);
  const key=tool+JSON.stringify(args);
  const hit=cached.get(key);
  if(hit&&Date.now()-hit.at<300000)return hit.value;
  if(pending.has(key))return pending.get(key)!;
  const work=(async()=>{
    await acquire();
    try {
      if (sourceBlock && Date.now() - sourceBlock.at < AUTH_BLOCK_MS) throw new Error(sourceBlock.message);
      try {
        const value=await callWithTransientRetry(tool,args);
        sourceBlock=null;
        if(cached.size>=100)cached.delete(cached.keys().next().value!);
        cached.set(key,{at:Date.now(),value});
        return value;
      } catch(error) {
        const message=error instanceof Error?error.message:String(error);
        if(isSourceAuthFailure(message)) sourceBlock={at:Date.now(),message};
        throw error;
      }
    }finally{release()}
  })();
  pending.set(key,work);
  try{return await work}finally{pending.delete(key)}
}

export function rowsFrom(result: JsonRecord): JsonRecord[] {
  const data = result.data as JsonRecord | undefined;
  return Array.isArray(data?.rows) ? (data.rows as JsonRecord[]) : [];
}
