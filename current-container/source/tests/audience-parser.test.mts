import assert from "node:assert/strict";
import test from "node:test";
import { audienceFrom, audienceScopeFrom } from "../app/api/_lib/audience.ts";

test("parses the WeChat Channels root-array audience snapshot", () => {
  const source = JSON.stringify([
    { name: "小镇青年", count: 2, ratio: 0.25 },
    { name: "都市银发", count: 2, ratio: 0.25 },
    { name: "Z世代", count: 1, ratio: 0.125 },
  ]);
  assert.deepEqual(audienceFrom(source), [
    { label: "小镇青年", value: 25 },
    { label: "都市银发", value: 25 },
    { label: "Z世代", value: 12.5 },
  ]);
});

test("reads finalized full-session strategy audience scopes independently", () => {
  const source = {
    "单位": "%",
    "全场看播": { "Z世代": 0.8, "小镇青年": 12.3 },
    "全场购买": { "Z世代": 1.2, "小镇青年": 10.1 },
  };
  assert.deepEqual(audienceScopeFrom(source, "FULL_SESSION_VIEWER"), [
    { label: "Z世代", value: 0.8 },
    { label: "小镇青年", value: 12.3 },
  ]);
  assert.deepEqual(audienceScopeFrom(source, "FULL_SESSION_BUYER"), [
    { label: "Z世代", value: 1.2 },
    { label: "小镇青年", value: 10.1 },
  ]);
});

test("keeps parsing nested Douyin audience distributions", () => {
  const source = JSON.stringify({ dashboard: { "近1分钟看播": { "女性": "72%", "男性": "28%" } } });
  assert.deepEqual(audienceFrom(source), [
    { label: "女性", value: 72 },
    { label: "男性", value: 28 },
  ]);
});
