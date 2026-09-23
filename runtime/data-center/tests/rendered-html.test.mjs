import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(url = "http://localhost/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(url, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the room data view instead of the starter skeleton", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /各直播间数据/);
  assert.match(html, /直播间切换/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("server-renders the overview selected by the URL query", async () => {
  const response = await render("http://localhost/?view=overview");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /WIS 直播中心总览/);
  assert.match(html, /月目标完成情况/);
  assert.doesNotMatch(html, /LIVE COMMAND CENTER · STORE VIEW/);
});

test("unreturned dashboard metrics remain explicitly unavailable", async () => {
  const [route, fallback, dashboard] = await Promise.all([
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/_lib/feishu-dashboard-fallback.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /return parsed === null \? null : parsed \/ 100/);
  assert.match(fallback, /if \(column === undefined\) return null/);
  assert.match(dashboard, /value === null \? "待核验"/);
  const chart=await readFile(new URL("../app/metric-trend.tsx",import.meta.url),"utf8");
  assert.match(chart,/缺失指标不按 0 绘制/);
  assert.match(chart,/connected=false/);
  assert.match(dashboard, /查看每日趋势/);
  assert.match(dashboard, /渠道统一归并为自然推荐、付费推广、短视频引流、粉丝关注、同城、分享\/私域和其他/);
  assert.match(dashboard, /父子渠道不重复累计/);
  assert.match(dashboard, /用户支付金额占比/);
  assert.match(dashboard, /直播间策略人群构成/);
  assert.match(dashboard, /小镇青年.*都市银发.*小镇中老年.*都市蓝领.*资深中产.*新锐白领.*精致妈妈.*Z世代/);
  assert.match(dashboard, /任一来源缺失均独立标记“待接入”/);
  assert.match(fallback, /daily: FeishuMonthlyProgress/);
});
