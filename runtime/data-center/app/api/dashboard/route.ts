import { buildDashboardQueries, resolveDashboardRequest } from "../_lib/dashboard-agent";
import { callMcpTool, rowsFrom, sourceFailureMessage } from "../_lib/mcp";
import { getLiveRoomVisual } from "../_lib/coco";
import { loadFeishuDashboardFallback } from "../_lib/feishu-dashboard-fallback";
import { snapshotDashboard } from "./snapshot";
import { authError, requireLiveRoomAccess } from "../_lib/central-auth";
import { audienceFrom, audienceScopeFrom } from "../_lib/audience";
import { dispatchShift } from "../_lib/dispatch-staffing";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const cents = (value: unknown) => {
  const parsed = numeric(value);
  return parsed === null ? null : parsed / 100;
};
const shops = ["WIS官方旗舰店", "WIS官方旗舰店甄选", "WIS官方旗舰店优选", "WIS燕窝面膜护肤店"] as const;
const scheduleRoomByShop: Record<string, string> = {
  "WIS官方旗舰店": "官旗",
  "WIS官方旗舰店甄选": "品牌精选",
  "WIS官方旗舰店优选": "优选",
  "WIS燕窝面膜护肤店": "王鸥美肤",
};
const platformByShop: Record<string, string> = {
  "WIS官方旗舰店": "抖音",
  "WIS官方旗舰店甄选": "抖音",
  "WIS官方旗舰店优选": "抖音",
  "WIS燕窝面膜护肤店": "视频号",
};

function jsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
    try { return jsonValue(JSON.parse(trimmed)); } catch { return value; }
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, jsonValue(child)]));
  return value;
}

