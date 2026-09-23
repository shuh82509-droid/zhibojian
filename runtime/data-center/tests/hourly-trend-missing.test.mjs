import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("hourly trend preserves missing slots instead of coercing them to zero", async () => {
  const source = await readFile(new URL("../app/api/_lib/feishu-dashboard-fallback.ts", import.meta.url), "utf8");
  const functionBody = source.match(/function hourlyTrend[\s\S]*?\n}\n\nfunction traffic/)?.[0] ?? "";
  assert.match(functionBody, /optionalNumber\(row\[source\.columns\.halfHourGmv\]\)/);
  assert.match(functionBody, /optionalPercent\(row\[source\.columns\.conversion/);
  assert.match(functionBody, /gmv: value\.hasGmv \? value\.gmv : null/);
  assert.match(functionBody, /roi: value\.hasGmv && value\.hasCost/);
  assert.doesNotMatch(functionBody, /roi: value\.cost > 0 \? value\.gmv \/ value\.cost : 0/);
});
