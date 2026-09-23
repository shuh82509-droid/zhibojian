export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type JsonRecord = Record<string, unknown>;
type Chat = { chatId: string; name: string };
export type ChatMessage = {
  messageId: string;
  chatName: string;
  text: string;
  imageKeys: string[];
  sender: string;
  createdAt: string;
};
type Violation = {
  id: string;
  roomId: string;
  time: string;
  detail: string;
  quote: string;
  product: string;
  room: string;
  host: string;
  occurredAt: string;
  roomSource?: "screenshot_top_right" | "message_text";
};
type ScreenshotRecognition = {
  enabled: boolean;
  candidates: number;
  imagesAttempted: number;
  recognized: number;
  errors: string[];
};

const FEISHU_BASE = "https://open.feishu.cn/open-apis";
const DEFAULT_VIOLATION_CHAT_ID = "oc_a1f32ee1874fa98271d3bb19522abbb8";
const CACHE_MS = 60 * 60 * 1000;
const MAX_CHAT_PAGES = 5;
const MAX_MESSAGE_PAGES = 10;
const STRUCTURED_VIOLATION_PATTERN = /(违规单号|违规编号|处罚单号|判罚单号|违规详情|违规的详细|违规内容|违规原因|违规句|违规话术|相关商品|违规商品)/i;
const VIOLATION_EVENT_PATTERN = /(违规|处罚|扣分|判罚|限流|封禁|禁播|违禁词|敏感词|导流|虚假宣传|夸大宣传)/i;
const OPERATION_ONLY_PATTERN = /(断播|重开|重新开播|掉线|黑屏|卡顿|拉流|推流|重启|恢复开播|开播报备|断流|无声|收播)/i;
const NEGATIVE_PATTERN = /(无违规|未违规|暂无违规|未发现违规|没有违规|0\s*次违规|零违规)/i;
const VERIFIED_ANCHOR_NAMES = new Set([
  "潘小慧", "赵媛", "林惠敏", "何嘉慧", "刘晶晶",
  "杨晓彤", "丁阳虹", "李晓茏", "陈璐", "罗梓欣", "胡琳琳",
  "王思佳", "刁心然", "林羽浠", "刘睿", "朱海鹏", "宋怡琳",
  "李安妮", "黄芷曈", "陈荟聿", "王明玥", "蒋珂",
]);
const MINIMAX_BASE_URL = String(process.env.MINIMAX_BASE_URL || "https://cloud.fandow.com/gpt/openclaw-jump/v1").replace(/\/$/, "");
const MINIMAX_MODEL = process.env.MINIMAX_VISION_MODEL || process.env.MINIMAX_MODEL || "MiniMax-M2.7-highspeed";
const JUMP_LLM_URL = process.env.JUMP_LLM_URL || "https://cloud.fandow.com/gpt/interface/chat/completions";
const JUMP_LLM_TOKEN = process.env.JUMP_LLM_TOKEN || "";
const JUMP_LLM_APPLICATION = process.env.JUMP_LLM_APPLICATION || "pingying_zhongshu";
const JUMP_LLM_PROVIDER = process.env.JUMP_LLM_PROVIDER || "deepseek";
const JUMP_LLM_VISION_MODEL = process.env.JUMP_LLM_VISION_MODEL || "deepseek-v4-flash-vision-exp";
const MAX_SCREENSHOT_OCR = 12;
const screenshotModelReady = () => Boolean(JUMP_LLM_TOKEN || process.env.MINIMAX_API_KEY);

let tokenCache: { token: string; expiresAt: number } | null = null;
let cache: { expiresAt: number; rows: Violation[]; chats: string[]; chatIds: string[]; messagesScanned: number; screenshotRecognition: ScreenshotRecognition; fetchedAt: string; source: "feishu_chat" } | null = null;
const screenshotRoomCache = new Map<string, { room: string; expiresAt: number }>();

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function csv(value: string | undefined) {
  return String(value || "").split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function parseContent(raw: unknown): JsonRecord {
  try { return JSON.parse(stringValue(raw) || "{}") as JsonRecord; }
  catch { return { text: stringValue(raw) }; }
}

function messageText(value: unknown) {
  const parts: string[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== "object") return;
    const row = item as JsonRecord;
    if (typeof row.text === "string") parts.push(row.text);
    if (typeof row.title === "string") parts.push(row.title);
    if ((row.tag === "at" || row.tag === "user") && typeof row.user_name === "string") parts.push(`@${row.user_name}`);
    if ((row.tag === "at" || row.tag === "user") && typeof row.name === "string") parts.push(`@${row.name}`);
    Object.entries(row).forEach(([key, child]) => {
      if (!["text", "title", "image_key", "file_key"].includes(key)) visit(child);
    });
  };
  visit(value);
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].join("\n").slice(0, 8000);
}

