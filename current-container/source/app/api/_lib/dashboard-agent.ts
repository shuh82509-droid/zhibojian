/**
 * Dashboard analysis agent: translates a constrained dashboard request into
 * read-only MCP SQL. Keeping this server-side means the browser never sees an
 * MCP token and the agent cannot query tables outside the approved live schema.
 */
// The fourth store is the Video Account live room.  It deliberately shares
// the same read-only data contract as the three Douyin rooms so the dashboard
// can keep a single 15-day/date-selection experience.
const shopNames = "'WIS官方旗舰店','WIS官方旗舰店甄选','WIS官方旗舰店优选','WIS燕窝面膜护肤店'";

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
  const traffic = `WITH compass_ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id, channel_path ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.douyin_compass_live_flow_channel_half_hourly_snapshot
    WHERE shop_name IN (${shopNames}) AND DATE(live_started_at) = '${dateLiteral}' AND channel_level = 1
  ), compass_grouped AS (
    SELECT shop_name, live_room_id,
      CASE
        WHEN traffic_type = 'paid' OR channel_name REGEXP '付费|广告|千川' THEN '付费推广'
        WHEN channel_name REGEXP '短视频' THEN '短视频引流'
        WHEN channel_name REGEXP '关注|粉丝' THEN '粉丝关注'
        WHEN channel_name REGEXP '同城' THEN '同城'
        WHEN channel_name REGEXP '分享|私域|转发' THEN '分享/私域'
        WHEN channel_name REGEXP '直播推荐|自然|推荐|直播广场' THEN '自然推荐'
        ELSE '其他'
      END AS channel_group,
      ROUND(SUM(traffic_ratio) * 100, 1) AS traffic_share_percent,
      ROUND(SUM(user_pay_amount_yuan), 2) AS transaction_amount_yuan,
      ROUND(SUM(user_pay_amount_ratio) * 100, 1) AS transaction_share_percent,
      ROUND(MAX(pay_gpm_yuan), 2) AS pay_gpm_yuan
    FROM compass_ranked WHERE rn = 1
    GROUP BY shop_name, live_room_id, channel_group
  ), legacy_ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id, channel_path ORDER BY stat_date DESC, collection_time DESC, collected_at DESC, id DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_traffic_channel_halfhour_snapshot
    WHERE shop_name IN (${shopNames}) AND DATE(started_at) = '${dateLiteral}'
      AND channel_path NOT LIKE '%>%' 
  ), legacy_grouped AS (
    SELECT shop_name, live_room_id,
      CASE
        WHEN channel_name REGEXP '付费|广告|千川' THEN '付费推广'
        WHEN channel_name REGEXP '短视频' THEN '短视频引流'
        WHEN channel_name REGEXP '关注|粉丝' THEN '粉丝关注'
        WHEN channel_name REGEXP '同城' THEN '同城'
        WHEN channel_name REGEXP '分享|私域|转发' THEN '分享/私域'
        WHEN channel_name REGEXP '直播推荐|自然|推荐|直播广场' THEN '自然推荐'
        ELSE '其他'
      END AS channel_group,
      traffic_share_percent,
      transaction_amount_share_percent AS transaction_share_percent,
      channel_gpm_yuan AS pay_gpm_yuan
    FROM legacy_ranked WHERE rn = 1
  )
  SELECT shop_name, live_room_id, channel_group, traffic_share_percent,
         transaction_amount_yuan, transaction_share_percent, pay_gpm_yuan
  FROM compass_grouped
  UNION ALL
  SELECT shop_name, live_room_id, channel_group, ROUND(SUM(traffic_share_percent), 1), NULL,
         ROUND(SUM(transaction_share_percent), 1), ROUND(MAX(pay_gpm_yuan), 2)
  FROM legacy_grouped legacy
  WHERE NOT EXISTS (
    SELECT 1 FROM compass_grouped compass
    WHERE compass.shop_name = legacy.shop_name AND compass.live_room_id = legacy.live_room_id
  )
  GROUP BY shop_name, live_room_id, channel_group`;
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
         s.cumulative_watch_count, s.watch_to_transaction_rate_percent, s.realtime_online_count,
         s.realtime_audience_json, s.raw_metrics_json, s.snapshot_at, s.collected_at
  FROM business_latest b
  LEFT JOIN screen_latest s ON b.shop_name = s.shop_name AND b.live_room_id = s.live_room_id AND s.rn = 1
  WHERE b.rn = 1 ORDER BY b.live_started_at DESC`;
  const audienceSnapshots = `WITH douyin_ranked AS (
    SELECT shop_name, realtime_online_count, realtime_audience_json, raw_metrics_json, snapshot_at, collected_at,
           ROW_NUMBER() OVER (PARTITION BY shop_name ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_screen_halfhour_snapshot
    WHERE shop_name IN (${shopNames})
      AND DATE(snapshot_at) BETWEEN DATE_SUB('${dateLiteral}', INTERVAL 14 DAY) AND '${dateLiteral}'
      AND realtime_audience_json IS NOT NULL
      AND TRIM(CAST(realtime_audience_json AS CHAR)) NOT IN ('', '{}', '[]', 'null')
  ), wechat_ranked AS (
    SELECT 'WIS燕窝面膜护肤店' AS shop_name, audience_count AS realtime_online_count,
           audience_group_distribution_json AS realtime_audience_json,
           JSON_OBJECT('base', JSON_OBJECT('nickname', finder_account_name)) AS raw_metrics_json,
           TIMESTAMP(stat_date, collection_time) AS snapshot_at, updated_at AS collected_at,
           ROW_NUMBER() OVER (PARTITION BY finder_account_name ORDER BY stat_date DESC, collection_time DESC, updated_at DESC) AS rn
    FROM d_root_project_marketing_db.wechat_channels_live_dashboard_audience_half_hourly
    WHERE finder_account_name = 'WIS燕窝面膜护肤店'
      AND audience_scope = 'REALTIME_VIEWER'
      AND stat_date BETWEEN DATE_SUB('${dateLiteral}', INTERVAL 14 DAY) AND '${dateLiteral}'
      AND audience_group_distribution_json IS NOT NULL
      AND TRIM(CAST(audience_group_distribution_json AS CHAR)) NOT IN ('', '{}', '[]', 'null')
  )
  SELECT shop_name, realtime_online_count, realtime_audience_json, raw_metrics_json, snapshot_at, collected_at
  FROM douyin_ranked WHERE rn = 1
  UNION ALL
  SELECT shop_name, realtime_online_count, realtime_audience_json, raw_metrics_json, snapshot_at, collected_at
  FROM wechat_ranked WHERE rn = 1`;
  const buyerAudience = `WITH douyin_ranked AS (
    SELECT shop_name, 'FULL_SESSION_BUYER' AS audience_scope, gender_distribution, age_distribution,
           report_date AS observed_at, collected_at,
           ROW_NUMBER() OVER (PARTITION BY shop_name ORDER BY report_date DESC, collected_at DESC) AS rn
    FROM d_root_project_mid_db_brandmarketing.douyin_compass_audience_insight_daily
    WHERE shop_name IN (${shopNames}) AND user_scope = 'pay' AND report_date <= '${dateLiteral}'
  ), wechat_ranked AS (
    SELECT 'WIS燕窝面膜护肤店' AS shop_name, audience_scope,
           gender_distribution_json AS gender_distribution,
           age_distribution_json AS age_distribution,
           stat_date AS observed_at, updated_at AS collected_at,
           ROW_NUMBER() OVER (PARTITION BY audience_scope ORDER BY stat_date DESC, collection_time DESC, updated_at DESC) AS rn
    FROM d_root_project_mid_db_brandmarketing.wechat_channels_live_dashboard_audience_half_hourly
    WHERE finder_account_name IN ('WIS燕窝面膜护肤店','WIS护肤号')
      AND audience_scope IN ('REALTIME_VIEWER','FULL_SESSION_BUYER')
      AND stat_date <= '${dateLiteral}'
  )
  SELECT shop_name, audience_scope, gender_distribution, age_distribution, observed_at, collected_at
  FROM douyin_ranked WHERE rn = 1
  UNION ALL
  SELECT shop_name, audience_scope, gender_distribution, age_distribution, observed_at, collected_at
  FROM wechat_ranked WHERE rn = 1`;
  return { sessions, traffic, staffing, hourlyTrend, recentSessions, audienceSnapshots, buyerAudience, summary: `已为 ${dateLiteral} 生成场次、每小时趋势、流量与成交、人群画像和排班的只读查询` };
}
