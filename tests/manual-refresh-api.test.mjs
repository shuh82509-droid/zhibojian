import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('manual lifecycle refresh is permission-gated and requires an explicit POST marker', async () => {
  const source = await readFile(join(root, 'server.js'), 'utf8');
  assert.match(source, /req\.method === 'POST' && routePath === '\/api\/lifecycle\/refresh'/u);
  assert.match(source, /if \(!canRefreshLifecycle\(auth\)\) return json\(res, 403/u);
  assert.match(source, /req\.headers\['x-lifecycle-refresh'\] !== 'manual'/u);
  assert.match(source, /permissions\.super_admin \|\| permissions\.operation_admin \|\| permissions\.manage_permissions/u);
  assert.match(source, /return json\(res, 202/u);
  assert.match(source, /accepted:true/u);
});

test('both manual refresh buttons call the shared lifecycle endpoint with the required marker', async () => {
  const pages = [
    ['exports\\recruitment-pool\\recruitment-dashboard.html', 'recruitment'],
    ['exports\\anchor-archives\\recruitment-dashboard.html', 'anchors'],
  ];
  for (const [relative, module] of pages) {
    const html = await readFile(join(root, relative), 'utf8');
    assert.ok(html.includes(`api/lifecycle/refresh?module=${module}`), `${relative} uses the wrong module endpoint`);
    assert.match(html, /method:'POST'/u);
    assert.match(html, /'X-Lifecycle-Refresh':'manual'/u);
    assert.match(html, /refreshButton\.disabled=true/u);
    assert.match(html, /api\/lifecycle\/status\?_=/u);
  }
});

test('production deployment enables and verifies the 09:30 and 18:00 Asia Shanghai scheduler', async () => {
  const source = await readFile(join(root, 'deploy-live-hub-v3.sh'), 'utf8');
  assert.match(source, /d\.get\("schedulerEnabled"\) is True/u);
  assert.match(source, /d\.get\("refreshRule"\)=="Asia\/Shanghai 09:30,18:00 daily"/u);
  assert.doesNotMatch(source, /--env-file "\$main_runtime\/\.env\.minimax" \\\n+\s+-e LIFECYCLE_SCHEDULER_ENABLED=0 \\\n+\s+-v "\$main_runtime\/data:\/app\/data" -p 127\.0\.0\.1:24500:3000/u);
});
