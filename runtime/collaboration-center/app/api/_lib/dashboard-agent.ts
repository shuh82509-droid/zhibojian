/**
 * Dashboard analysis agent: translates a constrained dashboard request into
 * read-only MCP SQL. Keeping this server-side means the browser never sees an
 * MCP token and the agent cannot query tables outside the approved live schema.
 */
const shopNames = "'WIS官方旗舰店','WIS官方旗舰店甄选','WIS官方旗舰店优选'";

export type DashboardContext = {
  date: string;
  minDate: string;
  maxDate: string;
  sessionKey: string | null;
};

function chinaDate(offset = 0) {
  const date = new Date();
  const chinaMidnight = Date.UTC(
    Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric" }).format(date)),
    Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", month: "2-digit" }).format(date)) - 1,
    Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", day: "2-digit" }).format(date)),
  );
  return new Date(chinaMidnight + offset * 86_400_000).toISOString().slice(0, 10);
}

export function resolveDashboardRequest(dateValue: string | null, sessionKey: string | null): DashboardContext {
  const maxDate = chinaDate();
  const minDate = chinaDate(-14);
  const validDate = Boolean(dateValue && /^\d{4}-\d{2}-\d{2}$/.test(dateValue) && dateValue >= minDate && dateValue <= maxDate);
  return { date: validDate ? dateValue as string : maxDate, minDate, maxDate, sessionKey };
}

