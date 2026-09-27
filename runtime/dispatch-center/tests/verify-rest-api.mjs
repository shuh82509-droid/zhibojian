import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Local fixture authority and app share a network-none container. No formal
// credentials, volume, Feishu endpoint, or outbound network is available.
const authority = http.createServer((request, response) => {
  if (request.url !== '/api/central-auth/me') {
    response.writeHead(404).end(); return;
  }
  const token = request.headers['x-oa-token'];
  if (!['fixture-viewer', 'fixture-manager'].includes(token)) {
    response.writeHead(401, {'Content-Type':'application/json'})
      .end(JSON.stringify({detail:'fixture unauthenticated'})); return;
  }
  response.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({
    user:{id:'fixture-user',realName:'测试角色'},
    access:{allowed_modules:['live-room-management']},
    permissions:token === 'fixture-manager' ? {super_admin:true} : {},
  }));
});
await new Promise(resolve => authority.listen(0, '127.0.0.1', resolve));
const authorityPort = authority.address().port;
const dataDir = mkdtempSync(join(tmpdir(),'wis-dispatch-rest-api-'));
const serverPath = resolve(dirname(fileURLToPath(import.meta.url)),'../schedule-api-server.js');

let child;
async function launch(restEnabled) {
  child = spawn('node', [serverPath], {
  env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,NODE_ENV:'test',HOST:'127.0.0.1',DISPATCH_CENTER_PORT:'3100',
    CENTRAL_AUTHORITY_BASE:`http://127.0.0.1:${authorityPort}/api`,
    HUB_SAME_ORIGIN_EMBED:'true',RECOVERY_READ_ONLY:'1',
    PLANNING_DRAFT_WRITES_ENABLED:'0',PLANNING_TOTAL_IMPORT_ENABLED:'0',
    PLANNING_REST_STATISTICS_ENABLED:restEnabled?'1':'0',
    FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',DATA_DIR:dataDir},
  stdio:['ignore','pipe','pipe'],
  });
}
let childLog = '';
const base = 'http://127.0.0.1:3100';
async function call(path, token = '', method = 'GET') {
  const response = await fetch(base + path, {
    method, headers:token ? {'X-OA-Token':token} : {}, redirect:'manual',
  });
  return {status:response.status,body:await response.json().catch(() => ({}))};
}
try {
  await launch(false);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    childLog = (childLog + chunk.toString()).slice(-2000);
  });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await call('/api/health'); ready = true; break; }
    catch { if (child.exitCode !== null) break; await delay(100); }
  }
  if (!ready) throw new Error('isolated Dispatch did not listen: ' + childLog);
  const health = await call('/api/health');
  assert.equal(health.status, 503, 'offline health must not claim real source');
  assert.equal(health.body.ok, false);
  assert.equal(health.body.writeback, 'paused_recovery');
  const path = '/api/planning/rest-statistics?month=2026-09';
  const anonymous = await call(path);
  assert.equal(anonymous.status, 401, 'localhost cannot bypass embedded auth');
  const viewer = await call(path, 'fixture-viewer');
  assert.equal(viewer.status, 403);
  assert.equal(viewer.body.code, 'PLANNING_ADMIN_REQUIRED');
  const managerDisabled = await call(path, 'fixture-manager');
  assert.equal(managerDisabled.status, 423, 'default OFF must not read or count data');
  assert.equal(managerDisabled.body.code, 'REST_STATISTICS_DISABLED');
  const write = await call('/api/planning/import', 'fixture-manager', 'POST');
  assert.equal(write.status, 423, 'read-only candidate rejects write');
  assert.equal(write.body.code, 'recovery_read_only');
  const dataFiles = readdirSync(dataDir);
  assert.ok(!dataFiles.some(name => /audit|workbench|import/iu.test(name)),
    'diagnostic GET must not create writable audit or workbench state');
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)),delay(2000)]);
  await launch(true);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    childLog = (childLog + chunk.toString()).slice(-2000);
  });
  let enabledReady = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await call('/api/health'); enabledReady = true; break; }
    catch { if (child.exitCode !== null) break; await delay(100); }
  }
  if (!enabledReady) throw new Error('enabled isolated Dispatch did not listen: ' + childLog);
  const managerInvalid = await call('/api/planning/rest-statistics?month=2026-10','fixture-manager');
  assert.equal(managerInvalid.status,422);
  assert.equal(managerInvalid.body.code,'REST_STATISTICS_MONTH_UNVERIFIED');
  const managerNoSource = await call(path,'fixture-manager');
  assert.equal(managerNoSource.status,503,'no source must not return an invented statistic');
  assert.equal(managerNoSource.body.code,'planning_baseline_invalid');
  console.log(JSON.stringify({formalDataMounted:false,health:health.status,
    anonymous:anonymous.status,viewer:viewer.status,
    managerDisabled:managerDisabled.status,managerInvalid:managerInvalid.status,
    managerNoSource:managerNoSource.status,managerWrite:write.status,readOnly:true}));
} finally {
  child?.kill('SIGTERM');
  if (child) await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(2000)]);
  await new Promise(resolve => authority.close(resolve));
  rmSync(dataDir,{recursive:true,force:true});
}
