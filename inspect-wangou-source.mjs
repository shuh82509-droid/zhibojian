const API = 'https://open.feishu.cn/open-apis';
const target = process.argv[2] || '2026-08-18';
const text = (value) => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.text ?? value.value ?? '') : String(value ?? '').trim();
const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
async function request(path, options = {}) {
  const response = await fetch(path.startsWith('http') ? path : API + path, options);
  const payload = await response.json();
  if (!response.ok || Number(payload.code ?? 0) !== 0) throw new Error(payload.msg || `HTTP ${response.status}`);
  return payload;
}
const authPayload = await request(`${API}/auth/v3/tenant_access_token/internal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }) });
const headers = { Authorization: `Bearer ${authPayload.tenant_access_token}` };
async function values(book, range) {
  const query = new URLSearchParams({ valueRenderOption: 'ToString', dateTimeRenderOption: 'FormattedString' });
  const payload = await request(`/sheets/v2/spreadsheets/${book}/values/${encodeURIComponent(range)}?${query}`, { headers });
  return payload.data?.valueRange?.values ?? [];
}
function dateMatch(value) {
  const raw = text(value);
  const match = raw.match(/(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})/) || raw.match(/(\d{1,2})月(\d{1,2})日/);
  if (!match) return false;
  const year = match.length === 4 ? Number(match[1]) : Number(target.slice(0, 4));
  const month = Number(match.length === 4 ? match[2] : match[1]);
  const day = Number(match.length === 4 ? match[3] : match[2]);
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` === target;
}
async function report(label, book, sheet, max) {
  const rows = await values(book, `${sheet}!A:${max}`);
  const matches=[];
  rows.forEach((row,index)=>{ if(dateMatch(row?.[0])) matches.push(index+1); });
  console.log(`${label} | rows=${rows.length} | matches=${matches.join(',') || 'none'}`);
  for (const rowNumber of matches.slice(-3)) {
    const row=rows[rowNumber-1] || [];
    console.log(`ROW ${rowNumber} | `+row.map((cell,index)=>`${index+1}:${text(cell)}`).filter(x=>!/:$/.test(x)).join(' | '));
  }
}
await report('王鸥明细', 'YB0osgtwbhvUdutIiJQcy2Elnmg', 'XAElcN', 'W');
const node = await request('/wiki/v2/spaces/get_node?token=VvyAwiXd7ifxcTkoiaLcSU9BnjT', { headers });
console.log(`VIDEO_NODE | type=${node.data?.node?.obj_type} | title=${node.data?.node?.title}`);
await report('视频号日成交', node.data?.node?.obj_token, 'ULkveo', 'W');
