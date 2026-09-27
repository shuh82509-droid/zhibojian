'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

const root = join(__dirname,'..');
const html = readFileSync(join(root,'index.html'),'utf8');
const css = readFileSync(join(root,'planning-workbench.css'),'utf8');
const script = readFileSync(join(root,'planning-workbench.js'),'utf8');
const server = readFileSync(join(root,'schedule-api-server.js'),'utf8');

test('read-only rest section is hidden by default and contains no business action', () => {
  const section = html.match(/<section\b[^>]*class="[^"]*\bmonthly-rest-statistics\b[^"]*"[\s\S]*?<\/section>/u)?.[0];
  assert.ok(section);
  assert.match(section,/id="monthlyRestStatistics"[^>]* hidden>/u);
  assert.match(section,/仅“休息”计明确休息/u);
  assert.match(section,/可展开查看待核原因与单元格坐标/u);
  assert.match(section,/不计算剩余月休，不写回/u);
  assert.doesNotMatch(section,/<input|<select|确认导入|保存|写回按钮/iu);
  assert.match(css,/\.monthly-rest-statistics\[hidden\][^{]*\{display:none!important\}/u);
});

test('page obeys server capability and calls only read-only route with escaped text', () => {
  const load = script.slice(script.indexOf('async function loadMonthlyRestStatistics()'),script.indexOf('function defaultRange'));
  assert.ok(load);
  assert.match(script,/restStatisticsCapability: \{enabled:false\}/u);
  assert.match(script,/\$\('#monthlyRestStatistics'\)\.hidden = !state\.restStatisticsCapability\.enabled/u);
  assert.match(load,/if \(!state\.restStatisticsCapability\.enabled\) return/u);
  assert.match(load,/requestPlanning\('\/api\/planning\/rest-statistics\?month=2026-09'\)/u);
  assert.match(load,/!data\?\.readOnly \|\| data\.writeBackAllowed !== false/u);
  assert.match(load,/validBreakdown\(data\.totals\.pendingByReason, data\.totals\.pendingDays\)/u);
  assert.match(load,/person\.pendingCells\.map/u);
  assert.match(load,/pEsc\(item\.cell\)/u);
  assert.match(load,/pEsc\(person\.name\)/u);
  assert.doesNotMatch(load,/method\s*:\s*['"]POST|\/import|\/draft|\/rest-setting/u);
  assert.match(server,/const PLANNING_REST_STATISTICS_ENABLED = process\.env\.PLANNING_REST_STATISTICS_ENABLED === '1'/u);
  assert.match(server,/if \(!canManagePlanning\(auth\)\).*PLANNING_ADMIN_REQUIRED/u);
  assert.match(server,/if \(!PLANNING_REST_STATISTICS_ENABLED\).*REST_STATISTICS_DISABLED/u);
});
