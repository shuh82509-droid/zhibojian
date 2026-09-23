import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('communication generator is source-gated and opens a dedicated long-form page', async () => {
  const [server, html, page, client, css] = await Promise.all([
    read('server.js'), read('exports/material-center/material-scripts.html'), read('exports/material-center/communication-generator.html'), read('exports/material-center/communication-generator.js'),
    read('exports/material-center/communication-generator.css'),
  ]);
  for (const stage of ['暖场与痛点','卖点与背书','机制与售后','第一轮逼单','第二轮承接','使用方法与换角度','循环收口']) {
    assert.match(server, new RegExp(stage));
    assert.match(client, new RegExp(stage));
  }
  for (const product of ['水润面膜','晶润眼膜','乳糖酸面膜','微针面膜','深海次抛','燕窝面膜']) assert.match(server, new RegExp(product));
  assert.match(html, /沟通稿自动生成器/);
  assert.match(html, /communication-generator\.html\?embed=1/);
  assert.doesNotMatch(html, /communicationGeneratorDialog/);
  for (const text of ['主播人设','单播','双播','抖音','视频号','生成篇数','价格机制','主品数量','赠品','合规复核','历史生成稿']) assert.match(page,new RegExp(text));
  assert.match(page, /新增产品与可验证资料/);
  assert.match(page, /完整两轮沟通稿/);
  assert.match(server, /missing_product_sources/);
  assert.match(server, /禁止补造功效、成分、数据、奖项、价格、数量、赠品/);
  assert.match(server, /RylnbGUF4aPi6is8LGqciehcn3g/);
  assert.match(client, /\/api\/script-generator\/generate/);
  assert.match(client, /\/api\/script-generator\/save/);
  assert.match(css, /\.communication-generator-page/);
  assert.match(css, /min-height:680px/);
  assert.match(server, /generated_script_noncompliant/);
});

test('embedded lifecycle and material modules own their single-level layout', async () => {
  const [shell, anchor, material, embeddedCss] = await Promise.all([
    read('site/index.html'), read('exports/anchor-archives/recruitment-dashboard.html'),
    read('exports/material-center/material-center.html'), read('exports/material-center/embedded-shell.css'),
  ]);
  assert.match(shell, /modules\/anchors\/recruitment-dashboard\.html\?embed=1/);
  assert.match(shell, /modules\/materials\/material-center\.html\?embed=1/);
  assert.match(anchor, /live-hub-embedded/);
  assert.match(material, /live-hub-embedded/);
  assert.match(embeddedCss, /live-hub-embedded \.sidebar\{display:none\}/);
});

