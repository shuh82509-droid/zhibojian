import { parseFeishuDashboardRows } from "../app/api/_lib/feishu-dashboard-fallback.ts";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

const payload = JSON.parse(input) as Record<string, unknown[][]>;
const expected = ["guanqi", "brand-selection", "preferred", "wangou"];
const parsed = expected.map((sourceCode) => {
  const rows = payload[sourceCode] ?? [];
  if (!rows.length) return { sourceCode, missing: true };
  const result = parseFeishuDashboardRows(sourceCode, "2026-08-18", rows);
  return {
    sourceCode,
    missing: false,
    session: result.session,
    traffic: result.traffic,
    trendPoints: result.trend.length,
  };
});

console.log(JSON.stringify(parsed, null, 2));
const invalid = parsed.filter((item) => !item.missing && (!item.session?.gmv || !item.trendPoints));
if (invalid.length) {
  console.error(`INVALID_FALLBACK=${invalid.map((item) => item.sourceCode).join(",")}`);
  process.exitCode = 2;
}
