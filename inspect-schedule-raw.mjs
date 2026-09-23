const API = "https://open.feishu.cn/open-apis";
const spreadsheet = "EuYqssm4WhNwAvtyybKcDdk1ned";
const target = process.argv[2] || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const sources = [
  ["官旗", "NYB2iu", "Q"],
  ["品牌精选", "MVpDv0", "L"],
  ["优选", "LRAvIU", "L"],
  ["王鸥美肤", "PhlV42", "K"],
];

function text(value) {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object") return text(value.text ?? value.value ?? "");
  return String(value ?? "").trim();
}

function matches(value) {
  const raw = text(value);
  const match = raw.match(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/);
  if (!match) return false;
  const expected = new Date(`${target}T12:00:00+08:00`);
  if (Number(match[2]) !== expected.getMonth() + 1 || Number(match[3]) !== expected.getDate()) return false;
  if (match[1] && Number(match[1]) !== expected.getFullYear()) return false;
  const weekday = raw.match(/星期\s*([日天一二三四五六0-6])/);
  const aliases = [/[日天0]/, /[一1]/, /[二2]/, /[三3]/, /[四4]/, /[五5]/, /[六6]/];
  return !weekday || aliases[expected.getDay()].test(weekday[1]);
}

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || Number(payload.code ?? 0) !== 0) throw new Error(payload.msg || `HTTP ${response.status}`);
  return payload;
}

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
if (!appId || !appSecret) throw new Error("Coco environment unavailable");
const tokenPayload = await json(`${API}/auth/v3/tenant_access_token/internal`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
});
const auth = { Authorization: `Bearer ${tokenPayload.tenant_access_token}` };

async function values(range) {
  const query = new URLSearchParams({ valueRenderOption: "ToString", dateTimeRenderOption: "FormattedString" });
  const payload = await json(`${API}/sheets/v2/spreadsheets/${spreadsheet}/values/${encodeURIComponent(range)}?${query}`, { headers: auth });
  return payload.data?.valueRange?.values ?? [];
}

for (const [label, sheetId, maxColumn] of sources) {
  const column = await values(`${sheetId}!A:A`);
  const candidates = [];
  column.forEach((row, index) => { if (matches(row?.[0])) candidates.push(index + 1); });
  const start = candidates.at(-1) ?? null;
  if (!start) {
    console.log(`SOURCE ${label} | target=${target} | NOT_FOUND`);
    continue;
  }
  let end = column.length;
  for (let index = start; index < column.length; index += 1) {
    if (index + 1 > start && /(?:20\d{2}[年\-/.])?\d{1,2}月\d{1,2}日/.test(text(column[index]?.[0]))) {
      end = index;
      break;
    }
  }
  const block = await values(`${sheetId}!A${start}:${maxColumn}${Math.min(end, start + 16)}`);
  console.log(`SOURCE ${label} | target=${target} | candidates=${candidates.join(",")} | selected=${start} | blockEnd=${end}`);
  block.forEach((row, offset) => {
    const cells = row.map((cell, index) => `${index + 1}:${text(cell).replace(/\s+/g, " ")}`).filter((cell) => !/:$/.test(cell));
    console.log(`ROW ${start + offset} | ${cells.join(" | ")}`);
  });
}