function jsonObject(value: unknown): Record<string, unknown> {
  const parsed = jsonValue(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function accountFrom(value: unknown) {
  const raw = jsonObject(value);
  const base = raw.base && typeof raw.base === "object" && !Array.isArray(raw.base)
    ? raw.base as Record<string, unknown>
    : {};
  return {
    avatarUrl: typeof base.avatar_uri === "string" ? base.avatar_uri : "",
    accountName: typeof base.nickname === "string" ? base.nickname : "",
  };
}

type DispatchRoom = { name?: string; anchors?: unknown[]; assistants?: unknown[] };

async function dispatchStaffing(request: Request, date: string, roomName: string) {
  if (!roomName) return { items: [] as Array<{ role: string; name: string; startAt: string; endAt: string }>, error: "未选择直播间" };
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const cookie = request.headers.get("cookie");
    const oaToken = request.headers.get("x-oa-token");
    if (cookie) headers.Cookie = cookie;
    if (oaToken) headers["X-OA-Token"] = oaToken;
    const dispatchBase = (process.env.DISPATCH_CENTER_API_BASE || "https://app.fandow.top/fd-027340/dispatch-center").replace(/\/+$/u, "");
    const response = await fetch(`${dispatchBase}/api/schedule?date=${encodeURIComponent(date)}`, {
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`调度中心返回 ${response.status}`);
    const payload = await response.json() as { rooms?: DispatchRoom[]; updatedAt?: string };
    const room = (payload.rooms ?? []).find((item) => item.name === roomName);
    const mapShift = (role: "anchor" | "assistant", value: unknown) => dispatchShift(role, date, value);
    const items = [
      ...((room?.anchors ?? []).map((item) => mapShift("anchor", item))),
      ...((room?.assistants ?? []).map((item) => mapShift("assistant", item))),
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
    return { items, error: "", updatedAt: payload.updatedAt ?? null };
  } catch (error) {
    return { items: [] as Array<{ role: string; name: string; startAt: string; endAt: string }>, error: error instanceof Error ? error.message : "调度中心读取失败", updatedAt: null };
  }
}

export async function GET(request: Request) {
  const auth = await requireLiveRoomAccess(request);
  if (!auth.ok) return authError(auth);
  const url = new URL(request.url);
  const context = resolveDashboardRequest(url.searchParams.get("date"), url.searchParams.get("session"));
  if (process.env.DATA_SOURCE === "snapshot") {
    return Response.json(snapshotDashboard(context.sessionKey));
  }
  const queries = buildDashboardQueries(context.date);

  try {
    const queryEntries = [
      ["sessions", queries.sessions, 100],
      ["traffic", queries.traffic, 300],
      ["staffing", queries.staffing, 100],
      ["hourlyTrend", queries.hourlyTrend, 500],
      ["recentSessions", queries.recentSessions, 500],
      ["audience", queries.audienceSnapshots, 20],
      ["buyerAudience", queries.buyerAudience, 20],
    ] as const;
    const settled = await Promise.allSettled(queryEntries.map(([, sql, limit]) => callMcpTool("execute_sql", { sql, limit })));
    const mcpResults = Object.fromEntries(queryEntries.map(([name], index) => [name, settled[index].status === "fulfilled" ? settled[index].value : {}]));
    const mcpErrors = Object.fromEntries(queryEntries.flatMap(([name], index) => settled[index].status === "rejected"
      ? [[name, settled[index].reason instanceof Error ? settled[index].reason.message : "MCP 数据读取失败"]]
      : []));
    const sessionsResult = mcpResults.sessions ?? {};
    const trafficResult = mcpResults.traffic ?? {};
    const staffingResult = mcpResults.staffing ?? {};
    const hourlyTrendResult = mcpResults.hourlyTrend ?? {};
    const recentSessionsResult = mcpResults.recentSessions ?? {};
    const audienceResult = mcpResults.audience ?? {};
    const buyerAudienceResult = mcpResults.buyerAudience ?? {};

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
        gmv: cents(row.transaction_amount_fen),
        cost: cents(row.qianchuan_spend_fen),
        refund: cents(row.refund_amount_fen),
        watchers: numeric(row.cumulative_watch_count),
        conversion: numeric(row.watch_to_transaction_rate_percent),
        online: numeric(row.realtime_online_count),
        audience: audienceFrom(row.realtime_audience_json),
        account: accountFrom(row.raw_metrics_json),
        platform: platformByShop[shop] ?? "未知渠道",
        observedAt: String(row.collected_at ?? row.snapshot_at ?? ""),
      };
    };
    let rawSessions = rowsFrom(sessionsResult).map(mapSession);
    let rawRecentSessions = rowsFrom(recentSessionsResult).map(mapSession);
    const mcpSessionKeys = new Set(rawSessions.map((session) => session.key));
    const mcpSessionShops = new Set(rawSessions.map((session) => session.shop));
    // Sheet fallbacks are day-level aggregates, not additional MCP sessions.
    const mcpRecentDays = new Set(rawRecentSessions.map(session => session.shop+"|"+session.startAt.slice(0,10)));
    const sheetFallback = mcpErrors.sessions || shops.some((shop) => !mcpSessionShops.has(shop))
      ? await loadFeishuDashboardFallback(context.date).catch(error => {
        mcpErrors.feishu = error instanceof Error ? error.message : "飞书经营根表暂不可用";
        return null;
      })
      : null;
    if (sheetFallback) {
      rawSessions = [
        ...rawSessions,
        ...sheetFallback.sessions.filter((session) => !mcpSessionShops.has(session.shop)),
      ];
      rawRecentSessions = [
        ...rawRecentSessions,
        ...sheetFallback.recentSessions.filter((session) => !mcpRecentDays.has(session.shop+"|"+session.startAt.slice(0,10))),
      ];
    }
    const audienceRows = rowsFrom(audienceResult);
    const audienceByShop = new Map(audienceRows.map((row) => [String(row.shop_name), {
      audience: audienceFrom(row.realtime_audience_json),
      online: numeric(row.realtime_online_count),
      account: accountFrom(row.raw_metrics_json),
      observedAt: String(row.collected_at ?? row.snapshot_at ?? ""),
    }]));
    const enrichAudience = (session: ReturnType<typeof mapSession>) => {
      const snapshot = audienceByShop.get(session.shop);
      if (!snapshot) return session;
      return {
        ...session,
        audience: session.audience.length ? session.audience : snapshot.audience,
        online: session.online ?? snapshot.online,
        account: session.account.avatarUrl ? session.account : snapshot.account,
        observedAt: session.observedAt || snapshot.observedAt,
      };
    };
    rawSessions = rawSessions.map(enrichAudience);
    rawRecentSessions = rawRecentSessions.map(enrichAudience);
    const accountByShop = new Map<string, ReturnType<typeof mapSession>["account"]>();
    [...rawSessions, ...rawRecentSessions].forEach((session) => {
      if (!accountByShop.has(session.shop) || session.account.avatarUrl) accountByShop.set(session.shop, session.account);
    });
    const visualByShop = new Map<string, Awaited<ReturnType<typeof getLiveRoomVisual>>>(
      await Promise.all(shops.map(async (shop) => [shop, await getLiveRoomVisual(shop, "当前直播间视觉", accountByShop.get(shop) ?? { avatarUrl: "", accountName: shop })] as const)),
    );
    const decorateVisual = (session: ReturnType<typeof mapSession>) => ({
      ...session,
      visual: visualByShop.get(session.shop) ?? { ...session.account, title: session.title, background: null },
    });
    const sessions = rawSessions.map(decorateVisual);
    const recentSessions = rawRecentSessions.map(decorateVisual).sort((a,b)=>b.startAt.replace("T"," ").localeCompare(a.startAt.replace("T"," ")));
    const audienceCheckedAt = new Date().toISOString();
    const strategyAudienceLabels = new Set(["小镇青年", "都市银发", "小镇中老年", "都市蓝领", "资深中产", "新锐白领", "精致妈妈", "Z世代"]);
    const snapshotAudienceProfiles = audienceRows.flatMap((row) => {
      const observedAt = String(row.collected_at ?? row.snapshot_at ?? "");
      const source = row.realtime_audience_json;
      return ([
        { scope: "FULL_SESSION_VIEWER", label: "全场看播用户", items: audienceScopeFrom(source, "FULL_SESSION_VIEWER") },
        { scope: "FULL_SESSION_BUYER", label: "全场购买用户", items: audienceScopeFrom(source, "FULL_SESSION_BUYER") },
      ] as const).map((profile) => ({ ...profile, shop: String(row.shop_name), observedAt }));
    }).filter((profile) => profile.items.some((item) => strategyAudienceLabels.has(item.label)));
    const buyerAudienceRows = rowsFrom(buyerAudienceResult);
    const fallbackBuyerProfiles = buyerAudienceRows.map((row) => ({
      shop: String(row.shop_name),
      scope: String(row.audience_scope),
      label: "全场购买用户",
      items: [...audienceFrom(row.gender_distribution), ...audienceFrom(row.age_distribution)]
        .filter((item) => strategyAudienceLabels.has(item.label)),
      observedAt: String(row.observed_at ?? row.collected_at ?? ""),
    })).filter((profile) => profile.items.length);
    const audienceProfiles = snapshotAudienceProfiles.length ? snapshotAudienceProfiles : fallbackBuyerProfiles;
    const audienceStatus = {
      checkedAt: audienceCheckedAt,
      source: mcpErrors.audience ? "source_auth_pending" : audienceRows.length ? "screen_snapshot" : sheetFallback ? "screen_snapshot_empty" : "screen_snapshot",
      byShop: Object.fromEntries(shops.map((shop) => {
        const snapshot = audienceByShop.get(shop);
        const available = Boolean(snapshot?.audience.length);
        return [shop, {
          available,
          observedAt: snapshot?.observedAt || null,
          reason: available
            ? "已读取最近一次有效直播人群快照。"
            : mcpErrors.audience
              ? sourceFailureMessage(String(mcpErrors.audience))+"；本次未取得人群快照，不使用旧数伪装为实时。"
            : snapshot
              ? "最新人群字段存在，但没有可解析的有效占比项。"
              : sheetFallback
                ? "实时直播快照源未返回该直播间记录；飞书经营根表不包含人群分布。"
                : "最近 15 日未返回该直播间的有效人群快照。",
        }];
      })),
    };

    const selectedKey = sessions.some((session) => session.key === context.sessionKey)
      ? context.sessionKey
      : sessions[0]?.key ?? null;
    const selected = sessions.find((session) => session.key === selectedKey);
    const selectedUsesFallback = Boolean(selectedKey && sheetFallback && !mcpSessionKeys.has(selectedKey));
    const trafficSource = new Map(rowsFrom(trafficResult)
      .filter((row) => `${String(row.shop_name)}|${String(row.live_room_id)}` === selectedKey)
      .map((row) => [String(row.channel_group), {
        value: numeric(row.traffic_share_percent),
        transactionAmount: numeric(row.transaction_amount_yuan),
        transactionShare: numeric(row.transaction_share_percent),
        valuePerThousandViews: numeric(row.pay_gpm_yuan),
      }]));
    const scheduleRoom = selected ? scheduleRoomByShop[selected.shop] : "";
    const mcpStaffing = rowsFrom(staffingResult)
      .filter((row) => String(row.live_room_name) === scheduleRoom)
      .map((row) => ({
        role: String(row.role),
        name: String(row.name),
        startAt: String(row.start_at),
        endAt: String(row.end_at),
      }));
    const dispatch = mcpStaffing.length ? { items: [], error: "", updatedAt: null } : await dispatchStaffing(request, context.date, scheduleRoom);
    const staffing = mcpStaffing.length ? mcpStaffing : dispatch.items;
    const staffingStatus = {
      source: mcpStaffing.length ? "marketing_schedule" : dispatch.items.length ? "dispatch_center" : "unavailable",
      updatedAt: dispatch.updatedAt ?? null,
      reason: mcpStaffing.length
        ? "已读取营销排班源。"
        : dispatch.items.length
          ? "营销助理排班未返回，已同步调度中心所选日期班表。"
          : `营销排班与调度中心均未返回可用班次${dispatch.error ? `：${dispatch.error}` : ""}。`,
    };
    const trend = selectedUsesFallback && selectedKey
      ? sheetFallback?.trendBySession[selectedKey] ?? []
      : rowsFrom(hourlyTrendResult)
        .filter((row) => `${String(row.shop_name)}|${String(row.live_room_id)}` === selectedKey)
        .map((row) => ({ hour: String(row.hour_label), gmv: cents(row.hourly_gmv_fen), roi: numeric(row.roi), conversion: numeric(row.conversion) }));
    const fallbackTraffic = selectedUsesFallback && selectedKey ? sheetFallback?.trafficBySession[selectedKey] : null;
    const trafficPalette = [
      ["自然推荐", "#17694f"], ["付费推广", "#3e8f72"], ["短视频引流", "#d7f15b"],
      ["粉丝关注", "#8aa68f"], ["同城", "#e7b56c"], ["分享/私域", "#b798d3"], ["其他", "#dfe7e2"],
    ] as const;
    const traffic = (fallbackTraffic ?? trafficPalette.map(([label, color]) => ({
      label, value: trafficSource.get(label)?.value ?? null, color,
      transactionAmount: trafficSource.get(label)?.transactionAmount ?? null,
      transactionShare: trafficSource.get(label)?.transactionShare ?? null,
      paymentAmountShare: trafficSource.get(label)?.transactionShare ?? null,
      valuePerThousandViews: trafficSource.get(label)?.valuePerThousandViews ?? null,
    }))).map((item) => ({
      ...item,
      transactionAmount: "transactionAmount" in item ? item.transactionAmount : null,
      transactionShare: "transactionShare" in item ? item.transactionShare : null,
      paymentAmountShare: "paymentAmountShare" in item ? item.paymentAmountShare : null,
      valuePerThousandViews: "valuePerThousandViews" in item ? item.valuePerThousandViews : null,
      transactionStatus: "transactionAmount" in item && item.transactionAmount !== null ? "已回传" as const : "待接入" as const,
    }));

    return Response.json({
      date: context.date,
      minDate: context.minDate,
      maxDate: context.maxDate,
      refreshMinutes: 60,
      agent: {
        name: "直播数据分析代理",
        summary: sheetFallback
          ? `${mcpErrors.sessions ? sourceFailureMessage(String(mcpErrors.sessions)) : "实时经营数据源部分直播间未返回场次"}，已用飞书根数据表补齐缺失直播间；${queries.summary}`
          : queries.summary,
      },
      shops,
      sessions,
      recentSessions,
      selectedSessionKey: selectedKey,
      traffic,
      audience: (selected?.audience ?? []).map((item) => ({
        ...item,
        transactionAmount: null,
        transactionShare: null,
        transactionStatus: "待接入" as const,
      })),
      audienceStatus,
      audienceProfiles,
      trend,
      visual: selected?.visual ?? null,
      staffing,
      staffingStatus,
      sourceErrors: mcpErrors,
      sourceStatus: sheetFallback?.sourceStatus ?? null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "数据服务暂不可用" },
      { status: 503 },
    );
  }
}
