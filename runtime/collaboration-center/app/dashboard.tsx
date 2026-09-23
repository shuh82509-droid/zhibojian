"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import "./dashboard-polish.css";

type Account = { platform: "抖音" | "视频号"; name: string; status: string; accountId?: string; type?: string; fans?: string };
type LinkItem = { category: string; channel: string; linkId: string; status: "已配置" | "待补充"; updatedAt: string };
type Incident = { type: string; count: number; sla: string; action: string; owner: string; level: "需处理" | "观察中" | "已闭环"; sourceUrl: string };
type Violation = { id: string; roomId: string; time: string; detail: string; quote: string; product: string; room: string; host: string; occurredAt: string; roomSource?: "screenshot_top_right" | "message_text" };
const VIOLATIONS_PER_PAGE = 10;

const accounts: Account[] = [
  { platform: "抖音", name: "WIS官方旗舰店", accountId: "793108908", status: "官旗开播中", type: "授权号", fans: "360.4万" },
  { platform: "抖音", name: "WIS品牌精选号", accountId: "pinpaijingxu", status: "可开播", type: "授权号升级中", fans: "117.4w" },
  { platform: "抖音", name: "WIS官方旗舰店优选", accountId: "92278621392", status: "优选开播中", type: "授权号", fans: "14.3w" },
  { platform: "抖音", name: "WIS护肤直播间", accountId: "ttxkx3565", status: "可开播", type: "授权号", fans: "60.8w" },
  { platform: "抖音", name: "WIS官方旗舰店精品", accountId: "1008802662", status: "可开播", type: "授权号", fans: "3.3w" },
  { platform: "抖音", name: "WIS官方旗舰店甄选", accountId: "92780410037", status: "眼膜大号开播中", type: "授权号", fans: "10.2w" },
  { platform: "抖音", name: "WIS星品", accountId: "WISxingpin23", status: "可开播", type: "达人号（需佣金）", fans: "67.4w" },
  { platform: "抖音", name: "WIS星选", accountId: "81896145047", status: "可开播", type: "达人号（需佣金）", fans: "9.3w" },
  { platform: "抖音", name: "WIS美肤甄选", accountId: "89882253679", status: "可开播", type: "达人号（需佣金）", fans: "2.3w" },
  { platform: "抖音", name: "WIS次抛精华", accountId: "95446199378", status: "不可开播，无保证金", type: "达人号", fans: "8k" },
  { platform: "视频号", name: "WIS星选优品", status: "官旗同播中", fans: "10w" },
  { platform: "视频号", name: "WIS甄选优品", status: "品牌精选同播中", fans: "10w+" },
  { platform: "视频号", name: "WIS小店", status: "优选同播次抛中", fans: "10w+" },
  { platform: "视频号", name: "WIS护肤号", status: "优选同播次抛中", fans: "1w" },
  { platform: "视频号", name: "WIS护肤推荐官", status: "王鸥美肤单开中", fans: "10w" },
  { platform: "视频号", name: "WIS品牌优选", status: "登录态未回传" },
  { platform: "视频号", name: "WIS专注熟龄肌", status: "数字人直播单开账号", fans: "购买中" },
];
const links: LinkItem[] = [
  { category: "水润面膜", channel: "抖音", linkId: "3499048820296299879", status: "已配置", updatedAt: "已录入" },
  { category: "水润面膜", channel: "抖音", linkId: "3835734912414122087", status: "已配置", updatedAt: "已录入" },
  { category: "晶润眼膜", channel: "抖音", linkId: "3509764557633625316", status: "已配置", updatedAt: "已录入" },
  { category: "晶润眼膜", channel: "抖音", linkId: "3674395209128608151", status: "已配置", updatedAt: "已录入" },
  { category: "新品 · 微针", channel: "抖音", linkId: "3781784743771766820", status: "已配置", updatedAt: "已录入" },
  { category: "新品 · 微针", channel: "抖音", linkId: "3836152754649301439", status: "已配置", updatedAt: "已录入" },
  { category: "新品 · 次抛", channel: "抖音", linkId: "3805702997758050414", status: "已配置", updatedAt: "已录入" },
  { category: "新品 · 次抛", channel: "抖音", linkId: "3836156298097983684", status: "已配置", updatedAt: "已录入" },
  { category: "新品 · 黄金六胜肽", channel: "抖音", linkId: "3832997499891744856", status: "已配置", updatedAt: "已录入" },
  { category: "新品 · 燕窝面膜", channel: "抖音", linkId: "3822190213313200403", status: "已配置", updatedAt: "已录入" },
  { category: "水润面膜", channel: "视频号", linkId: "10001304288145", status: "已配置", updatedAt: "已录入" },
  { category: "晶润眼膜", channel: "视频号", linkId: "10000294401123", status: "已配置", updatedAt: "已录入" },
  { category: "新品 · 次抛", channel: "视频号", linkId: "10000525759729", status: "已配置", updatedAt: "已录入" },
  { category: "新品 · 燕窝面膜", channel: "视频号", linkId: "10000234605595", status: "已配置", updatedAt: "已录入" },
];
const incidents: Incident[] = [
  { type: "画面异常", count: 13, sla: "1 分钟内", action: "黑屏 / 无信号先查采集卡软件：有信号数值则排除相机和 HDMI 线；无信号依次检查相机开机、重新插拔或更换 HDMI 线、输入接口选 HDMI（不要选 SDO）。再检查 OBS 是否被其他场景占用、虚拟摄像头设置；在新场景重新添加视频采集设备。OBS 无画面时，在设备属性中重选设备；仍无画面则删除后重建采集设备，依次重启 OBS、直播伴侣或电脑，恢复后复核画面、声音和购物车。", owner: "直播助理 + 场控", level: "需处理", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/DpHqwtFbYigLnkk6CJMcVuCIn4d#WX1gdZ8ChoEXnVxCPH2cNBS7nEh" },
  { type: "音频异常", count: 2, sla: "5 分钟内", action: "全程佩戴耳机监听。主播声小 / BGM 大：将指向麦靠近主播并朝向收音侧，手机放在同侧，先降低 BGM；仍不足再小幅提高调音台主播麦克风音量，调后监听，避免破音、强噪或回音。回音：先靠近麦克风，再按需调整直播伴侣降噪；整体音量小：调直播伴侣麦克风总输出。", owner: "直播助理", level: "观察中", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/RYfkwL0DWiTXEYkjAhZcACsKnRg#C5Zvd0LhDotlmFxATcIcvw1En5g" },
  { type: "同播流程", count: 95, sla: "实时", action: "快手同播 SOP：浏览器打开对应直播间，选择原画、关闭弹幕并打开声音；F12 刷新定位 stream 地址，OBS 新增媒体源并设为“监听并输出”，调整画面。直播伴侣勾选“直播卖货”，按商品 ID 与抖音顺序核对商品，标题同步抖音、封面截取实时画面。卡画无声：关播后重走流程；重音：关闭系统或浏览器喇叭逐项测试；无声：依次检查电脑音量、OBS 监听输出、直播设置的系统声音。", owner: "直播助理 + 渠道负责人", level: "需处理", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/YvZbwRm3GisAqTkRKz3cyosAnDh" },
  { type: "开关播流程", count: 42, sla: "恢复后即刻", action: "账号掉线或拉流失败先暂停开播 → 完成重登 / 重拉流 → 重开后群内报备画面、声音、购物车状态。", owner: "直播助理", level: "需处理", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/YvZbwRm3GisAqTkRKz3cyosAnDh" },
  { type: "录屏存储", count: 2, sla: "开播前 / 收播后", action: "开播前确认 OBS 录制状态；录制异常先检查网络存储盘是否断连，出现叉号时双击重新连接后再验证录制。收播后核验文件完整并按规则归档；不得擅自调整存储路径或清理文件。", owner: "直播助理 + 内容运营", level: "观察中", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/D5ejwYtCZiF089kCamxceeNrnmd#SelHd11xnooLIDx1dCfcWd9yn7u" },
  { type: "设备培训", count: 13, sla: "每周", action: "按直播间专属参数表执行：灯光位置、距离、亮度及桌面/背景距离不得随意调整；开播前核对相机、灯光、OBS 色彩校正 / LUT、直播伴侣视频设置和调音台。相机参数原则上不改，确需变更时按标准流程调整对焦、快门、光圈和 ISO，并完成画面与声音复核。", owner: "直播培训", level: "观察中", sourceUrl: "https://jqx28l0j4lx.feishu.cn/wiki/QnUawawOni3xP9kX1uec9Xh5nTb" },
];
const statusClass = (value: string) => value === "可用" || value === "已配置" || value === "已闭环" || value === "已处理" ? "good" : value === "失效" || value === "需处理" || value === "待处理" || value === "高" ? "danger" : "warn";
const chinaUpdatedAt = (value: string) => value ? new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value)).replaceAll("/", "-") : "待同步";

const accountStatusClass = (value: string) => value.includes("不可") || value.includes("找不到") ? "danger" : value.includes("可开播") || value.includes("开播中") || value.includes("同播中") || value.includes("单开中") ? "good" : "warn";

export default function Dashboard() {
  const [activeSection, setActiveSection] = useState<"violations" | "assets" | "incidents">("violations"); const [query, setQuery] = useState(""); const [accountChannel, setAccountChannel] = useState<Account["platform"]>("抖音"); const [linkChannel, setLinkChannel] = useState<LinkItem["channel"]>("抖音"); const [violations, setViolations] = useState<Violation[]>([]); const [violationLoaded, setViolationLoaded] = useState(false); const [violationPage, setViolationPage] = useState(1); const [violationStatus, setViolationStatus] = useState("正在同步"); const [lastUpdatedAt, setLastUpdatedAt] = useState(""); const [agentOpen, setAgentOpen] = useState(false); const [agentPrompt, setAgentPrompt] = useState(""); const [agentState, setAgentState] = useState<"ready" | "working" | "done">("ready");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const endpoint = `${window.location.pathname.replace(/\/?$/, "/")}api/violations`;
        const response = await fetch(`${endpoint}?_=${Date.now()}`, { credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "违规接口不可用");
        if (cancelled) return;
        const items = Array.isArray(payload.rows) ? payload.rows as Violation[] : [];
        setViolations(items);
        setViolationLoaded(true);
        setLastUpdatedAt(String(payload.fetchedAt || ""));
        const chatNames = Array.isArray(payload.chats) ? payload.chats.join("、") : "违规来源群";
        setViolationStatus(items.length ? `Coco 群聊已更新 · ${String(payload.fetchedAt || "").replace("T", " ").slice(0, 16)} · ${chatNames}` : `Coco 群聊暂无违规消息 · ${chatNames}`);
      } catch (error) {
        if (!cancelled) { setViolationLoaded(false); setViolationStatus(error instanceof Error ? `Coco 群聊读取失败 · ${error.message}` : "Coco 群聊读取失败"); }
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  const [incidentView, setIncidentView] = useState<"events" | "playbooks">("events"); const [incidentQuery, setIncidentQuery] = useState("");
  const visibleAccounts = useMemo(() => accounts.filter((item) => item.platform === accountChannel), [accountChannel]);
  const visibleLinks = useMemo(() => links.filter((item) => item.channel === linkChannel), [linkChannel]);
  const filteredIncidentPlaybooks = useMemo(() => { const term = incidentQuery.trim().toLowerCase(); return term ? incidents.filter((item) => [item.type, item.action, item.owner, item.level].join(" ").toLowerCase().includes(term)) : incidents; }, [incidentQuery]);
  const filteredViolations = useMemo(() => { const term = query.trim().toLowerCase(); const ordered = [...violations].sort((left, right) => Date.parse(right.occurredAt || "") - Date.parse(left.occurredAt || "")); return term ? ordered.filter((item) => [item.id,item.roomId,item.time,item.detail,item.quote,item.product,item.room,item.host].join(" ").toLowerCase().includes(term)) : ordered; }, [query, violations]);
  const violationPageCount = Math.max(1, Math.ceil(filteredViolations.length / VIOLATIONS_PER_PAGE));
  const visibleViolations = filteredViolations.slice((violationPage - 1) * VIOLATIONS_PER_PAGE, violationPage * VIOLATIONS_PER_PAGE);
  const confirmedRooms = violations.filter((item) => item.roomId !== "待确认" || item.room !== "待确认").length;
  const recognizedHosts = violations.filter((item) => item.host !== "待确认").length;
  useEffect(() => { setViolationPage(1); }, [query, violations.length]);
  useEffect(() => { if (violationPage > violationPageCount) setViolationPage(violationPageCount); }, [violationPage, violationPageCount]);
  const openSection = (section: string) => { if (section === "violations" || section === "assets" || section === "incidents") setActiveSection(section); document.getElementById(section)?.scrollIntoView({ behavior:"smooth", block:"start" }); };
  const runAgent = (event: FormEvent) => { event.preventDefault(); setAgentState("working"); window.setTimeout(() => setAgentState("done"), 200); };
  return <main className="ops-shell" data-active-section={activeSection}>
    <aside className="ops-sidebar"><div className="brand"><span className="brand-signal">▦</span><div><b>LIVE OPS</b><small>直播间运营指挥台</small></div></div><p className="side-kicker">实时违规 / 运营配置</p><nav aria-label="看板导航" className="side-nav">
      <button className={activeSection === "overview" ? "active" : ""} onClick={() => openSection("overview")}><i>01</i><span>运营总览<small>风险优先级与待办</small></span></button><button className={activeSection === "assets" ? "active" : ""} onClick={() => openSection("assets")}><i>02</i><span>账号与链接<small>备用号 · 商品链接</small></span></button><button className={activeSection === "incidents" ? "active" : ""} onClick={() => openSection("incidents")}><i>03</i><span>异常处理<small>流程与责任人</small></span></button><button className={activeSection === "violations" ? "active" : ""} onClick={() => openSection("violations")}><i>04</i><span>违规监控<small>检索与相似问题</small></span></button></nav><div className="side-system"><span className="pulse" />{violationLoaded ? "Coco 群聊读取已连接" : "Coco 群聊状态待核验"}<small>每小时刷新 · 凭据仅在服务端使用</small></div></aside>
    <section className="ops-content"><header className="hero" id="overview"><div><p className="eyebrow">LIVE ROOM / CONTROL CENTER</p><h1>直播运营，不漏掉每一个<span>风险信号</span></h1><p className="hero-copy">选择一个工作区，聚焦处理当前最需要关注的信息。</p></div><div className="hero-meta"><span>最近更新时间</span><b><i className="pulse" />{chinaUpdatedAt(lastUpdatedAt)}</b><small>{violationStatus}</small></div></header><nav className="workspace-tabs" aria-label="看板子标签"><button className={activeSection === "violations" ? "active" : ""} aria-pressed={activeSection === "violations"} onClick={() => setActiveSection("violations")}>违规监控</button><button className={activeSection === "assets" ? "active" : ""} aria-pressed={activeSection === "assets"} onClick={() => setActiveSection("assets")}>账号与链接</button><button className={activeSection === "incidents" ? "active" : ""} aria-pressed={activeSection === "incidents"} onClick={() => setActiveSection("incidents")}>异常处理</button></nav>
      <section className="overview-grid"><article className="signal-board"><div className="panel-title"><div><p className="eyebrow">TODAY&apos;S SIGNALS</p><h2>今日违规记录</h2></div><span className="source-badge">违规数据 · 每小时更新</span></div><div className="signal-list"><div><b className="signal-number danger-text">{violationLoaded ? String(violations.length).padStart(2,"0") : "待核验"}</b><p><strong>明确违规内容</strong><small>仅统计包含违规明细的群消息</small></p><button onClick={() => openSection("violations")}>查看</button></div><div><b className="signal-number warn-text">待核验</b><p><strong>录屏归档状态</strong><small>尚未接入实时归档台账</small></p><button onClick={() => openSection("incidents")}>查看 SOP</button></div><div><b className="signal-number">待核验</b><p><strong>备用账号登录态</strong><small>当前仅展示账号配置快照</small></p><button onClick={() => openSection("assets")}>查看配置</button></div></div></article>
        <article className="agent-card"><div className="agent-top"><div><p className="eyebrow">GROUP MESSAGE REVIEW</p><h2>违规证据归并</h2></div><button aria-expanded={agentOpen} onClick={() => setAgentOpen(!agentOpen)}>{agentOpen ? "收起" : "展开"}</button></div><p>Coco 每小时读取违规来源群，只保留带有明确违规事实或结构化违规字段的消息。</p><ol><li>排除：断播、重开、掉线、开播报备等运营消息</li><li>识别：直播间与消息中被提及的主播姓名</li><li>展示：违规单号、直播间编号、时间、违规详情、违规句和相关商品</li></ol>{agentOpen && <form className="agent-form" onSubmit={runAgent}><label>本地筛选关注方向<input value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} /></label><button type="submit">{agentState === "working" ? "整理中…" : "生成本地筛选条件"}</button>{agentState === "done" && <div className="sql-preview"><span>本地群聊筛选条件</span><code>违规单号 / 违规详情 / 违规句 / 相关商品</code><small>这里只生成浏览器内筛选条件，不会写回或更改飞书数据。</small></div>}</form>}</article></section>
<section className="section-block" id="assets"><div className="section-head"><div><p className="eyebrow">01 / ASSETS READINESS</p><h2>直播间备用账号及产品链接</h2><p>当前展示已录入的运营配置；账号登录态、粉丝数和链接可用性没有实时接口，由维护人按实际状态核查。</p></div><button className="outline-button">已录入 · 非实时</button></div><div className="asset-layout"><article className="table-panel"><div className="table-caption"><b>备用账号配置</b><div className="channel-tabs" aria-label="备用账号渠道选择">{(["抖音", "视频号"] as const).map((channel) => <button key={channel} className={accountChannel === channel ? "active" : ""} aria-pressed={accountChannel === channel} onClick={() => setAccountChannel(channel)}>{channel}</button>)}</div></div><div className="account-list">{visibleAccounts.map((item) => <div className="account-row" key={`${item.platform}-${item.name}`}><span className={`platform ${item.platform === "抖音" ? "douyin" : "wechat"}`}>{item.platform}</span><div><b>{item.name}</b><small>{item.accountId ? `账号 ID：${item.accountId} · ` : "账号 ID 未录入 · "}{item.type ? `${item.type} · ` : "账号类型未录入 · "}{item.fans ? `已录入粉丝 ${item.fans}` : "粉丝数未录入"}</small></div><time>{item.fans || "未录入"}</time><em className={accountStatusClass(item.status)}>来源状态：{item.status}</em></div>)}</div></article><article className="link-panel"><div className="table-caption"><b>品类链接配置</b><div className="channel-tabs" aria-label="产品链接渠道选择">{(["抖音", "视频号"] as const).map((channel) => <button key={channel} className={linkChannel === channel ? "active" : ""} aria-pressed={linkChannel === channel} onClick={() => setLinkChannel(channel)}>{channel}</button>)}</div></div><div className="link-list link-list-filtered">{visibleLinks.map((item) => <div key={`${item.category}-${item.linkId}`}><span>{item.category}</span><code>{item.linkId}</code><em className={statusClass(item.status)}>录入状态：{item.status}</em></div>)}</div><small className="help-note">已录入表示工作台保存了该商品 ID；当前是否上架、可售或可挂车尚无实时接口，需在对应平台核查。</small></article></div></section>
      <section className="section-block" id="incidents"><div className="section-head"><div><p className="eyebrow">02 / INCIDENT PLAYBOOK</p><h2>直播间异常及处理方式</h2><p>{incidentView === "events" ? "以下是标准处理预案，不代表已经发生对应事件；卡片展示完整步骤，并可直接打开飞书原文。" : "输入异常类型或关键词，快速定位对应的标准处理流程。"}</p></div><span className="legend"><i className="danger-dot"/>高优先级 SOP <i className="warn-dot"/>常规 SOP <i className="good-dot"/>已确认流程</span></div><div className="incident-tabs" role="tablist" aria-label="异常处理视图"><button role="tab" aria-selected={incidentView === "events"} className={incidentView === "events" ? "active" : ""} onClick={() => setIncidentView("events")}>预案分类</button><button role="tab" aria-selected={incidentView === "playbooks"} className={incidentView === "playbooks" ? "active" : ""} onClick={() => setIncidentView("playbooks")}>处理方式</button></div>{incidentView === "events" ? <div className="incident-grid">{incidents.map((item,index) => <article className="incident-card" key={item.type}><div className="incident-index">0{index+1}</div><div className="incident-card-head"><h3>{item.type}</h3><em className={statusClass(item.level)}>{item.level}</em></div><div className="incident-meta"><span>响应 SLA</span><b>{item.sla}</b><span>责任角色</span><b>{item.owner}</b></div><p>{item.action}</p><a className="incident-source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">打开完整飞书文档 ↗</a></article>)}</div> : <div className="playbook-search"><label><span>⌕</span><input value={incidentQuery} onChange={(event) => setIncidentQuery(event.target.value)} placeholder="输入异常类型或关键词，例如：黑屏、重音、OBS、录屏"/></label><div className="playbook-results">{filteredIncidentPlaybooks.map((item) => <article className="playbook-result" key={item.type}><div><h3>{item.type}</h3><p>{item.action}</p><a className="incident-source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">打开完整飞书文档 ↗</a></div><aside><span>响应 SLA</span><b>{item.sla}</b><span>责任角色</span><b>{item.owner}</b></aside></article>)}{!filteredIncidentPlaybooks.length && <div className="empty-result">未找到匹配处理方式。请尝试“黑屏”“音频”“OBS”“录屏”等关键词。</div>}</div></div>}</section>
      <section className="section-block violations-section" id="violations">
        <div className="section-head">
          <div><p className="eyebrow">03 / COMPLIANCE MONITOR</p><h2>直播间违规监控</h2><p>只呈现明确的违规记录；断播、重开、掉线与开播报备不会进入列表。</p></div>
          <div className="violation-stats"><span><b>{violationLoaded ? violations.length : "待核验"}</b>违规记录</span><span><b>{violationLoaded ? confirmedRooms : "待核验"}</b>直播间已确认</span><span><b>{violationLoaded ? recognizedHosts : "待核验"}</b>主播已识别</span></div>
        </div>
        <div className="search-row">
          <label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索违规单号、直播间编号、主播、违规句或商品"/></label>
          <button onClick={() => setQuery("")}>全部违规</button><button onClick={() => setQuery("WIS官方旗舰店")}>同一直播间</button><button onClick={() => setQuery("待确认")}>待确认信息</button>
        </div>
        <div className="violation-table">
          <div className="violation-head"><span>违规单号</span><span>直播间编号</span><span>时间</span><span>违规的详细</span><span>违规句</span><span>相关商品</span></div>
          {visibleViolations.map((item) => <div className="violation-row" key={`${item.id}-${item.roomId}`}>
            <div className="violation-id"><b>{item.id}</b></div>
            <div><b>{item.roomId}</b><small>{item.room}{item.roomSource === "screenshot_top_right" ? " · 截图识别" : ""}</small></div>
            <time>{item.time}</time>
            <div className="violation-detail"><strong>{item.detail}</strong><small>主播：{item.host}</small></div>
            <blockquote>{item.quote}</blockquote>
            <span>{item.product}</span>
          </div>)}
          {!filteredViolations.length && <div className="empty-result">{violationLoaded ? "未找到匹配的违规记录。断播、重开等运营消息已自动排除。" : violationStatus}</div>}
        </div>
        {filteredViolations.length > VIOLATIONS_PER_PAGE && <nav className="violation-pagination" aria-label="违规记录翻页">
          <span>第 {violationPage} / {violationPageCount} 页 · 共 {filteredViolations.length} 条</span>
          <div><button disabled={violationPage === 1} onClick={() => setViolationPage((page) => Math.max(1, page - 1))}>上一页</button>{Array.from({ length: violationPageCount }, (_, index) => index + 1).map((page) => <button key={page} className={page === violationPage ? "active" : ""} aria-current={page === violationPage ? "page" : undefined} onClick={() => setViolationPage(page)}>{page}</button>)}<button disabled={violationPage === violationPageCount} onClick={() => setViolationPage((page) => Math.min(violationPageCount, page + 1))}>下一页</button></div>
        </nav>}
        <p className="footnote">数据由 Coco 每小时直接读取飞书违规群；严格按 <code>违规单号</code>、<code>直播间编号</code>、<code>时间</code>、<code>违规的详细</code>、<code>违规句</code>、<code>相关商品</code> 展示，不经过数据 MCP。</p>
      </section>
    </section>
  </main>;
}
