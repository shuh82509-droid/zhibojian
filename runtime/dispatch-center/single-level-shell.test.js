const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('dispatch center is a content module without a second navigation hierarchy', () => {
  assert.match(html, /<body class="module-view" data-dispatch-page="current">/u);
  assert.doesNotMatch(html, /<aside\b[^>]*class="sidebar"/u);
  for (const duplicateLabel of ['总览', '数据中心', '档案中心', '素材中心']) {
    assert.equal(html.includes(duplicateLabel), false, `duplicate navigation remains: ${duplicateLabel}`);
  }
});

test('dispatch view tabs stay in place and never jump to another shell', () => {
  assert.match(html, /data-view-tab="current"/u);
  assert.match(html, /data-view-tab="workbench"/u);
  assert.match(app, /setDispatchView/u);
  assert.doesNotMatch(app, /window\.location\.replace/u);
  assert.doesNotMatch(app, /\/fd-027340\/live-center-workbench\/#schedule/u);
});

test('dispatch root page accepts current and workbench query views', () => {
  const server = fs.readFileSync(path.join(__dirname, 'schedule-api-server.js'), 'utf8');
  assert.match(server, /new URL\(request\.url, `http:\/\/\$\{HOST\}`\)\.pathname/u);
  assert.doesNotMatch(server, /request\.url === '\/'/u);
});

test('dispatch authorization uses the stable central authority route', () => {
  const server = fs.readFileSync(path.join(__dirname, 'schedule-api-server.js'), 'utf8');
  assert.match(server, /fd-026222\/wis-central-auth\/api/u);
  assert.doesNotMatch(server, /CENTRAL_AUTHORITY_BASE \|\| 'https:\/\/app\.fandow\.top\/fd-026222\/wis-video-center\/api'/u);
});

test('planning workbench uses the finalized September schedule source', () => {
  const server = fs.readFileSync(path.join(__dirname, 'schedule-api-server.js'), 'utf8');
  assert.match(server, /UKVDwxpz7iKAv8k5KxTcxiDVnuf/u);
  assert.match(server, /sheetId: '0jFdXf'/u);
  assert.match(server, /品牌营销部-直播中心排班表_20260901_20260930/u);
  assert.match(html, /wiki\/UKVDwxpz7iKAv8k5KxTcxiDVnuf/u);
  assert.match(server, /resolveSpreadsheetSheetMetadata/u);
  assert.doesNotMatch(html, /N22ZwGT6Piz49RkdnZkchsH1nBd/u);
});
