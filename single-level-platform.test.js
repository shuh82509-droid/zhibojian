const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'site', 'index.html'), 'utf8');

test('complete live platform owns the only global navigation', () => {
  const navigation = ['直播经营看板', '主播全生命周期管理', '调度中心', '协同中心', '素材中心'];
  for (const label of navigation) assert.equal(html.includes(label), true, `missing navigation: ${label}`);
  assert.equal((html.match(/<aside\b/gu) || []).length, 1);
});

test('global platform sidebar renders the central account session', () => {
  for (const marker of ['platformUserName', 'platformUserRole', "basePath+'api/session'"]) {
    assert.equal(html.includes(marker), true, `missing central account marker: ${marker}`);
  }
});