export function buildDashboardQueries(date: string) {
  const dateLiteral = date.replace(/'/g, "");
  const sessionFilter = `shop_name IN (${shopNames}) AND DATE(live_started_at) = '${dateLiteral}'`;
  const sessions = `WITH business_latest AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_business_halfhour_snapshot
    WHERE ${sessionFilter}
  ), screen_latest AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_screen_halfhour_snapshot
    WHERE ${sessionFilter}
  )
  SELECT b.shop_name, b.live_room_id, b.live_room_name, b.live_started_at, b.live_duration_seconds,
         b.live_status, b.transaction_amount_fen, b.qianchuan_spend_fen, b.refund_amount_fen,
         b.snapshot_at, b.collected_at, s.cumulative_watch_count, s.watch_to_transaction_rate_percent,
         s.realtime_online_count, s.realtime_audience_json, s.raw_metrics_json
  FROM business_latest b
  LEFT JOIN screen_latest s ON b.shop_name = s.shop_name AND b.live_room_id = s.live_room_id AND s.rn = 1
  WHERE b.rn = 1 ORDER BY b.shop_name, b.live_started_at DESC`;
  const traffic = `WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id, channel_name ORDER BY stat_date DESC, collection_time DESC, collected_at DESC, id DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_traffic_channel_halfhour_snapshot
    WHERE shop_name IN (${shopNames}) AND DATE(started_at) = '${dateLiteral}'
  ), grouped AS (
    SELECT shop_name, live_room_id,
      CASE WHEN channel_name = '短视频引流' THEN '短视频' WHEN channel_name = '直播推荐' THEN '直播推荐' ELSE '其他' END AS channel_group,
      traffic_share_percent
    FROM ranked WHERE rn = 1 AND channel_name NOT IN ('推荐feed', '直播广场', '其他推荐场景', '同城')
  )
  SELECT shop_name, live_room_id, channel_group, ROUND(SUM(traffic_share_percent), 1) AS traffic_share_percent
  FROM grouped GROUP BY shop_name, live_room_id, channel_group`;
  const staffing = `SELECT 'anchor' AS role, live_room_name, anchor_name AS name, start_at, end_at
    FROM d_root_project_marketing_db.buyin_live_anchor_schedule
    WHERE is_active = 1 AND CURRENT_TIMESTAMP BETWEEN start_at AND end_at
    UNION ALL
    SELECT 'assistant' AS role, live_room_name, assistant_name AS name, start_at, end_at
    FROM d_root_project_marketing_db.buyin_live_assistant_schedule
    WHERE is_active = 1 AND CURRENT_TIMESTAMP BETWEEN start_at AND end_at
    ORDER BY live_room_name, role`;
  const hourlyTrend = `WITH business_ranked AS (
    SELECT shop_name, live_room_id, DATE_FORMAT(snapshot_at, '%Y-%m-%d %H:00') AS hour_at,
           CASE WHEN DATE(snapshot_at) > DATE(live_started_at) THEN CONCAT('次日 ', DATE_FORMAT(snapshot_at, '%H:00')) ELSE DATE_FORMAT(snapshot_at, '%H:00') END AS hour_label,
           transaction_amount_fen, qianchuan_spend_fen,
           ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id, DATE_FORMAT(snapshot_at, '%Y-%m-%d %H') ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_business_halfhour_snapshot
    WHERE ${sessionFilter} AND TIME(live_started_at) BETWEEN '05:00:00' AND '07:00:00'
      AND snapshot_at >= TIMESTAMP(DATE(live_started_at), '05:00:00')
      AND snapshot_at < DATE_ADD(TIMESTAMP(DATE(live_started_at), '06:00:00'), INTERVAL 1 DAY)
  ), business_hourly AS (
    SELECT shop_name, live_room_id, hour_at, hour_label, transaction_amount_fen, qianchuan_spend_fen
    FROM business_ranked WHERE rn = 1
  ), business_delta AS (
    SELECT shop_name, live_room_id, hour_at, hour_label,
           GREATEST(transaction_amount_fen - COALESCE(LAG(transaction_amount_fen) OVER (PARTITION BY shop_name, live_room_id ORDER BY hour_at), 0), 0) AS hourly_gmv_fen,
           GREATEST(qianchuan_spend_fen - COALESCE(LAG(qianchuan_spend_fen) OVER (PARTITION BY shop_name, live_room_id ORDER BY hour_at), 0), 0) AS hourly_cost_fen
    FROM business_hourly
  ), screen_ranked AS (
    SELECT shop_name, live_room_id, DATE_FORMAT(snapshot_at, '%Y-%m-%d %H:00') AS hour_at,
           watch_to_transaction_rate_percent,
           ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id, DATE_FORMAT(snapshot_at, '%Y-%m-%d %H') ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_screen_halfhour_snapshot
    WHERE ${sessionFilter} AND TIME(live_started_at) BETWEEN '05:00:00' AND '07:00:00'
      AND snapshot_at >= TIMESTAMP(DATE(live_started_at), '05:00:00')
      AND snapshot_at < DATE_ADD(TIMESTAMP(DATE(live_started_at), '06:00:00'), INTERVAL 1 DAY)
  )
  SELECT b.shop_name, b.live_room_id, b.hour_at, b.hour_label, b.hourly_gmv_fen, b.hourly_cost_fen,
         CASE WHEN b.hourly_cost_fen > 0 THEN ROUND(b.hourly_gmv_fen / b.hourly_cost_fen, 2) ELSE 0 END AS roi,
         COALESCE(s.watch_to_transaction_rate_percent, 0) AS conversion
  FROM business_delta b
  LEFT JOIN screen_ranked s ON s.shop_name = b.shop_name AND s.live_room_id = b.live_room_id AND s.hour_at = b.hour_at AND s.rn = 1
  ORDER BY b.shop_name, b.live_room_id, b.hour_at`;
  const recentSessions = `WITH business_latest AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_business_halfhour_snapshot
    WHERE shop_name IN (${shopNames}) AND DATE(live_started_at) BETWEEN DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND CURDATE()
  ), screen_latest AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_screen_halfhour_snapshot
    WHERE shop_name IN (${shopNames}) AND DATE(live_started_at) BETWEEN DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND CURDATE()
  )
  SELECT b.shop_name, b.live_room_id, b.live_room_name, b.live_started_at, b.live_duration_seconds,
         b.live_status, b.transaction_amount_fen, b.qianchuan_spend_fen, b.refund_amount_fen,
         s.cumulative_watch_count, s.watch_to_transaction_rate_percent, s.realtime_online_count
  FROM business_latest b
  LEFT JOIN screen_latest s ON b.shop_name = s.shop_name AND b.live_room_id = s.live_room_id AND s.rn = 1
  WHERE b.rn = 1 ORDER BY b.live_started_at DESC`;
  return { sessions, traffic, staffing, hourlyTrend, recentSessions, summary: `已为 ${dateLiteral} 生成场次、每小时趋势、流量、实时人群和当前排班的只读查询` };
}
