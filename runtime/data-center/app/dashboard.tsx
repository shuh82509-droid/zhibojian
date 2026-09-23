"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MetricTrendChart from "./metric-trend";
import { businessDateTime } from "./business-date-time";
import { calendarReadState, type CalendarReadState } from "./calendar-state";

type Audience = { label: string; value: number; transactionAmount?: number | null; transactionShare?: number | null; transactionStatus?: string };
type AudienceProfile = { shop: string; scope: string; label: string; items: Audience[]; observedAt: string };
type Traffic = { label: string; value: number | null; color: string; transactionAmount?: number | null; transactionShare?: number | null; paymentAmountShare?: number | null; valuePerThousandViews?: number | null; transactionStatus?: string };
type HourlyTrend = { hour: string; gmv: number | null; roi: number | null; conversion: number | null };
type Staffing = { role: string; name: string; startAt: string; endAt: string };
type Visual = {
  avatarUrl: string; accountName: string; title: string;
  background: { url: string; label: string; updatedAt: string } | null;
};
type Session = {
  id: string; key: string; shop: string; title: string; startAt: string; durationSeconds: number | null; status: string;
  gmv: number | null; cost: number | null; refund: number | null; watchers: number | null; conversion: number | null; online: number | null;
  platform?: string;
  durationBasis?: string; watchersStatus?: string;
  visual?: Visual;
};
type DashboardData = {
  date: string; minDate: string; maxDate: string; fetchedAt: string; selectedSessionKey: string | null;
  sessions: Session[]; recentSessions: Session[]; traffic: Traffic[]; trend: HourlyTrend[]; audience: Audience[]; staffing: Staffing[]; visual: Visual | null; agent: { name: string; summary: string };
  audienceStatus?: { checkedAt: string; source: string; byShop: Record<string, { available: boolean; observedAt: string | null; reason: string }> };
  audienceProfiles?: AudienceProfile[];
  staffingStatus?: { source: string; updatedAt: string | null; reason: string };
  sourceErrors?: Record<string, string>;
};
type BusinessOverview = {
  date: string; month: string; fetchedAt: string; warnings: string[];
  reports: Array<{ label: string; kind: string; url: string }>;
  targets: Array<{
    code: string; room: string; actual: number | null; target: number | null; completion: number | null; daysFound: number; basis: string;
    daily: Array<{ date: string; gmv: number | null; roi: number | null; conversion: number | null }>;
  }>;
  calendar: Array<{ date: string; room: string; title: string }>;
  concerns: string[];
  sources: { kpi: string; plan: string };
};
type CalendarOverride = { id: string; date: string; room: string; title: string; deleted?: boolean; updatedAt?: string; updatedBy?: string };

const shops = ["WIS官方旗舰店", "WIS官方旗舰店甄选", "WIS官方旗舰店优选", "WIS燕窝面膜护肤店"] as const;
const liveRoomLinks: Record<string, string | null> = {
  "WIS官方旗舰店": "https://v.douyin.com/yyC3iO--sTQ/",
  "WIS官方旗舰店甄选": "https://v.douyin.com/P3mlyjyt0pg/",
  "WIS官方旗舰店优选": "https://v.douyin.com/qyB9BRgmIF4/",
  "WIS燕窝面膜护肤店": null,
};
const communicationDraftLinks: Record<string, string | null> = {
  "WIS官方旗舰店": "https://jqx28l0j4lx.feishu.cn/wiki/UNLZwRlbQimNzOkHktecMNvunyd?from=from_copylink",
  "WIS官方旗舰店甄选": "https://jqx28l0j4lx.feishu.cn/docx/QSF0ducRCopJW4xvmuacqRcqnHc?from=from_copylink",
  "WIS官方旗舰店优选": "https://jqx28l0j4lx.feishu.cn/wiki/E10qwfwrtir8qYkqHmQcOn9kngh?from=from_copylink",
  "WIS燕窝面膜护肤店": null,
};
const shopShortName: Record<string, string> = { "WIS官方旗舰店": "官旗", "WIS官方旗舰店甄选": "品牌精选", "WIS官方旗舰店优选": "优选", "WIS燕窝面膜护肤店": "王鸥美肤" };
const money = (value: number | null) => value === null
  ? "待核验"
  : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value);
