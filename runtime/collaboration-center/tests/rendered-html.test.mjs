import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the live collaboration center", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /直播间运营指挥台|LIVE OPS/);
  assert.match(html, /实时违规 \/ 运营配置/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("static operational configuration is visibly separated from live evidence", async () => {
  const dashboard = await readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /已录入 · 登录态由维护人核查/);
  assert.match(dashboard, /violationLoaded/);
  assert.match(dashboard, /待核验 · 数据源未回传/);
  assert.match(dashboard, /不代表已经发生对应事件/);
  assert.match(dashboard, /打开完整飞书文档/);
  assert.doesNotMatch(dashboard, /配置快照 · 待核验/);
  assert.match(dashboard, /不会写回或更改飞书数据/);
});
