import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('9.7 business traffic uses seven non-overlapping canonical channels', async () => {
  const [query, route, dashboard, css] = await Promise.all([
    read('runtime/data-center/app/api/_lib/dashboard-agent.ts'), read('runtime/data-center/app/api/dashboard/route.ts'),
    read('runtime/data-center/app/dashboard.tsx'), read('runtime/data-center/app/globals.css'),
  ]);
  for (const label of ['自然推荐','付费推广','短视频引流','粉丝关注','同城','分享/私域','其他']) assert.match(route, new RegExp(label));
  assert.match(query, /channel_path NOT LIKE '%>%'/);
  assert.match(query, /transaction_amount_share_percent AS transaction_share_percent/);
  assert.match(query, /channel_gpm_yuan AS pay_gpm_yuan/);
  assert.match(dashboard, /trafficKnownTotal <= 100\.5/);
  assert.match(dashboard, /父子渠道不重复累计/);
  assert.match(css, /shop-switcher button\{min-height:78px/);
  assert.match(css, /shop-switcher button span\{font-size:16px/);
});

test('9.7 recruitment and anchor roster interactions retain honest source boundaries', async () => {
  const [recruitment, server, anchors] = await Promise.all([
    read('exports/recruitment-pool/recruitment-dashboard.html'), read('server.js'), read('exports/anchor-archives/recruitment-dashboard.html'),
  ]);
  assert.match(recruitment, /facts\?\.\[key\]\?\?'待核验'/);
  assert.match(recruitment, /calendarSourceStatus/);
  assert.match(server, /RECRUITMENT_CALENDAR_ID/);
  assert.match(server, /当前群聊记录不冒充正式日历/);
  for (const filter of ['active','senior','newcomer','leaving']) assert.match(anchors, new RegExp(`data-metric-filter="${filter}"`));
  assert.match(anchors, /max-height:720px/);
});

test('9.7 dispatch storage is health-gated and monthly rest is explicitly saved', async () => {
  const [html, client, server, css, deploy] = await Promise.all([
    read('runtime/dispatch-center/index.html'), read('runtime/dispatch-center/planning-workbench.js'),
    read('runtime/dispatch-center/schedule-api-server.js'), read('runtime/dispatch-center/planning-workbench-20260829.css'),
    read('deploy-dispatch-parser-safe.sh'),
  ]);
  assert.match(html, /saveRestEntitlement/);
  assert.match(client, /固定月应休已保存/);
  for (const shift of ['shift-ac1','shift-f','shift-q','shift-rest']) assert.match(css, new RegExp(shift));
  assert.match(server, /planningStorageHealth/);
  assert.match(server, /fsConstants\.R_OK \| fsConstants\.W_OK/);
  assert.doesNotMatch(deploy, /sudo -n/);
});

test('9.7 removes redundant collaboration strip and makes the generator a dedicated long-form page', async () => {
  const [collaboration, scripts, page, client, server] = await Promise.all([
    read('runtime/collaboration-center/app/dashboard.tsx'), read('exports/material-center/material-scripts.html'),
    read('exports/material-center/communication-generator.html'), read('exports/material-center/communication-generator.js'), read('server.js'),
  ]);
  assert.doesNotMatch(collaboration, /<section className="priority-strip"/);
  assert.match(scripts, /communication-generator\.html\?embed=1/);
  assert.doesNotMatch(scripts, /communicationGeneratorDialog/);
  assert.match(page, /rows="28"/);
  assert.match(client, /使用方法与换角度/);
  assert.match(server, /5—7 分钟两轮循环/);
  assert.match(server, /generated_script_noncompliant/);
  assert.match(server, /text\.length < 1500/);
});

test('9.7 cue-card controls are legible without draft or V-number labels', async () => {
  const [html, css] = await Promise.all([read('exports/material-center/material-cue-cards.html'), read('exports/material-center/material-cue-cards-fixes.css')]);
  assert.match(html, /✎ 编辑/);
  assert.match(html, /⇩ 下载/);
  assert.match(html, /⌫ 删除/);
  assert.doesNotMatch(html, / · V/);
  assert.doesNotMatch(html, />草稿</);
  assert.match(css, /cue-action-download/);
});
