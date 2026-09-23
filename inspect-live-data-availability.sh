#!/usr/bin/env bash
set -euo pipefail

container="fd-027340-data-center"
sudo -v
sudo docker exec -i "$container" node - <<'NODE'
const endpoint = "https://cloud.fandow.com/gpt/ai-platform/mcp/data/";
const token = process.env.FANDOW_DATA_MCP_TOKEN;
if (!token) throw new Error("The container has no MCP token.");

async function call(body, sessionId) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP returned HTTP ${res.status}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const lastDataLine = text.split("\n").filter(x => x.startsWith("data:")).at(-1);
    data = lastDataLine ? JSON.parse(lastDataLine.slice(5).trim()) : {};
  }
  return { data, sessionId: res.headers.get("Mcp-Session-Id") || sessionId };
}

(async () => {
  const init = await call({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"availability-check",version:"1"}}});
  await call({jsonrpc:"2.0",method:"notifications/initialized"}, init.sessionId);
  const sql = `SELECT DATE(live_started_at) AS live_date, shop_name, COUNT(*) AS row_count
    FROM d_root_project_marketing_db.buyin_live_business_halfhour_snapshot
    GROUP BY DATE(live_started_at), shop_name
    ORDER BY live_date DESC, row_count DESC
    LIMIT 60`;
  const result = await call({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"execute_sql",arguments:{sql,limit:60}}}, init.sessionId);
  const content = result.data?.result?.content;
  const text = Array.isArray(content) ? content.find(x => x?.type === "text")?.text : JSON.stringify(result.data);
  console.log(text || "No rows returned.");
})().catch(error => { console.error(`CHECK_FAILED: ${error.message}`); process.exit(1); });
NODE
