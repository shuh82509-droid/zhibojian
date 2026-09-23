import { callMcpTool } from "../_lib/mcp";
import { authError, requireLiveRoomAccess } from "../_lib/central-auth";

export const runtime = "edge";

type PlanId = "session_performance" | "traffic_mix" | "hourly_trend" | "audience";
const plans: Record<PlanId, { keyword: string; label: string; sql: string }> = {
  session_performance: {
    keyword: "直播场次 ROI 成交金额 转化率",
    label: "场次经营表现",
    sql: `WITH latest_hour AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY advertiser_id, live_session_id, stat_time_start ORDER BY observed_at DESC, id DESC) AS rn
  FROM d_root_project_marketing_db.qianchuan_live_room_timeslot_sales_detail
  WHERE report_date = :report_date AND (advertiser_name LIKE '%WIS%' OR live_room_name LIKE '%WIS%')
)
SELECT live_session_id, live_room_name, SUM(total_pay_order_gmv_yuan) AS gmv_yuan,
       SUM(total_cost_yuan) AS cost_yuan,
       SUM(total_pay_order_gmv_yuan) / NULLIF(SUM(total_cost_yuan),0) AS roi
FROM latest_hour WHERE rn = 1 GROUP BY live_session_id, live_room_name;`
  },
  traffic_mix: {
    keyword: "直播流量构成 短视频 直播推荐 占比",
    label: "场次流量构成",
    sql: `SELECT live_session_id, channel_name, traffic_share_percent
FROM d_root_project_marketing_db.buyin_live_traffic_channel_halfhour_snapshot
WHERE shop_name IN (:approved_shops) AND DATE(started_at) = :report_date
ORDER BY live_session_id, channel_name;`
  },
  hourly_trend: {
    keyword: "直播小时趋势 成交 ROI 转化率",
    label: "每小时经营趋势",
    sql: `SELECT shop_name, live_room_id, DATE_FORMAT(snapshot_at, '%Y-%m-%d %H:00') AS hour_at,
       transaction_amount_fen, qianchuan_spend_fen
FROM d_root_project_marketing_db.buyin_live_business_halfhour_snapshot
WHERE shop_name IN (:approved_shops) AND DATE(live_started_at) = :report_date
ORDER BY shop_name, live_room_id, snapshot_at;`
  },
  audience: {
    keyword: "直播间实时人群 画像 在线人数",
    label: "直播间当前人群",
    sql: `SELECT shop_name, live_room_id, realtime_online_count, realtime_audience_json
FROM d_root_project_marketing_db.buyin_live_screen_halfhour_snapshot
WHERE shop_name IN (:approved_shops) AND DATE(live_started_at) = :report_date
ORDER BY snapshot_at DESC;`
  }
};

function fallbackPlan(prompt: string): PlanId {
  if (/流量|短视频|推荐/.test(prompt)) return "traffic_mix";
  if (/小时|趋势|每小时/.test(prompt)) return "hourly_trend";
  if (/人群|画像|在线/.test(prompt)) return "audience";
  return "session_performance";
}

function parseGatewayText(body: string): string {
  return body.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => {
    try { return JSON.parse(line.slice(5).trim()).choices?.[0]?.delta?.content || ""; } catch { return ""; }
  }).join("").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function selectPlan(prompt: string): Promise<PlanId> {
  const baseUrl = process.env.MINIMAX_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!baseUrl || !apiKey) return fallbackPlan(prompt);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.MINIMAX_MODEL || "MiniMax-M2.7-highspeed", stream: false, max_tokens: 80, messages: [
      { role: "system", content: "Return JSON only: {\"plan\":\"session_performance|traffic_mix|hourly_trend|audience\"}. Select the single closest approved read-only dashboard plan. Never output SQL." },
      { role: "user", content: prompt }
    ] }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) return fallbackPlan(prompt);
  const text = parseGatewayText(await response.text());
  try {
    const plan = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}").plan;
    return Object.hasOwn(plans, plan) ? plan as PlanId : fallbackPlan(prompt);
  } catch { return fallbackPlan(prompt); }
}

export async function POST(request: Request) {
  const auth = await requireLiveRoomAccess(request);
  if (!auth.ok) return authError(auth);
  if (process.env.RECOVERY_READ_ONLY === "1") {
    return Response.json({ ok: false, code: "recovery_read_only", error: "维护恢复中，AI 分析生成已暂停；可继续查看已授权的只读数据。" }, { status: 423 });
  }
  const body = (await request.json()) as { prompt?: string };
  const prompt = body.prompt?.trim() || "分析 WIS 直播经营表现";
  const planId = await selectPlan(prompt);
  const plan = plans[planId];
  try {
    const dictionary = await callMcpTool("search_data_dictionary", { keyword: plan.keyword, limit: 3 });
    return Response.json({
      prompt, plan: { id: planId, label: plan.label }, sql: plan.sql, dictionary,
      safeguards: ["MiniMax 仅选择查询意图，不生成 SQL", "SQL 只能来自四个受审计的只读模板", "仅允许 SELECT 且参数由服务端绑定", "浏览器不接触 MCP 或模型凭据"]
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "分析服务暂不可用" }, { status: 503 });
  }
}
