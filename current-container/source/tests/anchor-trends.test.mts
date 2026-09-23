import assert from "node:assert/strict";
import { parseAnchorTrendRows } from "../app/api/_lib/feishu-dashboard-fallback.ts";

const rows = [
  ["2026/8/18", "08:00-08:30", "潘小慧", 1000, 200, 0, 1000, 200, 0, 100, 8, 0, 20, 0, "8%"],
  ["2026/8/18", "08:30-09:00", "", 2500, 500, 0, 1500, 300, 0, 120, 9, 0, 22, 0, "9%"],
  ["2026/8/18", "09:00-09:30", "赵媛", 3500, 700, 0, 1000, 200, 0, 90, 7, 0, 18, 0, "7%"],
];

const parsed = Object.fromEntries(parseAnchorTrendRows("guanqi", "2026-08-18", rows).map((item) => [item.name, item.point]));
assert.deepEqual(parsed["潘小慧"], { date: "2026-08-18", gmv: 2500, roi: 5, conversion: 9, hours: 1 });
assert.deepEqual(parsed["赵媛"], { date: "2026-08-18", gmv: 1000, roi: 5, conversion: 7, hours: 0.5 });
console.log("anchor trend parser tests passed");
