import { buildDashboardQueries, resolveDashboardRequest } from "../_lib/dashboard-agent";
import { callMcpTool, rowsFrom } from "../_lib/mcp";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const numeric = (value: unknown) => Number(value ?? 0);
const shops = ["WIS官方旗舰店", "WIS官方旗舰店甄选", "WIS官方旗舰店优选"] as const;
const scheduleRoomByShop: Record<string, string> = {
  "WIS官方旗舰店": "官旗",
  "WIS官方旗舰店甄选": "品牌精选",
  "WIS官方旗舰店优选": "优选",
};

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function audienceFrom(value: unknown) {
  const source = jsonObject(value);
  const distribution = source["近1分钟看播"] ?? source["全场看播"];
  if (!distribution || typeof distribution !== "object" || Array.isArray(distribution)) return [];
  return Object.entries(distribution as Record<string, unknown>)
    .map(([label, share]) => ({ label, value: numeric(share) }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value);
}

const liveBackgroundByShop: Record<string, { url: string; label: string; updatedAt: string }> = {
  "WIS官方旗舰店": {
    url: "/live-backgrounds/wis-official-latest.jpg?v=20260813-current-visual",
    label: "WIS直播战队 · 曾泳淇最新确认背景",
    updatedAt: "2026-08-13",
  },
  "WIS官方旗舰店甄选": {
    url: "/live-backgrounds/wis-selected-latest.jpg?v=20260813-current-visual",
    label: "WIS直播战队 · 梁瑜涵最新确认背景",
    updatedAt: "2026-08-13",
  },
  "WIS官方旗舰店优选": {
    url: "/live-backgrounds/wis-preferred-latest.jpg?v=20260813-current-visual",
    label: "WIS直播战队 · 李爽最新确认背景",
    updatedAt: "2026-08-13",
  },
};

function visualFrom(value: unknown, title: string, shop: string) {
  const raw = jsonObject(value);
  const base = raw.base && typeof raw.base === "object" && !Array.isArray(raw.base)
    ? raw.base as Record<string, unknown>
    : {};
  const background = shop.includes("甄选")
    ? liveBackgroundByShop["WIS官方旗舰店甄选"]
    : shop.includes("优选")
      ? liveBackgroundByShop["WIS官方旗舰店优选"]
      : liveBackgroundByShop["WIS官方旗舰店"];
  return {
    avatarUrl: typeof base.avatar_uri === "string" ? base.avatar_uri : "",
    accountName: typeof base.nickname === "string" ? base.nickname : "",
    title,
    background,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const context = resolveDashboardRequest(url.searchParams.get("date"), url.searchParams.get("session"));
  const queries = buildDashboardQueries(context.date);

  try {
    const [sessionsResult, trafficResult, staffingResult, hourlyTrendResult, recentSessionsResult] = await Promise.all([
      callMcpTool("execute_sql", { sql: queries.sessions, limit: 100 }),
      callMcpTool("execute_sql", { sql: queries.traffic, limit: 300 }),
      callMcpTool("execute_sql", { sql: queries.staffing, limit: 100 }),
      callMcpTool("execute_sql", { sql: queries.hourlyTrend, limit: 500 }),
      callMcpTool("execute_sql", { sql: queries.recentSessions, limit: 500 }),
    ]);

    const mapSession = (row: Record<string, unknown>) => {
      const id = String(row.live_room_id);
      const shop = String(row.shop_name);
      const title = String(row.live_room_name ?? "未命名直播场次");
      return {
        id,
        key: `${shop}|${id}`,
        shop,
        title,
        startAt: String(row.live_started_at ?? ""),
        durationSeconds: numeric(row.live_duration_seconds),
        status: String(row.live_status ?? ""),
        gmv: numeric(row.transaction_amount_fen) / 100,
        cost: numeric(row.qianchuan_spend_fen) / 100,
        refund: numeric(row.refund_amount_fen) / 100,
        watchers: numeric(row.cumulative_watch_count),
        conversion: numeric(row.watch_to_transaction_rate_percent),
        online: numeric(row.realtime_online_count),
        audience: audienceFrom(row.realtime_audience_json),
        visual: visualFrom(row.raw_metrics_json, title, shop),
        observedAt: String(row.collected_at ?? row.snapshot_at ?? ""),
      };
    };
    const sessions = rowsFrom(sessionsResult).map(mapSession);
    const recentSessions = rowsFrom(recentSessionsResult).map(mapSession);

    const selectedKey = sessions.some((session) => session.key === context.sessionKey)
      ? context.sessionKey
      : sessions[0]?.key ?? null;
    const selected = sessions.find((session) => session.key === selectedKey);
    const trafficSource = new Map(
      rowsFrom(trafficResult)
        .filter((row) => `${String(row.shop_name)}|${String(row.live_room_id)}` === selectedKey)
        .map((row) => [String(row.channel_group), numeric(row.traffic_share_percent)]),
    );
    const scheduleRoom = selected ? scheduleRoomByShop[selected.shop] : "";
    const staffing = rowsFrom(staffingResult)
      .filter((row) => String(row.live_room_name) === scheduleRoom)
      .map((row) => ({
        role: String(row.role),
        name: String(row.name),
        startAt: String(row.start_at),
        endAt: String(row.end_at),
      }));
    const trend = rowsFrom(hourlyTrendResult)
      .filter((row) => `${String(row.shop_name)}|${String(row.live_room_id)}` === selectedKey)
      .map((row) => ({ hour: String(row.hour_label), gmv: numeric(row.hourly_gmv_fen) / 100, roi: numeric(row.roi), conversion: numeric(row.conversion) }));

    return Response.json({
      date: context.date,
      minDate: context.minDate,
      maxDate: context.maxDate,
      refreshMinutes: 60,
      agent: { name: "直播数据分析代理", summary: queries.summary },
      shops,
      sessions,
      recentSessions,
      selectedSessionKey: selectedKey,
      traffic: [
        { label: "短视频", value: trafficSource.get("短视频") ?? 0, color: "#d7f15b" },
        { label: "直播推荐", value: trafficSource.get("直播推荐") ?? 0, color: "#17694f" },
        { label: "其他", value: trafficSource.get("其他") ?? 0, color: "#dfe7e2" },
      ],
      audience: selected?.audience ?? [],
      trend,
      visual: selected?.visual ?? null,
      staffing,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "数据服务暂不可用" },
      { status: 503 },
    );
  }
}