function messageImageKeys(value: unknown) {
  const keys: string[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== "object") return;
    const row = item as JsonRecord;
    if (typeof row.image_key === "string") keys.push(row.image_key);
    Object.values(row).forEach(visit);
  };
  visit(value);
  return [...new Set(keys)].slice(0, 4);
}

async function tenantToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 5 * 60 * 1000) return tokenCache.token;
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error("服务器未配置 Coco 应用凭据");
  const response = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal/`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const payload = await response.json() as JsonRecord;
  const token = stringValue(payload.tenant_access_token);
  if (!response.ok || Number(payload.code) !== 0 || !token) throw new Error(stringValue(payload.msg) || "Coco 登录失败");
  tokenCache = { token, expiresAt: Date.now() + Math.max(300, Number(payload.expire || 7200)) * 1000 };
  return token;
}

async function feishuGet(path: string) {
  const response = await fetch(`${FEISHU_BASE}${path}`, {
    headers: { Authorization: `Bearer ${await tenantToken()}` },
  });
  const payload = await response.json() as JsonRecord;
  if (!response.ok || Number(payload.code) !== 0) throw new Error(stringValue(payload.msg) || `飞书接口请求失败：${response.status}`);
  return (payload.data && typeof payload.data === "object" ? payload.data : {}) as JsonRecord;
}

async function joinedChats() {
  const chats: Chat[] = [];
  let pageToken = "";
  for (let page = 0; page < MAX_CHAT_PAGES; page += 1) {
    const params = new URLSearchParams({ page_size: "100" });
    if (pageToken) params.set("page_token", pageToken);
    const data = await feishuGet(`/im/v1/chats?${params}`);
    for (const item of Array.isArray(data.items) ? data.items : []) {
      const row = item as JsonRecord;
      const chatId = stringValue(row.chat_id);
      if (chatId) chats.push({ chatId, name: stringValue(row.name) || chatId });
    }
    pageToken = stringValue(data.page_token);
    if (!data.has_more || !pageToken) break;
  }
  return chats;
}

async function sourceChats() {
  const explicitIds = csv(process.env.FEISHU_VIOLATION_CHAT_IDS);
  const explicitNames = csv(process.env.FEISHU_VIOLATION_CHAT_NAMES);
  if (explicitIds.length) {
    return explicitIds.map((chatId) => ({ chatId, name: "违规监控群" }));
  }
  if (explicitNames.length) {
    const chats = await joinedChats();
    return chats.filter((chat) => explicitNames.includes(chat.name));
  }
  return [{ chatId: DEFAULT_VIOLATION_CHAT_ID, name: "违规监控群" }];
}

async function chatMessages(chat: Chat) {
  const messages: ChatMessage[] = [];
  let pageToken = "";
  for (let page = 0; page < MAX_MESSAGE_PAGES; page += 1) {
    const params = new URLSearchParams({
      container_id_type: "chat",
      container_id: chat.chatId,
      sort_type: "ByCreateTimeDesc",
      page_size: "50",
    });
    if (pageToken) params.set("page_token", pageToken);
    const data = await feishuGet(`/im/v1/messages?${params}`);
    for (const item of Array.isArray(data.items) ? data.items : []) {
      const row = item as JsonRecord;
      const content = parseContent((row.body as JsonRecord | undefined)?.content);
      const sender = row.sender && typeof row.sender === "object" ? row.sender as JsonRecord : {};
      const milliseconds = Number(row.create_time || 0);
      messages.push({
        messageId: stringValue(row.message_id),
        chatName: chat.name,
        text: messageText(content),
        imageKeys: messageImageKeys(content),
        sender: stringValue(sender.sender_name) || stringValue(sender.name) || stringValue(sender.id) || "群成员",
        createdAt: milliseconds ? new Date(milliseconds).toISOString() : "",
      });
    }
    pageToken = stringValue(data.page_token);
    if (!data.has_more || !pageToken) break;
  }
  return messages;
}

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labeledField(text: string, labels: string[]) {
  const keys = labels.map(escapePattern).join("|");
  const lineMatch = text.match(new RegExp(`(?:^|\\n)\\s*(?:${keys})\\s*[：:]\\s*([^\\n]+)`, "i"));
  if (lineMatch?.[1]) return lineMatch[1].trim().replace(/[；;|]+$/, "");
  const inlineMatch = text.match(new RegExp(`(?:${keys})\\s*[：:]\\s*([^；;|\\n]+)`, "i"));
  return inlineMatch?.[1]?.trim().replace(/[；;|]+$/, "") || "";
}

function numericLabeledField(text: string, labels: string[]) {
  const keys = labels.map(escapePattern).join("|");
  const match = text.match(new RegExp(`(?:${keys})\\s*[：:]?\\s*(\\d{8,})`, "i"));
  return match?.[1] || "";
}

function blockField(text: string, labels: string[], stopLabels: string[]) {
  const keys = labels.map(escapePattern).join("|");
  const stops = stopLabels.map(escapePattern).join("|");
  const match = text.match(new RegExp(
    `(?:^|\\n)\\s*(?:${keys})(?:\\s*\\(共\\s*\\d+\\s*件\\))?\\s*[：:]?\\s*(?:\\n)?([\\s\\S]*?)(?=\\n\\s*(?:${stops})(?:\\s*\\(共\\s*\\d+\\s*件\\))?\\s*[：:]?|$)`,
    "i",
  ));
  return match?.[1]?.trim().replace(/[；;|]+$/, "") || "";
}

function roomFrom(text: string) {
  const explicit = labeledField(text, ["直播间名称", "违规直播间", "所属直播间", "直播间"]);
  const source = explicit || (text.match(/(?:王鸥美肤|品牌精选|优选|官旗)(?:直播间)?/)?.[0] || "");
  if (/王鸥美肤|燕窝面膜护肤店/.test(source)) return "WIS燕窝面膜护肤店";
  if (/品牌精选|官方旗舰店甄选/.test(source)) return "WIS官方旗舰店甄选";
  if (/优选|官方旗舰店优选/.test(source)) return "WIS官方旗舰店优选";
  if (/官旗|WIS官方旗舰店/.test(source)) return "WIS官方旗舰店";
  if (/@李晓茏/.test(text)) return "WIS官方旗舰店甄选";
  return explicit || "待确认";
}

export function roomFromScreenshotText(text: string) {
  const source = String(text || "").replace(/\s+/g, "");
  if (/WIS官方旗舰店甄选|WIS品牌精选号|品牌精选/.test(source)) return "WIS官方旗舰店甄选";
  if (/WIS官方旗舰店优选|WIS优选/.test(source)) return "WIS官方旗舰店优选";
  if (/WIS燕窝面膜护肤店|WIS护肤直播间|王鸥美肤/.test(source)) return "WIS燕窝面膜护肤店";
  if (/WIS官方旗舰店/.test(source)) return "WIS官方旗舰店";
  return "待确认";
}

function bufferBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function screenshotRoomFromImage(message: ChatMessage, imageKey: string) {
  const cacheKey = `${message.messageId}:${imageKey}`;
  const cached = screenshotRoomCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.room;
  const imageResponse = await fetch(`${FEISHU_BASE}/im/v1/messages/${encodeURIComponent(message.messageId)}/resources/${encodeURIComponent(imageKey)}?type=image`, {
    headers:{Authorization:`Bearer ${await tenantToken()}`}, signal:AbortSignal.timeout(30000),
  });
  if (!imageResponse.ok) throw new Error(`违规截图下载失败：${imageResponse.status}`);
  const mediaType = imageResponse.headers.get("content-type") || "image/jpeg";
  const dataUrl = `data:${mediaType};base64,${bufferBase64(await imageResponse.arrayBuffer())}`;
  const messages = [{role:"user",content:[
    {type:"text",text:"只读取截图右上角的店铺/直播间名称。只允许回答以下一个值：WIS官方旗舰店、WIS官方旗舰店甄选、WIS官方旗舰店优选、WIS燕窝面膜护肤店、待确认。不要解释。"},
    {type:"image_url",image_url:{url:dataUrl}},
  ]}];
  const usingJump = Boolean(JUMP_LLM_TOKEN);
  const response = await fetch(usingJump ? JUMP_LLM_URL : `${MINIMAX_BASE_URL}/chat/completions`, {
    method:"POST",
    headers:{Authorization:usingJump ? JUMP_LLM_TOKEN : `Bearer ${process.env.MINIMAX_API_KEY}`,"Content-Type":"application/json"},
    signal:AbortSignal.timeout(45000),
    body:JSON.stringify(usingJump ? {
      application:JUMP_LLM_APPLICATION,
      event:"text",
      provider:JUMP_LLM_PROVIDER,
      requests_data:{model:JUMP_LLM_VISION_MODEL,temperature:0,messages},
    } : {model:MINIMAX_MODEL,temperature:0,messages}),
  });
  const payload = await response.json() as JsonRecord;
  if (!response.ok) throw new Error(stringValue(payload.error && typeof payload.error === "object" ? (payload.error as JsonRecord).message : payload.message) || "截图识别服务不可用");
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const messageContent = choices[0] && typeof choices[0] === "object" ? (choices[0] as JsonRecord).message : null;
  const content = messageContent && typeof messageContent === "object" ? (messageContent as JsonRecord).content : "";
  const room = roomFromScreenshotText(typeof content === "string" ? content : JSON.stringify(content));
  screenshotRoomCache.set(cacheKey, {room,expiresAt:Date.now() + 24 * 60 * 60 * 1000});
  return room;
}

async function screenshotRoom(message: ChatMessage) {
  const result = {room:"待确认",imagesAttempted:0,errors:[] as string[]};
  if (!message.imageKeys.length || !screenshotModelReady()) return result;
  // 一条飞书违规消息通常同时附有违规详情、直播中控和客服记录。
  // 店铺名不保证出现在第一张图，因此按消息内顺序逐张识别，命中合法店铺即停止。
  for (const imageKey of message.imageKeys.slice(0, 4)) {
    result.imagesAttempted += 1;
    try {
      const room = await screenshotRoomFromImage(message, imageKey);
      if (room !== "待确认") return {...result,room};
    } catch (error) {
      // 单张资源失效或视觉服务失败不应阻断同一条消息的后续截图识别。
      const messageText = error instanceof Error ? error.message : "截图识别失败";
      result.errors.push(messageText);
      console.warn("violation screenshot recognition failed", message.messageId, messageText);
    }
  }
  return result;
}

function nearestImageMessage(target: ChatMessage, messages: ChatMessage[]) {
  if (target.imageKeys.length) return target;
  const targetTime = Date.parse(target.createdAt || "");
  return messages
    .filter(item => item.chatName === target.chatName && item.imageKeys.length && Math.abs(Date.parse(item.createdAt || "") - targetTime) <= 10 * 60 * 1000)
    .sort((left, right) => Math.abs(Date.parse(left.createdAt || "") - targetTime) - Math.abs(Date.parse(right.createdAt || "") - targetTime))[0] || null;
}

function hostFrom(text: string) {
  const explicit = labeledField(text, ["违规主播", "主播姓名", "当班主播", "责任主播", "主播"]);
  if (explicit) {
    const name = explicit.replace(/^@/, "").split(/[，,、\s]/)[0];
    if (name) return name;
  }
  const mentioned = [...text.matchAll(/@([\u3400-\u9fffA-Za-z·]{2,12})/g)]
    .map((match) => match[1])
    .find((name) => VERIFIED_ANCHOR_NAMES.has(name));
  return mentioned || "待确认";
}

function violationDetail(text: string) {
  const explicit = labeledField(text, ["违规的详细", "违规详情", "违规内容", "违规原因", "处罚原因", "判罚原因"]);
  if (explicit) return explicit;
  const afterRoom = text.match(/直播间(?:编号|ID|Id|号)?\s*[：:]?\s*\d{8,}\s*\n([\s\S]*?)(?=\n\s*违规位置)/i)?.[1]?.trim();
  if (afterRoom) return afterRoom;
  return text.split(/\n+/).map((line) => line.trim()).find((line) => VIOLATION_EVENT_PATTERN.test(line) && !/^(违规单号|违规编号|处罚单号|判罚单号)/.test(line)) || "待补充";
}

function chinaTime(iso: string) {
  if (!iso) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso)).replace("/", "-");
}

export function normalizeViolation(message: ChatMessage): Violation | null {
  const original = message.text.replace(/\r/g, "").trim();
  const compact = original.replace(/[ \t]+/g, " ").trim();
  if (!compact || NEGATIVE_PATTERN.test(compact) || !VIOLATION_EVENT_PATTERN.test(compact)) return null;
  const structured = STRUCTURED_VIOLATION_PATTERN.test(compact);
  if (OPERATION_ONLY_PATTERN.test(compact) && !structured) return null;
  if (!structured && !/(违规|处罚|判罚)(?:通知|记录|单|编号|详情|原因)/.test(compact)) return null;
  const violationId = numericLabeledField(original, ["违规单号", "违规编号", "处罚单号", "判罚单号", "单号"]);
  const roomId = numericLabeledField(original, ["直播间编号", "违规直播间编号", "直播间ID", "直播间 Id", "直播间号", "房间号", "直播间"]);
  // Only structured platform records belong in the violation ledger. This
  // intentionally rejects conversational questions such as “我哪里违规了”.
  if (!violationId || !roomId) return null;
  const violationTime = original.match(/(?:违规时间|发生时间|判罚时间)\s*[：:]?\s*((?:20)?\d{2}[\/.\-]\d{1,2}[\/.\-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)/i)?.[1]
    || labeledField(original, ["违规时间", "发生时间", "判罚时间", "时间"]);
  const quote = blockField(original, ["违规句", "违规原句", "违规话术", "原话", "命中语句"], ["违规商品", "相关商品", "商品名称", "商品", "关联商品", "直播时间"]);
  const product = blockField(original, ["违规商品", "相关商品", "商品名称", "商品", "关联商品"], ["直播时间", "直播时段", "违规依据", "处理结果", "@"]);
  return {
    id: violationId,
    roomId,
    time: violationTime || chinaTime(message.createdAt),
    detail: violationDetail(original).slice(0, 500),
    quote: quote || labeledField(original, ["违规句", "违规原句", "违规话术", "原话", "命中语句"]) || "未提供",
    product: product || labeledField(original, ["相关商品", "违规商品", "商品名称", "商品", "关联商品"]) || "未提供",
    room: roomFrom(original),
    host: hostFrom(original),
    occurredAt: message.createdAt,
    roomSource: "message_text",
  };
}

async function loadViolations() {
  const chats = await sourceChats();
  if (!chats.length) throw new Error("Coco 已登录，但未找到违规监控来源群；请将机器人加入对应群聊");
  const batches = await Promise.allSettled(chats.map(chatMessages));
  const successful = batches.filter((batch): batch is PromiseFulfilledResult<ChatMessage[]> => batch.status === "fulfilled");
  if (!successful.length) {
    const failed = batches.find((batch): batch is PromiseRejectedResult => batch.status === "rejected");
    throw failed?.reason instanceof Error ? failed.reason : new Error("Coco 无法读取违规来源群消息");
  }
  const messages = successful.flatMap((batch) => batch.value);
  const candidates = messages.map(message => ({message,row:normalizeViolation(message)})).filter((item): item is {message:ChatMessage;row:Violation} => Boolean(item.row));
  let ocrCount = 0;
  let imagesAttempted = 0;
  let recognizedCount = 0;
  const recognitionErrors: string[] = [];
  for (const candidate of candidates) {
    const evidence = nearestImageMessage(candidate.message, messages);
    if (!evidence || ocrCount >= MAX_SCREENSHOT_OCR) continue;
    ocrCount += 1;
    try {
      const recognized = await screenshotRoom(evidence);
      imagesAttempted += recognized.imagesAttempted;
      recognitionErrors.push(...recognized.errors);
      if (recognized.room !== "待确认") {
        candidate.row.room = recognized.room;
        candidate.row.roomSource = "screenshot_top_right";
        recognizedCount += 1;
      }
    } catch (error) {
      // Keep the structured message fallback. Missing OCR is not converted to a false room.
      recognitionErrors.push(error instanceof Error ? error.message : "截图识别失败");
    }
  }
  const rows = candidates.map(item => item.row);
  const unique = [...new Map(rows.map((row) => [`${row.id}-${row.roomId}`, row])).values()]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  return {
    rows: unique,
    chats: chats.map((chat) => chat.name),
    chatIds: chats.map((chat) => chat.chatId),
    messagesScanned: messages.length,
    screenshotRecognition: {
      enabled:screenshotModelReady(),
      candidates:Math.min(candidates.length, MAX_SCREENSHOT_OCR),
      imagesAttempted,
      recognized:recognizedCount,
      errors:[...new Set(recognitionErrors)].slice(0, 5),
    },
  };
}

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  if (!force && cache && cache.expiresAt > Date.now()) return Response.json({ ok: true, ...cache });
  try {
    const result = await loadViolations();
    const fetchedAt = new Date().toISOString();
    cache = { ...result, fetchedAt, source: "feishu_chat", expiresAt: Date.now() + CACHE_MS };
    return Response.json({ ok: true, ...cache });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "违规群聊读取失败", source: "feishu_chat" }, { status: 503 });
  }
}
