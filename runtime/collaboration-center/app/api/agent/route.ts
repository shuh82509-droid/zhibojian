import { callMcpTool } from "../_lib/mcp";

export const runtime = "edge";

const allowedSql = `WITH latest_hour AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY advertiser_id, live_session_id, stat_time_start
    ORDER BY observed_at DESC, id DESC
  ) AS rn
  FROM d_root_project_marketing_db.qianchuan_live_room_timeslot_sales_detail
  WHERE report_date = :report_date
    AND (advertiser_name LIKE '%WIS%' OR live_room_name LIKE '%WIS%')
)
SELECT live_session_id, live_room_name,
       SUM(total_pay_order_gmv_yuan) AS gmv_yuan,
       SUM(total_cost_yuan) AS cost_yuan,
       SUM(total_pay_order_gmv_yuan) / NULLIF(SUM(total_cost_yuan),0) AS roi
FROM latest_hour WHERE rn = 1
GROUP BY live_session_id, live_room_name;`;

export async function POST(request: Request) {
  const body = (await request.json()) as { prompt?: string };
  const prompt = body.prompt?.trim() || "分析 WIS 直播表现";
  const keyword = /峰|谷|时段/.test(prompt) ? "成交波峰时段" : /流量|短视频|推荐/.test(prompt) ? "流量渠道占比" : "直播场次 ROI";
  try {
    const dictionary = await callMcpTool("search_data_dictionary", { keyword, limit: 3 });
    return Response.json({
      prompt,
      sql: allowedSql,
      safeguards: ["仅允许 SELECT 查询", "按最新小时快照去重", "金额单位为元", "WIS 按账户/直播间名称匹配"],
      dictionary,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "分析服务暂不可用" }, { status: 503 });
  }
}
