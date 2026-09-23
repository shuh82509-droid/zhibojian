type JsonRecord = Record<string, unknown>;

type LiveRoomVisual = {
  avatarUrl: string;
  accountName: string;
  title: string;
  background: { url: string; label: string; updatedAt: string } | null;
};

const FEISHU_API = "https://open.feishu.cn/open-apis";
const VISUAL_CACHE_MS = 15 * 60 * 1000;
const CHAT_PAGES_LIMIT = 4;

const designChatByShop: Record<string, string> = {
  "WIS官方旗舰店": "WIS官旗-隐形水润面膜",
  "WIS官方旗舰店甄选": "WIS品牌精选直播间-晶润眼膜",
  "WIS官方旗舰店优选": "WIS优选-深海次抛/微针",
  "WIS燕窝面膜护肤店": "WIS鸥姐美肤甄选直播间设计",
};

let tenantToken: { value: string; expiresAt: number } | null = null;
let tenantPending: Promise<string> | null = null;
const readPending = new Map<string, Promise<JsonRecord>>();
const visualCache = new Map<string, { value: LiveRoomVisual; expiresAt: number }>();

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function readJson(response: Response): Promise<JsonRecord> {
  const payload = asRecord(await response.json());
  if (!response.ok || Number(payload.code ?? 0) !== 0) {
    throw new Error(asText(payload.msg) || `Feishu API request failed (${response.status})`);
  }
  return payload;
}

export async function getTenantAccessToken() {
  if (tenantToken && tenantToken.expiresAt > Date.now() + 60_000) return tenantToken.value;
  if (tenantPending) return tenantPending;
  tenantPending = requestTenantToken();
  try { return await tenantPending; } finally { tenantPending = null; }
}

async function requestTenantToken() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Coco credentials are not configured for the data center");

  const response = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await readJson(response);
  const value = asText(payload.tenant_access_token);
  if (!value) throw new Error("Feishu tenant access token was not returned");
  tenantToken = { value, expiresAt: Date.now() + Math.max(60, Number(payload.expire ?? 7200) - 120) * 1000 };
  return value;
}

export async function feishuReadJson(path: string): Promise<JsonRecord> {
  const existing = readPending.get(path);
  if (existing) return existing;
  const reading = (async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const token = await getTenantAccessToken();
        const response = await fetch(`${FEISHU_API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
        if ([429,502,503,504].includes(response.status)) throw new Error(`Feishu transient HTTP ${response.status}`);
        const payload = asRecord(await response.json());
        if (Number(payload.code) === 99991400) throw new Error('Feishu transient rate limit');
        if (!response.ok || Number(payload.code ?? 0) !== 0) throw new Error(asText(payload.msg) || `Feishu API request failed (${response.status})`);
        return payload;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= 2 || !/transient|timeout|timed out|aborted|fetch failed|ECONNRESET/i.test(message)) throw error;
        await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
  })();
  readPending.set(path, reading);
  try { return await reading; } finally { readPending.delete(path); }
}
const feishuGet = feishuReadJson;

async function findChatId(name: string) {
  let pageToken = "";
  for (let page = 0; page < CHAT_PAGES_LIMIT; page += 1) {
    const query = new URLSearchParams({ page_size: "100" });
    if (pageToken) query.set("page_token", pageToken);
    const payload = await feishuGet(`/im/v1/chats?${query.toString()}`);
    const data = asRecord(payload.data);
    const match = (Array.isArray(data.items) ? data.items : [])
      .map(asRecord)
      .find((item) => asText(item.name) === name);
    if (match) return asText(match.chat_id);
    pageToken = asText(data.page_token);
    if (!data.has_more || !pageToken) break;
  }
  return "";
}

function imageKeys(value: unknown, keys: string[] = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => imageKeys(item, keys));
  } else if (value && typeof value === "object") {
    Object.entries(value as JsonRecord).forEach(([key, item]) => {
      if (key === "image_key" && typeof item === "string" && item) keys.push(item);
      else imageKeys(item, keys);
    });
  }
  return keys;
}

function messageText(message: JsonRecord) {
  const body = asRecord(message.body);
  const content = asText(body.content);
  try {
    const parsed = JSON.parse(content) as unknown;
    return JSON.stringify(parsed).replace(/"(?:image_key|file_key)":"[^"]+"/g, "").slice(0, 120);
  } catch {
    return content.slice(0, 120);
  }
}

function resourceUrl(messageId: string, fileKey: string) {
  const query = new URLSearchParams({ messageId, fileKey, type: "image" });
  return `api/visual-resource?${query.toString()}`;
}

export async function getLiveRoomVisual(shop: string, title: string, base: { avatarUrl: string; accountName: string }): Promise<LiveRoomVisual> {
  const sourceName = designChatByShop[shop];
  const fallback: LiveRoomVisual = { ...base, accountName: base.accountName || shop, title, background: null };
  if (!sourceName) return fallback;

  const cached = visualCache.get(shop);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, title, accountName: cached.value.accountName || base.accountName || shop };

  try {
    const chatId = await findChatId(sourceName);
    if (!chatId) return fallback;
    const query = new URLSearchParams({ container_id_type: "chat", container_id: chatId, page_size: "50", sort_type: "ByCreateTimeDesc" });
    const payload = await feishuGet(`/im/v1/messages?${query.toString()}`);
    const items = Array.isArray(asRecord(payload.data).items) ? asRecord(payload.data).items as unknown[] : [];
    for (const item of items) {
      const message = asRecord(item);
      const keys = imageKeys(asRecord(message.body));
      const messageId = asText(message.message_id);
      if (!messageId || !keys.length) continue;
      const createdAt = Number(message.create_time ?? 0);
      const updatedAt = createdAt ? new Date(createdAt).toISOString().slice(0, 16).replace("T", " ") : "最新群聊消息";
      const value: LiveRoomVisual = {
        ...fallback,
        background: {
          url: resourceUrl(messageId, keys[0]),
          label: `${sourceName} · ${messageText(message) || "最新视觉素材"}`,
          updatedAt,
        },
      };
      visualCache.set(shop, { value, expiresAt: Date.now() + VISUAL_CACHE_MS });
      return value;
    }
  } catch {
    // A missing chat permission must not make the operating dashboard unavailable.
  }
  return fallback;
}

export async function downloadMessageImage(messageId: string, fileKey: string) {
  if (!/^om_[A-Za-z0-9_-]{8,256}$/.test(messageId) || !/^[A-Za-z0-9_-]{8,256}$/.test(fileKey)) {
    throw new Error("Invalid Feishu message image reference");
  }
  const token = await getTenantAccessToken();
  const response = await fetch(`${FEISHU_API}/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=image`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok || !response.body) throw new Error(`Feishu image download failed (${response.status})`);
  return response;
}