const number = (value: number | null) => value === null ? "待核验" : new Intl.NumberFormat("zh-CN").format(value);
const shortMoney = (value: number | null) => value === null ? "—" : `¥${new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
const dateTime = businessDateTime;
const duration = (seconds: number | null) => seconds === null
  ? "待核验"
  : seconds ? `${Math.floor(seconds / 3600)}小时${Math.round(seconds % 3600 / 60)}分` : "0分";

export default function Dashboard({ initialView = "data", integrationBase = "" }: { initialView?: "overview" | "data"; integrationBase?: string }) {
const integratedHubBase = () => integrationBase;
const dashboardApiUrl = () => integratedHubBase()
  ? `${integratedHubBase()}/modules/data-center/api/dashboard`
  : (typeof window !== "undefined" && window.location.pathname.startsWith("/fd-027340/data-center/"))
  ? "/fd-027340/data-center/api/dashboard"
  : "/api/dashboard";
const overviewApiUrl = () => integratedHubBase()
  ? `${integratedHubBase()}/modules/data-center/api/business-overview`
  : (typeof window !== "undefined" && window.location.pathname.startsWith("/fd-027340/data-center/"))
  ? "/fd-027340/data-center/api/business-overview"
  : "/api/business-overview";
const calendarApiUrl = () => integratedHubBase()
  ? `${integratedHubBase()}/modules/live-room-management/api/calendar-overrides`
  : (typeof window !== "undefined" && window.location.pathname.startsWith("/fd-027340/data-center/"))
  ? "/fd-027340/live-center-workbench/api/calendar-overrides"
  : "/api/calendar-overrides";
const dispatchCenterUrl = () => integratedHubBase()
  ? `${integratedHubBase()}/modules/dispatch-center/?view=current`
  : "/fd-027340/live-center-workbench/#schedule";
function openEmbeddedSchedule(event: { preventDefault(): void }) {
  if (integratedHubBase() && window.parent !== window) {
    event.preventDefault();
    window.parent.postMessage({type:'wis-live-navigate',page:'schedule'}, window.location.origin);
  }
}


  const pageView = initialView;
  const [data, setData] = useState<DashboardData | null>(null);
  const [overview, setOverview] = useState<BusinessOverview | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedShop, setSelectedShop] = useState<string>(shops[0]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [trafficKey, setTrafficKey] = useState<string | null>(null);
  const [monthlyTrendCode, setMonthlyTrendCode] = useState<string | null>(null);
  const [calendarOverrides, setCalendarOverrides] = useState<CalendarOverride[]>([]);
  const [calendarState, setCalendarState] = useState<CalendarReadState>({ available:false, readOnly:true, message:"正在读取人工日历…" });
  const [calendarEditor, setCalendarEditor] = useState<{ date: string; room: string; title: string } | null>(null);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const realtimeSourcePending = Boolean(data?.sourceErrors && Object.keys(data.sourceErrors).length);

  const loadDashboard = useCallback(async (date = "", session: string | null = null, forceRefresh = false) => {
    setLoading(true); setError("");
    try {
      if (pageView === "overview") {
        const overviewParams = new URLSearchParams();
        if (date) overviewParams.set("date", date);
        if (forceRefresh) overviewParams.set("refresh", "1");
        overviewParams.set("_", Date.now().toString());
        const [overviewResult, calendarResult] = await Promise.allSettled([
          fetch(`${overviewApiUrl()}?${overviewParams}`, { cache: "no-store" }),
          fetch(`${calendarApiUrl()}?_=${Date.now()}`, { cache: "no-store", credentials: "same-origin" }),
        ]);
        if (overviewResult.status === "rejected") throw overviewResult.reason;
        const overviewPayload = await overviewResult.value.json() as BusinessOverview & { error?: string };
        if (!overviewResult.value.ok) throw new Error(overviewPayload.error || "直播中心总览暂不可用");
        setOverview(overviewPayload); setSelectedDate(overviewPayload.date);
        if (calendarResult.status === "fulfilled") {
          const calendarPayload = await calendarResult.value.json() as { ok?: boolean; items?: CalendarOverride[]; readOnly?: boolean; error?: string };
          const state = calendarReadState(calendarResult.value.status, calendarPayload);
          setCalendarState(state);
          if (state.available) setCalendarOverrides(calendarPayload.items ?? []);
        } else {
          setCalendarState({available:false,readOnly:true,message:'人工日历读取失败，已保留现有内容。'});
        }
        return;
      }
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      if (session) params.set("session", session);
      params.set("_", Date.now().toString());
      const response = await fetch(`${dashboardApiUrl()}?${params}`, { cache: "no-store" });
      const payload = await response.json() as DashboardData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "数据服务暂不可用");
      setData(payload); setSelectedDate(payload.date); setSelectedKey(payload.selectedSessionKey); setTrafficKey(payload.selectedSessionKey);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "数据服务暂不可用"); }
    finally { setLoading(false); }
  }, [pageView]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);
  useEffect(() => {
    const timer = window.setInterval(() => void loadDashboard(selectedDate, selectedKey), 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [loadDashboard, selectedDate, selectedKey]);

  const shopSessions = useMemo(() => (data?.sessions ?? []).filter((item) => item.shop === selectedShop), [data, selectedShop]);
  const recentShopSessions = useMemo(() => (data?.recentSessions ?? []).filter((item) => item.shop === selectedShop), [data, selectedShop]);
  const totals = useMemo(() => {
    const metric = (key: "gmv" | "cost" | "refund" | "watchers") => {
      const values = shopSessions.map((item) => item[key]).filter((value): value is number => value !== null);
      return { value: values.length ? values.reduce((sum, value) => sum + value, 0) : null, known: values.length };
    };
    const conversionRows = shopSessions.filter((item) => item.conversion !== null);
    const weightedRows = conversionRows.filter((item) => item.watchers !== null && item.watchers > 0);
    const weightedWatchers = weightedRows.reduce((sum, item) => sum + (item.watchers ?? 0), 0);
    const conversion = weightedWatchers > 0
      ? weightedRows.reduce((sum, item) => sum + (item.conversion ?? 0) * (item.watchers ?? 0), 0) / weightedWatchers
      : conversionRows.length
        ? conversionRows.reduce((sum, item) => sum + (item.conversion ?? 0), 0) / conversionRows.length
        : null;
    return {
      gmv: metric("gmv"), cost: metric("cost"), refund: metric("refund"), watchers: metric("watchers"),
      conversion, conversionKnown: conversionRows.length,
    };
  }, [shopSessions]);
  const selected = shopSessions.find((item) => item.key === selectedKey) ?? shopSessions[0] ?? null;
  const selectedLiveRoomLink = liveRoomLinks[selected?.shop ?? selectedShop];
  const selectedCommunicationDraftLink = communicationDraftLinks[selected?.shop ?? selectedShop];
  const activeKey = selected?.key ?? null;
  const audienceState = data?.audienceStatus?.byShop?.[selected?.shop ?? selectedShop];
  const activeAudienceProfiles = (data?.audienceProfiles ?? []).filter((profile) => profile.shop === (selected?.shop ?? selectedShop));
  const strategyAudienceLabels = ["小镇青年", "都市银发", "小镇中老年", "都市蓝领", "资深中产", "新锐白领", "精致妈妈", "Z世代"];
  const viewingProfile = activeAudienceProfiles.find((profile) => profile.scope === "FULL_SESSION_VIEWER");
  const buyerProfile = activeAudienceProfiles.find((profile) => profile.scope === "FULL_SESSION_BUYER");
  const strategyAudienceRows = strategyAudienceLabels.map((label) => ({
    label,
    viewer: viewingProfile?.items.find((item) => item.label === label)?.value ?? data?.audience.find((item) => item.label === label)?.value ?? null,
    buyer: buyerProfile?.items.find((item) => item.label === label)?.value ?? null,
  }));
  const trafficKnownTotal = (data?.traffic ?? []).reduce((sum, item) => sum + (item.value ?? 0), 0);
  const trafficAvailable = (data?.traffic ?? []).some((item) => item.value !== null);
  const trafficComplete = trafficAvailable && trafficKnownTotal >= 99 && trafficKnownTotal <= 100.5;
  const trafficBackground = useMemo(() => {
    let offset = 0;
    const stops = (data?.traffic ?? []).filter((item) => item.value !== null && item.value > 0).map((item) => {
      const start = offset; offset = Math.min(100, offset + (item.value ?? 0));
      return `${item.color} ${start}% ${offset}%`;
    });
    if (offset < 100) stops.push(`#e8ece9 ${offset}% 100%`);
    return `conic-gradient(${stops.join(", ") || "#eef2ef 0 100%"})`;
  }, [data]);
  const monthlyTrend = overview?.targets.find((item) => item.code === monthlyTrendCode) ?? null;
  const monthlyPoints = (monthlyTrend?.daily ?? []).filter((item) => item.gmv !== null);
  const monthlyMax = Math.max(1, ...monthlyPoints.map((item) => item.gmv ?? 0));
  const monthlyLine = (metric: "roi" | "conversion") => {
    const values = monthlyPoints.map((item) => item[metric]).filter((value): value is number => value !== null);
    const maximum = Math.max(1, ...values);
    return monthlyPoints.map((item, index) => item[metric] === null ? null : `${index * 100},${96 - (item[metric] ?? 0) / maximum * 82}`).filter(Boolean).join(" ");
  };
  const combinedTrend = useMemo(() => (data?.trend ?? []).filter((item): item is {
    hour: string; gmv: number; roi: number; conversion: number;
  } => item.gmv !== null && item.roi !== null && item.conversion !== null), [data]);
  const trendMaximum = useMemo(() => ({
    gmv: Math.max(1, ...combinedTrend.map((item) => item.gmv)),
    roi: Math.max(1, ...combinedTrend.map((item) => item.roi)),
    conversion: Math.max(1, ...combinedTrend.map((item) => item.conversion)),
  }), [combinedTrend]);
  const trendLinePoints = (metric: "roi" | "conversion") => {
    const maximum = metric === "roi" ? trendMaximum.roi : trendMaximum.conversion;
    const span = Math.max(1, combinedTrend.length - 1) * 100;
    return combinedTrend.map((item, index) => `${index * 100},${96 - item[metric] / maximum * 82}`).join(" ") || `0,96 ${span},96`;
  };
  const switchShop = (shop: string) => {
    setSelectedShop(shop);
    const next = (data?.sessions ?? []).find((item) => item.shop === shop)?.key ?? null;
    setSelectedKey(next); setTrafficKey(next);
    void loadDashboard(selectedDate, next);
  };
  const chooseRecentSession = (item: Session) => {
    const date = item.startAt.slice(0, 10);
    setSelectedDate(date); setSelectedKey(item.key); setTrafficKey(item.key);
    void loadDashboard(date, item.key);
    document.getElementById("session-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const mergedCalendar = useMemo(() => {
    const source = [...(overview?.calendar ?? [])];
    for (const override of calendarOverrides) {
      for (let index = source.length - 1; index >= 0; index -= 1) {
        if (source[index].date === override.date && source[index].room === override.room) source.splice(index, 1);
      }
      if (!override.deleted && override.title) source.push({ date: override.date, room: override.room, title: override.title });
    }
    return source;
  }, [overview, calendarOverrides]);
  const monthCalendar = useMemo(() => {
    const month = overview?.month || selectedDate.slice(0, 7);
    const [year, monthNumber] = month.split("-").map(Number);
    if (!year || !monthNumber) return [] as Array<{ date: string; day: number; inMonth: boolean; items: BusinessOverview["calendar"] }>;
    const firstOffset = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const cells = Math.ceil((firstOffset + days) / 7) * 7;
    return Array.from({ length: cells }, (_, index) => {
      const day = index - firstOffset + 1;
      const inMonth = day >= 1 && day <= days;
      const date = inMonth ? `${month}-${String(day).padStart(2, "0")}` : "";
      return { date, day, inMonth, items: inMonth ? mergedCalendar.filter((item) => item.date === date) : [] };
    });
  }, [overview, selectedDate, mergedCalendar]);
  const saveCalendarOverride = async (deleted = false) => {
    if (!calendarEditor || calendarState.readOnly) return;
    setCalendarSaving(true);
    try {
      const response = await fetch(calendarApiUrl(), {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ ...calendarEditor, deleted }),
      });
      const payload = await response.json() as { ok?: boolean; item?: CalendarOverride; error?: string };
      if (!response.ok || !payload.ok || !payload.item) throw new Error(payload.error || "直播日历保存失败");
      setCalendarOverrides((current) => [payload.item as CalendarOverride, ...current.filter((item) => item.id !== payload.item?.id)]);
      setCalendarEditor(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "直播日历保存失败"); }
    finally { setCalendarSaving(false); }
  };

  return <main className="app-shell">
    <aside className="sidebar"><div className="brand-lockup"><div className="brand-mark">L</div><div><p>LIVE HUB</p><span>WIS 直播经营中心</span></div></div>
      <div className="sidebar-copy"><b>实时经营看板</b><span>直播间切换 · 场次追踪 · 人群洞察</span></div>
      <div className={`sidebar-foot ${realtimeSourcePending ? "source-pending" : ""}`}><span className="live-dot" /> {realtimeSourcePending ? "经营数据已启用授权回填" : "经营数据服务运行中"}<small>{realtimeSourcePending ? "实时源待重新授权 · 已保留可核验数据" : "服务端只读查询 · 每小时自动刷新"}</small></div>
    </aside>
    <section className="content">
      <header className="topbar"><div><p className="eyebrow">{pageView === "overview" ? "LIVE COMMAND CENTER · OVERVIEW" : "LIVE COMMAND CENTER · STORE VIEW"}</p><h1>{pageView === "overview" ? "WIS 直播中心总览" : "各直播间数据"}</h1><p className="subtitle">{pageView === "overview" ? "集中查看月度目标、经营来源、直播日历与本月关注事项。" : "选择一个直播间后，查看该店铺的完整场次、流量与人群表现。"}</p></div>
        <div className="top-actions"><label className="date-picker">日期 <input type="date" value={selectedDate} min={data?.minDate} max={data?.maxDate} onChange={(event) => { setSelectedDate(event.target.value); setSelectedKey(null); void loadDashboard(event.target.value, null); }} /></label><button className="refresh" disabled={loading} onClick={() => void loadDashboard(selectedDate, selectedKey, true)}>{loading ? "同步中…" : "↻ 刷新数据"}</button></div>
      </header>
      {pageView === "overview" ? <>
      <div className={`notice ${error ? "notice-error" : ""}`}><span className="notice-icon">{error ? "!" : "✓"}</span><span>{error || <>总览业务日期 <b>{selectedDate || "正在读取"}</b>；各板块独立读取，缺失数据保持待核验。</>}</span></div>
      <section className="overview-links" aria-label="早报入口">
        <div><p className="eyebrow">DAILY REPORTS · SOURCE LINKS</p><h2>早报与经营来源</h2></div>
        <nav>{overview?.reports.map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.url}><small>{item.kind}</small><b>{item.label}</b><span>打开 ↗</span></a>) ?? <span className="overview-loading">正在同步飞书入口…</span>}</nav>
      </section>
      <section className="monthly-progress panel">
        <div className="panel-heading"><div><p className="eyebrow">MONTHLY TARGET COMPLETION</p><h2>{overview?.month ?? selectedDate.slice(0, 7)} 月目标完成情况</h2><small>截止所选日期，按各源表可核验成交口径 ÷ KPI 月目标；目标与成交均由飞书源每小时刷新</small></div></div>
        <div className="target-grid">{overview && !overview.targets.length ? <div className="empty-state" role="status">月度成交或目标来源暂未返回，不能按 0 展示。{overview.warnings.join("；")}</div> : overview?.targets.map((item) => <article key={item.code}><div><b>{item.room}</b><span>{item.daysFound} 个有效数据日 · {item.basis === "cumulative_gmv" ? "累计GMV" : "退后成交"}</span></div><strong>{item.completion === null ? "待核验" : `${item.completion}%`}</strong><div className="target-track"><i style={{ width: `${Math.min(100, item.completion ?? 0)}%` }} /></div><small>{money(item.actual)} / {item.target ? money(item.target) : "目标待核验"}</small><button className="monthly-trend-button" onClick={() => setMonthlyTrendCode((current) => current === item.code ? null : item.code)}>{monthlyTrendCode === item.code ? "收起每日趋势" : "查看每日趋势"}</button></article>) ?? <div className="overview-loading">正在计算本月成交…</div>}</div>
        {monthlyTrend ? <section className="monthly-daily-trend"><h3>{monthlyTrend.room} · 本月每日经营趋势</h3><MetricTrendChart label="本月每日经营趋势" points={monthlyTrend.daily}/></section> : null}
      </section>
      <section className="calendar-panel panel">
        <div className="panel-heading"><div><p className="eyebrow">LIVE PLANNING CALENDAR</p><h2>直播日历与关注事项</h2><small>飞书月度规划为基线；机制或产品临时变化可在工作台手动覆盖并留痕</small></div><div className="calendar-actions"><button disabled={calendarState.readOnly} title={calendarState.message} onClick={() => setCalendarEditor({ date: selectedDate, room: "官旗", title: "" })}>＋ 手动调整</button><a className="source-link" href={overview?.sources.plan} target="_blank" rel="noreferrer">查看规划原文 ↗</a></div></div>
        {calendarState.message && <p className="notice notice-error" role="status">{calendarState.message}</p>}<div className="calendar-layout"><div className="month-calendar"><div className="calendar-weekdays">{["星期一","星期二","星期三","星期四","星期五","星期六","星期日"].map((day) => <b key={day}>{day}</b>)}</div><div className="calendar-days">{monthCalendar.map((cell, index) => <article className={cell.inMonth ? "" : "outside"} key={cell.date || `outside-${index}`} onClick={() => cell.inMonth && !calendarState.readOnly && setCalendarEditor({ date: cell.date, room: "官旗", title: "" })}>{cell.inMonth ? <><time>{cell.day}</time><div>{cell.items.map((item) => <p className={`room-${item.room}`} key={`${item.room}-${item.title}`} onClick={(event) => { event.stopPropagation(); if (!calendarState.readOnly) setCalendarEditor({ date: item.date, room: item.room, title: item.title }); }}><span>{item.room}</span>{item.title}{!calendarState.readOnly && <i>编辑</i>}</p>)}</div></> : null}</article>)}</div>{overview && !mergedCalendar.length ? <div className="empty-state compact">{calendarState.readOnly ? "当前未读取到可核验的直播事项；请查看来源状态。" : "本月尚无直播事项，可点击日期手动新增"}</div> : null}</div><aside className="concern-list"><h3>各直播间本月规划</h3>{overview?.concerns.length ? <ul>{overview.concerns.map((item) => <li key={item}>{item}</li>)}</ul> : <p>本月日历表格上方暂未读取到直播间规划。</p>}{overview?.warnings.length ? <small>{overview.warnings.join("；")}</small> : null}</aside></div>
        {calendarEditor ? <section className="calendar-editor"><div><b>调整直播事项</b><small>同一天同一直播间的手动内容优先于规划原文</small></div><label>日期<input type="date" value={calendarEditor.date} onChange={(event) => setCalendarEditor({ ...calendarEditor, date:event.target.value })} /></label><label>直播间<select value={calendarEditor.room} onChange={(event) => setCalendarEditor({ ...calendarEditor, room:event.target.value })}>{["官旗","品牌精选","优选","王鸥美肤","直播中心"].map((room) => <option key={room}>{room}</option>)}</select></label><label>机制 / 产品 / 事项<input value={calendarEditor.title} onChange={(event) => setCalendarEditor({ ...calendarEditor, title:event.target.value })} placeholder="例如：燕窝机制切换 / 面膜专场" /></label><div><button disabled={calendarSaving || !calendarEditor.title.trim()} onClick={() => void saveCalendarOverride(false)}>{calendarSaving ? "保存中…" : "保存覆盖"}</button><button className="secondary" disabled={calendarSaving} onClick={() => void saveCalendarOverride(true)}>恢复原规划</button><button className="secondary" onClick={() => setCalendarEditor(null)}>取消</button></div></section> : null}
      </section>
      </> : <>
      <nav className="shop-switcher" aria-label="直播间切换">{shops.map((shop) => <button key={shop} className={shop === selectedShop ? "active" : ""} onClick={() => switchShop(shop)}><b>{shopShortName[shop]}</b><span>{shop}</span></button>)}</nav>
      <div className={`notice ${error ? "notice-error" : ""}`}><span className="notice-icon">{error ? "!" : "✓"}</span><span>{error || <>当前查看 <b>{selectedShop}</b> · <b>{data?.date ?? "—"}</b>；可回看近 15 天，最近同步 <b>{dateTime(data?.fetchedAt ?? "")}</b>。</>}</span></div>
      <section className="metric-grid"><article className="metric-card"><p>本店总成交金额</p><strong>{money(totals.gmv.value)}</strong><small>已核验 {totals.gmv.known}/{shopSessions.length} 场</small></article><article className="metric-card"><p>本店 ROI</p><strong>{totals.gmv.known === shopSessions.length && totals.cost.known === shopSessions.length && totals.gmv.value !== null && totals.cost.value !== null && totals.cost.value > 0 ? (totals.gmv.value / totals.cost.value).toFixed(2) : "待核验"}</strong><small>千川消耗 {money(totals.cost.value)} · 已核验 {totals.cost.known}/{shopSessions.length} 场</small></article><article className="metric-card"><p>观看-成交转化率</p><strong>{totals.conversion === null ? "待核验" : `${totals.conversion.toFixed(3)}%`}</strong><small>已核验 {totals.conversionKnown}/{shopSessions.length} 场；累计观看 {shopSessions.some(item=>item.watchersStatus==="人数单位待核验") ? "人数单位待核验" : number(totals.watchers.value)}</small></article><article className="metric-card"><p>本店退款金额</p><strong>{money(totals.refund.value)}</strong><small>已核验 {totals.refund.known}/{shopSessions.length} 场</small></article></section>
      <section className="grid-2 detail-grid" id="session-detail">
        <article className="panel selected-panel"><div className="panel-heading"><div><p className="eyebrow">SELECTED SESSION</p><h2>本场直播表现</h2></div><span className="badge">{selected?.durationBasis ? "经营表汇总" : selected?.status === "live" ? "直播中" : selected ? "已结束" : "未选择"}</span></div>{selected ? <><div className="selected-title"><b>{selected.title}</b><small>{selected.shop} · 场次 ID：{selected.id}</small></div><div className="detail-kpis"><div><span>开播时间</span><b>{dateTime(selected.startAt)}</b></div><div><span>{selected.durationBasis ? "已回传时长" : "直播时长"}</span><b>{duration(selected.durationSeconds)}</b>{selected.durationBasis&&<small>{selected.durationBasis}</small>}</div><div><span>成交 GMV</span><b>{money(selected.gmv)}</b></div><div><span>ROI</span><b>{selected.gmv !== null && selected.cost !== null && selected.cost > 0 ? (selected.gmv / selected.cost).toFixed(2) : "待核验"}</b></div><div><span>观看-成交转化</span><b>{selected.conversion === null ? "待核验" : `${selected.conversion.toFixed(3)}%`}</b></div><div><span>当前在线</span><b>{number(selected.online)}</b></div></div></> : <div className="empty-state">该店铺在此日期暂无直播场次</div>}</article>
        <article className="panel traffic-panel"><div className="panel-heading"><div><p className="eyebrow">TRAFFIC &amp; TRANSACTION MIX</p><h2>本场流量与成交构成</h2></div><span className="badge">场次维度</span></div><div className="donut-wrap"><div className="donut" style={{ background: trafficAvailable ? trafficBackground : "#eef2ef" }}><div><b>{trafficAvailable ? `${trafficKnownTotal.toFixed(0)}%` : "待核验"}</b><small>{trafficComplete ? "流量已覆盖" : trafficKnownTotal > 100.5 ? "口径待核验" : "已回传流量"}</small></div></div><div className="traffic-list"><div className="traffic-table-head"><span>渠道</span><span>渠道构成</span><span>成交构成<small>用户支付金额占比</small></span><span>渠道千次观看成交</span></div>{data?.traffic.map((item) => <div className="traffic-row" key={item.label}><div className="traffic-name"><i style={{ background: item.color }} /><span>{item.label}</span></div><b>{item.value === null ? "待接入" : `${item.value.toFixed(1)}%`}</b><b>{item.paymentAmountShare == null ? item.transactionStatus ?? "待接入" : `${item.paymentAmountShare.toFixed(1)}%`}</b><b>{item.valuePerThousandViews == null ? item.transactionStatus ?? "待接入" : money(item.valuePerThousandViews)}</b><small>{item.transactionAmount == null ? "用户支付金额待接入" : `用户支付金额 ${money(item.transactionAmount)}`}</small></div>)}</div></div><small className="source-note">渠道统一归并为自然推荐、付费推广、短视频引流、粉丝关注、同城、分享/私域和其他；父子渠道不重复累计。上游未返回的支付金额、成交占比或千次观看成交保持“待接入”。</small></article>
      </section>
      <section className="panel visual-panel"><div className="panel-heading"><div><p className="eyebrow">LIVE ROOM VISUAL</p><h2>直播间视觉概览</h2></div><span className="badge">直播背景</span></div>{data?.visual && selected ? <div className="visual-content"><a className="visual-frame visual-link" href={selectedLiveRoomLink ?? undefined} target="_blank" rel="noreferrer" aria-label={`打开${selected.shop}直播间`}>{data.visual.background ? <img src={data.visual.background.url} alt={`${selected.shop}直播间背景`} /> : data.visual.avatarUrl ? <img src={data.visual.avatarUrl} alt={`${selected.shop}直播间头像`} /> : <span>{shopShortName[selected.shop]}</span>}<i><b>{selected.status === "live" ? "LIVE" : "REPLAY"}</b></i><strong>进入直播间 ↗</strong></a><div className="visual-copy"><p>{data.visual.background ? "当前直播间背景" : "当前直播主题"}</p><h3>{data.visual.title}</h3><div><span>直播间</span><b>{data.visual.accountName || selected.shop}</b></div><div><span>实时状态</span><b>{selected.status === "live" ? `直播中 · 在线 ${number(selected.online)}` : "该场已结束"}</b></div><a className="live-room-button" href={selectedLiveRoomLink ?? undefined} target="_blank" rel="noreferrer">打开抖音直播间 ↗</a><small>{data.visual.background ? `${data.visual.background.label}（${data.visual.background.updatedAt}）；未上传新背景时继续展示最近已确认版本。` : "该直播间尚未接入背景图，暂展示官方头像。"}</small></div></div> : <div className="empty-state compact">该场次暂无可用的直播间视觉资料</div>}</section>
      <section className="panel communication-panel"><div className="panel-heading"><div><p className="eyebrow">LIVE COMMUNICATION DRAFT</p><h2>目前沟通稿</h2></div><span className="badge">店铺专属</span></div><div className="communication-content"><span className="communication-icon">稿</span><div><p>当前直播间</p><h3>{selected?.shop ?? selectedShop}</h3><small>点击打开该直播间当前使用的沟通稿，可在飞书中查看与编辑。</small></div><a className="communication-link" href={selectedCommunicationDraftLink ?? undefined} target="_blank" rel="noreferrer" aria-label={`打开${selected?.shop ?? selectedShop}目前沟通稿`}>打开沟通稿 ↗</a></div></section>
      <section className="panel audience-panel"><div className="panel-heading"><div><p className="eyebrow">LIVE AUDIENCE &amp; BUYERS</p><h2>直播间策略人群构成</h2></div><span className="badge">最近可用快照 · 非本场实时</span></div>{strategyAudienceRows.some((item) => item.viewer !== null || item.buyer !== null) && activeKey === trafficKey ? <><div className="audience-strategy-table"><div className="audience-table-head"><span>人群</span><span>全场看播用户</span><span>全场购买用户</span></div>{strategyAudienceRows.map((item) => <div className="audience-strategy-row" key={item.label}><b>{item.label}</b><span>{item.viewer === null ? "待接入" : `${item.viewer.toFixed(1)}%`}</span><span>{item.buyer === null ? "待接入" : `${item.buyer.toFixed(1)}%`}</span></div>)}</div><small className="source-note">此处为历史快照，不代表所选场次的实时人群。固定展示 8 类策略人群；看播与购买占比分别读取快照全场口径，任一来源缺失均独立标记“待接入”。来源 {viewingProfile?.observedAt || buyerProfile?.observedAt || audienceState?.observedAt || "待核验"}。</small></> : <div className="empty-state compact"><b>人群快照待数据源回传</b><span>{audienceState?.reason ?? "该场次暂无可用的人群快照"}</span><small>最近检查：{dateTime(data?.audienceStatus?.checkedAt ?? "")}</small></div>}</section>
      <section className="panel staffing-panel"><div className="panel-heading"><div><p className="eyebrow">LIVE STAFFING</p><h2>主播与助理排班</h2></div><span className="badge">{data?.staffingStatus?.source === "dispatch_center" ? "调度中心同步" : "营销排班"}</span></div>{data?.staffing.length && activeKey === trafficKey ? <><div className="staffing-list">{data.staffing.map((item, index) => <div className="staff-member" key={`${item.role}-${item.name}-${index}`}><span className={`staff-role ${item.role}`}>{item.role === "anchor" ? "主播" : "助理"}</span><div><b>{item.name}</b><small>班次 {dateTime(item.startAt).slice(11)} – {dateTime(item.endAt).slice(11)}</small></div><i className="live-dot" /></div>)}</div><div className="staffing-source"><span>{data.staffingStatus?.reason}</span><a href={dispatchCenterUrl()} onClick={openEmbeddedSchedule}>打开调度中心 ↗</a></div></> : <div className="empty-state compact"><b>当前班次待同步</b><span>{data?.staffingStatus?.reason ?? "当前没有匹配到该直播间的排班"}</span><a className="detail-button" href={dispatchCenterUrl()} onClick={openEmbeddedSchedule}>去调度中心核对</a></div>}</section>
      <section className="panel recent-trend-panel"><h2>近 15 天场次经营趋势</h2><MetricTrendChart label="近15天场次经营趋势" points={[...recentShopSessions].reverse().map(item=>({date:item.startAt,gmv:item.gmv,roi:item.gmv!==null&&item.cost!==null&&item.cost>0?item.gmv/item.cost:null,conversion:item.conversion}))}/></section>
      <section className="panel sessions-panel"><div className="panel-heading"><div><p className="eyebrow">RECENT 15 DAYS · LIVE SESSION LIST</p><h2>{selectedShop} · 近 15 天直播场次</h2></div><span className="session-count">共 {recentShopSessions.length} 场</span></div><div className="session-table"><div className="table-head"><span>直播场次名称</span><span>开播时间 / 时长</span><span>成交 GMV</span><span>ROI</span><span>转化率</span><span>操作</span></div>{recentShopSessions.map((item) => <div className={`session-row ${item.key === activeKey ? "selected" : ""}`} key={item.key}><div><b>{item.title}</b><small>场次 ID：{item.id} · {item.durationBasis ? "经营表汇总" : item.status === "live" ? "直播中" : "已结束"}</small></div><div><b>{dateTime(item.startAt)}</b><small>{duration(item.durationSeconds)}{item.durationBasis&&" · 已回传时段"}</small></div><div><b>{money(item.gmv)}</b><small>退款 {money(item.refund)}</small></div><div><b>{item.gmv !== null && item.cost !== null && item.cost > 0 ? (item.gmv / item.cost).toFixed(2) : "待核验"}</b><small>消耗 {money(item.cost)}</small></div><div><b>{item.conversion === null ? "待核验" : `${item.conversion.toFixed(3)}%`}</b><small>观看 {item.watchersStatus==="人数单位待核验" ? item.watchersStatus : number(item.watchers)}</small></div><div><button className="detail-button" onClick={() => chooseRecentSession(item)}>{item.key === activeKey ? "正在查看" : "查看详情"}</button></div></div>)}</div>{!loading && !recentShopSessions.length && <div className="empty-state">近 15 天暂无该店铺的直播场次数据</div>}</section>
      <p className="agent-note">{data?.agent.name ?? "直播数据分析代理"}：{data?.agent.summary ?? "正在准备查询"}</p>
      <section className="panel trend-panel"><div className="panel-heading"><h2>本场直播小时经营趋势</h2><span className="badge">随所选场次更新</span></div><MetricTrendChart label="本场直播小时经营趋势" points={activeKey === trafficKey ? (data?.trend ?? []).map(item=>({...item,date:item.hour})) : []}/></section>
      </>}
    </section>
  </main>;
}
