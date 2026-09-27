import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const testRoot = dirname(fileURLToPath(import.meta.url));
const serverPath = process.env.REST_TEST_SERVER_PATH || resolve(testRoot,'../schedule-api-server.js');
const mockPath = resolve(testRoot,'feishu-rest-mock.cjs');
const dataDir = mkdtempSync(join(tmpdir(),'wis-rest-505-fixture-'));
writeFileSync(join(dataDir,'planning-baseline-manifest.json'),JSON.stringify({
  schemaVersion:1,spreadsheetToken:'Wj4zs3oDfhGUfetlTXicxblmnHe',sheetId:'0jFdXf',
  revision:504,checkedAt:new Date().toISOString(),historyStatus:'pending_recovery',
}));

const authority = http.createServer((request,response) => {
  if (request.url !== '/api/central-auth/me') return response.writeHead(404).end();
  const role = request.headers['x-oa-token'];
  if (!['fixture-manager','fixture-viewer'].includes(role)) return response.writeHead(401,{'Content-Type':'application/json'}).end('{}');
  response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({
    user:{id:'fixture-user',realName:'测试角色'},
    access:{allowed_modules:['live-room-management']},
    permissions:role === 'fixture-manager' ? {operation_admin:true} : {},
  }));
});
await new Promise(resolve => authority.listen(0,'127.0.0.1',resolve));
const authorityPort = authority.address().port;

async function freePort() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0,'127.0.0.1',resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function runScenario(scenario) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath,['--require',mockPath,serverPath],{
    env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,NODE_ENV:'test',
      HOST:'127.0.0.1',DISPATCH_CENTER_PORT:String(port),
      CENTRAL_AUTHORITY_BASE:`http://127.0.0.1:${authorityPort}/api`,
      HUB_SAME_ORIGIN_EMBED:'true',RECOVERY_READ_ONLY:'1',
      PLANNING_DRAFT_WRITES_ENABLED:'0',PLANNING_TOTAL_IMPORT_ENABLED:'0',
      PLANNING_REST_STATISTICS_ENABLED:'1',
      FEISHU_APP_ID:'fixture-app',FEISHU_APP_SECRET:'fixture-secret',
      DATA_DIR:dataDir,MOCK_REST_SCENARIO:scenario},
    stdio:['ignore','pipe','pipe'],
  });
  let log = '';
  for (const stream of [child.stdout,child.stderr]) stream.on('data',chunk => { log = (log + chunk.toString()).slice(-4000); });
  async function call(token = '') {
    const response = await fetch(`${base}/api/planning/rest-statistics?month=2026-09`,{
      headers:token ? {'X-OA-Token':token} : {},redirect:'manual',
    });
    return {status:response.status,data:await response.json().catch(() => ({}))};
  }
  try {
    let ready = false;
    for (let index=0; index<50; index+=1) {
      try { await fetch(`${base}/api/health`); ready = true; break; }
      catch { if (child.exitCode !== null) break; await delay(100); }
    }
    assert.ok(ready,`isolated server did not listen: ${log}`);
    const anonymous = await call();
    const viewer = await call('fixture-viewer');
    const manager = await call('fixture-manager');
    assert.equal(anonymous.status,401);
    assert.equal(viewer.status,403);
    assert.equal(viewer.data.code,'PLANNING_ADMIN_REQUIRED');
    assert.equal(JSON.stringify(anonymous.data).includes('fixture-uid'),false);
    assert.equal(JSON.stringify(viewer.data).includes('fixture-uid'),false);
    return manager;
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit',resolve)),delay(2000)]);
  }
}

try {
  const valid = await runScenario('valid');
  assert.equal(valid.status,200,JSON.stringify(valid.data));
  assert.equal(valid.data.ok,true);
  assert.equal(valid.data.data.source.revision,505);
  assert.deepEqual(valid.data.data.totals,{explicitRestDays:1,explicitWorkDays:1,pendingDays:1558,
    pendingByReason:{gray:48,blank:1510,leave:0,invalidShift:0,unknown:0}});
  assert.deepEqual([valid.data.data.people[42].explicitRestDays,valid.data.data.people[42].pendingDays],[0,30],
    'revision-bound gray E47 must not be counted as rest');
  assert.equal(valid.data.data.readOnly,true);
  assert.equal(valid.data.data.writeBackAllowed,false);
  const full = await runScenario('full-aggregate');
  assert.equal(full.status,200,JSON.stringify(full.data));
  assert.deepEqual(full.data.data.totals,{explicitRestDays:334,explicitWorkDays:1107,pendingDays:119,
    pendingByReason:{gray:48,blank:68,leave:0,invalidShift:3,unknown:0}});
  const pending = full.data.data.people.flatMap((person) => person.pendingCells);
  assert.equal(pending.length,119);
  assert.equal(new Set(pending.map((item) => item.cell)).size,119);
  assert.deepEqual(pending.filter((item) => item.reason === 'invalidShift').map((item) => item.cell).sort(),
    ['AD48','AG40','AH40']);
  assert.ok(pending.every((item) => !Object.hasOwn(item,'value') && !Object.hasOwn(item,'uid')));
  assert.equal((await runScenario('revision-drift')).data.code,'REST_STATISTICS_STYLE_UNVERIFIED');
  assert.equal((await runScenario('wrong-dimensions')).data.code,'planning_source_unverified');
  assert.equal((await runScenario('duplicate-identity')).data.code,'REST_STATISTICS_SOURCE_UNVERIFIED');
  const wrongWorkbook = await runScenario('wrong-workbook');
  assert.equal(wrongWorkbook.status,422);
  assert.equal(wrongWorkbook.data.code,'TOTAL_SCHEDULE_WORKBOOK_MISMATCH');
  console.log(JSON.stringify({mockedFeishuOnly:true,validStatus:valid.status,syntheticFullAggregate:'334/1107/119',
    revisionDrift:'blocked',wrongDimensions:'blocked',duplicateIdentity:'blocked',
    wrongWorkbook:'blocked',anonymous:'401',viewer:'403',writeback:false}));
} finally {
  await new Promise(resolve => authority.close(resolve));
  rmSync(dataDir,{recursive:true,force:true});
}
