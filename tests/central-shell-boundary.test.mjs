import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { frameHeadersForHub } from "../frame-policy.mjs";

const root = new URL("../", import.meta.url);

test("live hub keeps child modules single-level and recovers shell links", async () => {
  const [server, shell, layout] = await Promise.all([
    readFile(new URL("server.js", root), "utf8"),
    readFile(new URL("site/index.html", root), "utf8"),
    readFile(new URL("runtime/data-center/app/layout.tsx", root), "utf8"),
  ]);

  assert.match(server, /<base target="_top">/);
  assert.match(server, /target="_top" rel="noreferrer">返回中枢/);
  assert.match(server, /Object\.assign\(headers, frameHeaders\)/);
  assert.deepEqual(frameHeadersForHub(false), {
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
  });
  assert.deepEqual(frameHeadersForHub(true), {
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self'",
  });
  assert.match(shell, /recruitment-dashboard\.html\?embed=1&v=20260907a/);
  assert.match(shell, /material-center\.html\?embed=1&v=\d{8}[a-z0-9]*/);
  assert.match(shell, /liveHubNavigationGuard/);
  assert.match(shell, /const platformUserName=document\.getElementById\('platformUserName'\)/);
  assert.match(shell, /const platformUserRole=document\.getElementById\('platformUserRole'\)/);
  assert.match(shell, /const platformAvatar=document\.getElementById\('platformAvatar'\)/);
  assert.match(shell, /id="platformSessionData" type="application\/json">__PLATFORM_SESSION__/);
  assert.match(shell, /renderPlatformSession\(JSON\.parse\(embedded\)\)/);
  assert.match(server, /template\.replace\('__PLATFORM_SESSION__', session\)/);
  assert.match(server, /routePath === '\/index\.html'/);
  assert.doesNotMatch(shell, /window\.top\.location\.replace\(frameUrl\)/);
  assert.match(server, /\['\.html','\.css','\.js'\]\.includes\(extension\).*Cache-Control'\]='no-store'/s);
  assert.match(layout, /target="_top" rel="noreferrer"/);
});

test("live hub has a same-host authority fallback", async () => {
  const [server, centralAuth] = await Promise.all([
    readFile(new URL("server.js", root), "utf8"),
    readFile(new URL("runtime/data-center/app/api/_lib/central-auth.ts", root), "utf8"),
  ]);

  assert.match(server, /CENTRAL_AUTHORITY_FALLBACK_BASE/);
  assert.match(server, /response\.status < 500/);
  assert.match(centralAuth, /CENTRAL_AUTHORITY_FALLBACK_BASE/);
  assert.match(centralAuth, /response\.status < 500/);
});

test("live hub coalesces central-auth checks and uses only a short stale window", async () => {
  const server = await readFile(new URL("server.js", root), "utf8");
  for (const text of ["centralAuthCache", "centralAuthInFlight", "centralAuthCacheKey", "expiresAt: now + 30_000", "staleUntil: now + 60_000", "AbortSignal.timeout(8_000)"]) {
    assert.ok(server.includes(text), `central-auth resilience missing ${text}`);
  }
});

test("live hub contains rejected Feishu streams and deployment avoids stale Docker links", async () => {
  const [server, deployment] = await Promise.all([
    readFile(new URL("server.js", root), "utf8"),
    readFile(new URL("deploy-live-hub-v3.sh", root), "utf8"),
  ]);

  assert.match(server, /return await proxyFeishuResource\(/);
  assert.match(server, /return await proxyFeishuMessageResource\(/);
  assert.match(server, /handleRequest\(req, res\)\.catch\(/);
  assert.doesNotMatch(deployment, /--link(?:\s|$)/);
  assert.match(deployment, /CANDIDATE_CENTRAL_AUTH_NO_DOCKER_LINK=passed/);
  assert.match(deployment, /CANDIDATE_FEISHU_RESOURCE_ERROR_BOUNDARY=passed/);
  assert.match(deployment, /PRODUCTION_FEISHU_RESOURCE_ERROR_BOUNDARY=passed/);
  assert.match(deployment, /HostConfig\.Links/);
});
