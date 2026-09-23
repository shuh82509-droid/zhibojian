import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../central-auth-sidecar.py', import.meta.url), 'utf8');
const deploy = await readFile(new URL('../deploy-central-auth-sidecar.sh', import.meta.url), 'utf8');
const nginx = await readFile(new URL('../central-auth-sidecar.nginx.conf', import.meta.url), 'utf8');
const liveDeploy = await readFile(new URL('../deploy-live-hub-v3.sh', import.meta.url), 'utf8');

test('auth sidecar reuses live OA and permission enforcement without video-center lifespan', () => {
  assert.match(source, /from \.auth import _organization_from_user, require_user/);
  assert.match(source, /from \.main import module_access_for_user, user_permissions/);
  assert.match(source, /@app\.get\("\/api\/central-auth\/me"\)/);
  assert.doesNotMatch(source, /lifespan|create_task|BackgroundTasks/);
});

test('sidecar deploy uses isolated candidate, persistent data, and rollback evidence', () => {
  assert.match(deploy, /fd-026222-wis-central-auth-candidate/);
  assert.match(deploy, /127\.0\.0\.1:39026:3000/);
  assert.match(deploy, /127\.0\.0\.1:39025:3000/);
  assert.match(deploy, /-v \"\$video_runtime\/data:\/data\"/);
  assert.match(deploy, /ENTRYPOINT \[\"uvicorn\"\]/);
  assert.match(deploy, /rollback_image/);
  assert.match(deploy, /sudo nginx -t/);
  assert.match(deploy, /PRODUCTION_PUBLIC_CENTRAL_AUTH_STATUS/);
});

test('only the scoped auth route is published and live center keeps the old route as fallback', () => {
  assert.match(nginx, /location \^~ \/fd-026222\/wis-central-auth\//);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:39025\//);
  assert.match(liveDeploy, /central_authority_base="https:\/\/app\.fandow\.top\/fd-026222\/wis-central-auth\/api"/);
  assert.match(liveDeploy, /central_authority_fallback_base="https:\/\/app\.fandow\.top\/fd-026222\/wis-video-center\/api"/);
});