test('anchor development separates ABCD periodic ratings from 0-100 growth records', async () => {
  const [server, html, client] = await Promise.all([
    read('server.js'), read('exports/anchor-archives/recruitment-dashboard.html'), read('exports/anchor-archives/assets/anchor-development.js'),
  ]);
  for (const dimension of ['话术', '节奏', '演绎', '控场']) assert.match(server, new RegExp(dimension));
  for (const course of ['沟通稿框架', '镜头表现力', '基础数据讲解', '关键数据解析', '节奏把控力', '话术结构进阶课', '逼单和种草专项课', '心态管理课']) assert.match(server, new RegExp(course));
  assert.match(html, /能力与新人池/);
  assert.match(html, /主播周期评级与成长档案/);
  assert.match(client, /在职主播周期评级/);
  assert.match(client, /data-matrix-ability/);
  assert.match(client, /\['A','B','C','D'\]/);
  assert.match(client, /成长记录/);
  assert.match(client, /devGrowthScore/);
  assert.match(server, /ratingScale:\{values:\['A','B','C','D'\],unit:'等级'\}/);
  assert.match(server, /growthScale:\{min:0,max:100,unit:'分'\}/);
  assert.match(server, /growthRecords/);
  assert.match(server, /latestGrade/);
  assert.match(server, /'黄芷瞳':'黄芷曈'/);
  assert.match(server, /source:'manual'/);
  assert.match(client, /近 5 日可验证评价/);
  assert.match(client, /近 3 日录屏 \/ 录音/);
  assert.match(server, /oc_a5640cee560bb4078ded95fc2278c329/);
  assert.match(server, /getChatMessages\('coaching', 500/);
  assert.match(server, /getChatMessages\('learning', 500/);
});

test('business dashboard uses the approved channel and strategy-audience attribution contract', async () => {
  const [dashboard, route] = await Promise.all([
    read('runtime/data-center/app/dashboard.tsx'), read('runtime/data-center/app/api/dashboard/route.ts'),
  ]);
  assert.match(dashboard, /成交构成/);
  assert.match(dashboard, /用户支付金额占比/);
  assert.match(dashboard, /渠道千次观看成交/);
  assert.match(dashboard, /直播间策略人群构成/);
  for (const label of ['小镇青年','都市银发','小镇中老年','都市蓝领','资深中产','新锐白领','精致妈妈','Z世代']) assert.match(dashboard, new RegExp(label));
  for (const label of ['自然推荐','付费推广','短视频引流','粉丝关注','同城','分享\/私域','其他']) assert.match(dashboard, new RegExp(label));
  assert.match(dashboard, /任一来源缺失均独立标记/);
  assert.match(route, /transactionStatus: "待接入"/);
  assert.doesNotMatch(route, /transactionShare:\s*0(?:\D|$)/);
  assert.match(route, /sourceFailureMessage\(String\(mcpErrors\.sessions\)\)/);
  assert.match(route, /sourceFailureMessage\(String\(mcpErrors\.audience\)\)/);
  assert.doesNotMatch(dashboard, /MCP 数据分析代理运行中/);
});

test('business overview and room data are separate routes with bounded independent loading', async () => {
  const [shell, dashboard, mcp] = await Promise.all([
    read('site/index.html'), read('runtime/data-center/app/dashboard.tsx'), read('runtime/data-center/app/api/_lib/mcp.ts'),
  ]);
  assert.match(shell, /WIS直播中心总览/);
  assert.match(shell, /各直播间数据/);
  assert.match(shell, /view=overview/);
  assert.match(shell, /view=data/);
  assert.match(dashboard, /pageView === "overview"/);
  assert.match(dashboard, /Promise\.allSettled/);
  assert.match(mcp, /AbortSignal\.timeout\(9000\)/);
  assert.match(mcp, /MAX_ACTIVE_CALLS = 2/);
  assert.match(mcp, /AUTH_BLOCK_MS = 60000/);
});

test('user-facing anchor archive explains source gaps without technical MCP wording', async () => {
  const [archive, trends] = await Promise.all([
    read('exports/anchor-archives/assets/anchor-data.js'),
    read('exports/anchor-archives/assets/anchor-trends.js'),
  ]);
  assert.doesNotMatch(archive, /MCP/i);
  assert.doesNotMatch(trends, /MCP/i);
  assert.match(archive, /实时经营数据源授权失效/);
  assert.match(archive, /视频号快照暂未回传/);
  assert.match(trends, /待数据源重新授权后补录/);
});

test('new communication links render inside the selected product group', async () => {
  const html = await read('exports/material-center/material-scripts.html');
  assert.match(html, /window\.updateUploadedScripts/);
  assert.match(html, /uploadedScriptData = items\.map/);
  assert.match(html, /已保存到下方/);
  assert.doesNotMatch(html, /class="uploaded-script-item"/);
});

test('daily maintenance adds persistent calendar overrides, dispatch staffing fallback and dynamic resource order', async () => {
  const [server, dashboard, route, dispatchHtml, dispatchClient] = await Promise.all([
    read('server.js'), read('runtime/data-center/app/dashboard.tsx'), read('runtime/data-center/app/api/dashboard/route.ts'),
    read('runtime/dispatch-center/index.html'), read('runtime/dispatch-center/app.js'),
  ]);
  assert.match(server, /live-calendar-overrides\.json/);
  assert.match(server, /\/api\/calendar-overrides/);
  assert.match(dashboard, /手动调整/);
  assert.match(route, /dispatch-center\/api\/schedule/);
  assert.match(dispatchHtml, /data-resource-room="wangou"/);
  assert.match(dispatchClient, /loadResourcePriorities/);
});
