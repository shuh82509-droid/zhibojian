'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {readPlanningBaselineManifest,readPlanningEpoch,initializePlanningEpoch} = require('./schedule-api-server');

const token='Wj4zs3oDfhGUfetlTXicxblmnHe';
const checkedAt=new Date().toISOString();
const source=()=>({schemaVersion:1,spreadsheetToken:token,sheetId:'0jFdXf',revision:498,checkedAt,historyStatus:'pending_recovery'});
const folder=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dispatch-baseline-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
async function availablePort(){
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
async function candidate(t,dir,readOnly,options={}){
  const port=await availablePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,[path.join(__dirname,'schedule-api-server.js')],{
    cwd:__dirname,stdio:['ignore','pipe','pipe'],windowsHide:true,
    env:{...process.env,HOST:'127.0.0.1',DISPATCH_CENTER_PORT:String(port),DATA_DIR:dir,HUB_SAME_ORIGIN_EMBED:options.authorityBase?'true':'false',
      RECOVERY_READ_ONLY:readOnly?'1':'0',RECOVERY_SOURCE_SNAPSHOT_PATH:'',RECOVERY_SOURCE_SNAPSHOT_SHA256:'',
      FEISHU_APP_ID:readOnly?'fixture':'',FEISHU_APP_SECRET:readOnly?'fixture':'',
      TOTAL_SCHEDULE_SPREADSHEET_TOKEN:token,TOTAL_SCHEDULE_SHEET_ID:'0jFdXf',
      PLANNING_DRAFT_WRITES_ENABLED:options.draftWrites?'1':'0',PLANNING_TOTAL_IMPORT_ENABLED:options.totalImport?'1':'0',
      ...(options.authorityBase?{CENTRAL_AUTHORITY_BASE:options.authorityBase}:{})},
  });
  let output='';child.stderr.on('data',chunk=>{output+=chunk.toString().slice(0,1000);});
  t.after(async()=>{child.kill();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,2000).unref();});});
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw Error(`candidate exited early: ${output}`);
    try{await fetch(base+'/api/health',{signal:AbortSignal.timeout(300)});return base;}catch{await new Promise(resolve=>setTimeout(resolve,50));}
  }
  throw Error(`candidate did not listen: ${output}`);
}

test('official baseline manifest accepts only the approved source and pending history boundary',async t=>{
  const dir=folder(t),file=path.join(dir,'planning-baseline-manifest.json');
  assert.equal(await readPlanningBaselineManifest(file),null);
  fs.writeFileSync(file,JSON.stringify({...source(),extra:'not exposed'}));
  assert.deepEqual(await readPlanningBaselineManifest(file),source());
  for(const changed of [{revision:0},{spreadsheetToken:'another'},{sheetId:'wrong'},{checkedAt:'not-a-date'},{historyStatus:'recovered'}]){
    fs.writeFileSync(file,JSON.stringify({...source(),...changed}));
    await assert.rejects(readPlanningBaselineManifest(file),error=>error.code==='planning_baseline_invalid');
  }
  fs.writeFileSync(file,'broken json');
  await assert.rejects(readPlanningBaselineManifest(file),error=>error.code==='planning_baseline_invalid');
});

test('recovery serves baseline metadata but missing old drafts and audit stay 503, all writes stay 423',async t=>{
  const dir=folder(t);fs.writeFileSync(path.join(dir,'planning-baseline-manifest.json'),JSON.stringify(source()));
  const base=await candidate(t,dir,true);
  const health=await (await fetch(base+'/api/health')).json();
  assert.equal(health.ok,true);assert.equal(health.planningBaseline.historyStatus,'pending_recovery');
  assert.equal(JSON.stringify(health).includes(token),false,'unauthenticated health must not expose workbook token');
  const status=await (await fetch(base+'/api/recovery/status')).json();
  assert.deepEqual(status.planningBaseline,source());
  const planning=await fetch(base+'/api/planning');assert.equal(planning.status,503);
  assert.equal((await planning.json()).code,'history_recovery_pending');
  const audit=await fetch(base+'/api/schedule/writeback/audit');assert.equal(audit.status,503);
  assert.equal((await audit.json()).code,'history_recovery_pending');
  const write=await fetch(base+'/api/planning/draft',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(write.status,423);assert.equal((await write.json()).code,'recovery_read_only');
  assert.equal(fs.existsSync(path.join(dir,'planning-workbench.json')),false);
});

test('new baseline without its dedicated epoch cannot silently become an empty writable history',async t=>{
  const dir=folder(t);fs.writeFileSync(path.join(dir,'planning-baseline-manifest.json'),JSON.stringify(source()));
  const base=await candidate(t,dir,false);
  const planning=await fetch(base+'/api/planning');assert.equal(planning.status,503);
  assert.equal((await planning.json()).code,'planning_epoch_uninitialized');
  const health=await fetch(base+'/api/health');assert.equal(health.status,503);
  assert.equal(fs.existsSync(path.join(dir,'planning-workbench.json')),false,'read must not create an empty historical file');
});

test('a separate initialized epoch preserves the old-history boundary and stays read-only until independent flags',async t=>{
  const dir=folder(t);const manifestPath=path.join(dir,'planning-baseline-manifest.json');fs.writeFileSync(manifestPath,JSON.stringify(source()));
  const paths={manifestPath,epochPath:path.join(dir,'planning-epoch.json'),storePath:path.join(dir,'planning-workbench.json'),auditPath:path.join(dir,'schedule-writeback-audit.ndjson'),guardPath:path.join(dir,'planning-import-guard.json')};
  await assert.rejects(initializePlanningEpoch(paths),error=>error.code==='planning_epoch_uninitialized');
  const epoch=await initializePlanningEpoch({...paths,confirm:true});
  assert.equal((await readPlanningEpoch(paths)).epoch.epochId,epoch.epochId);
  await assert.rejects(initializePlanningEpoch({...paths,confirm:true}),error=>error.code==='planning_epoch_uninitialized');
  const base=await candidate(t,dir,false);
  const planning=await fetch(base+'/api/planning');assert.equal(planning.status,200);
  const data=await planning.json();assert.equal(data.historyStatus,'pending_recovery');
  assert.deepEqual(data.planningBaseline,source());assert.deepEqual(data.drafts,{});assert.equal(data.epochId,epoch.epochId);
  assert.equal(data.draftCapability.enabled,false);assert.equal(data.totalImportCapability.enabled,false);
  const audit=await (await fetch(base+'/api/schedule/writeback/audit')).json();
  assert.equal(audit.historyStatus,'pending_recovery');assert.equal(audit.epochId,epoch.epochId);
  assert.equal(audit.items[0].action,'planning-epoch-initialized');
  assert.equal(fs.existsSync(path.join(dir,'planning-workbench.json')),true,'new epoch has its own store, not a recovered historical store');
  for(const route of ['/api/schedule/writeback/preview','/api/schedule/writeback','/api/planning/makeup/import/preview','/api/planning/makeup/import']){
    const response=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(response.status,423,route);
    assert.equal((await response.json()).code,'planning_source_unbaselined',route);
  }
  const readOnlyBase=await candidate(t,dir,true);
  for(const route of ['/api/planning','/api/schedule/writeback/audit']){
    const response=await fetch(readOnlyBase+route);
    assert.equal(response.status,503,`${route} must not expose new empty epoch as recovered old history`);
    assert.equal((await response.json()).code,'history_recovery_pending');
  }
});

test('missing or mismatched store and audit files fail closed, never becoming empty data',async t=>{
  const dir=folder(t);const paths={manifestPath:path.join(dir,'planning-baseline-manifest.json'),epochPath:path.join(dir,'planning-epoch.json'),storePath:path.join(dir,'planning-workbench.json'),auditPath:path.join(dir,'schedule-writeback-audit.ndjson'),guardPath:path.join(dir,'planning-import-guard.json')};
  fs.writeFileSync(paths.manifestPath,JSON.stringify(source()));await initializePlanningEpoch({...paths,confirm:true});
  const originalStore=fs.readFileSync(paths.storePath,'utf8'),originalAudit=fs.readFileSync(paths.auditPath,'utf8');
  fs.writeFileSync(paths.storePath,JSON.stringify({...JSON.parse(originalStore),baselineHash:'wrong'}));
  await assert.rejects(readPlanningEpoch(paths),error=>error.code==='planning_epoch_uninitialized');
  fs.writeFileSync(paths.storePath,originalStore);fs.writeFileSync(paths.auditPath,'');
  await assert.rejects(readPlanningEpoch(paths),error=>error.code==='planning_epoch_uninitialized');
  fs.writeFileSync(paths.auditPath,originalAudit);fs.rmSync(paths.storePath);
  await assert.rejects(readPlanningEpoch(paths),error=>error.code==='planning_epoch_uninitialized');
});

test('ordinary live-module member sees disabled capabilities and cannot persist drafts or import',async t=>{
  const dir=folder(t);const paths={manifestPath:path.join(dir,'planning-baseline-manifest.json'),epochPath:path.join(dir,'planning-epoch.json'),storePath:path.join(dir,'planning-workbench.json'),auditPath:path.join(dir,'schedule-writeback-audit.ndjson'),guardPath:path.join(dir,'planning-import-guard.json')};
  fs.writeFileSync(paths.manifestPath,JSON.stringify(source()));await initializePlanningEpoch({...paths,confirm:true});
  const authority=http.createServer((request,response)=>{
    response.writeHead(200,{'content-type':'application/json'});
    response.end(JSON.stringify({user:{id:'ordinary-member',realName:'普通成员'},access:{allowed_modules:['live-room-management']},permissions:{super_admin:false,operation_admin:false,manage_permissions:false}}));
  });
  await new Promise(resolve=>authority.listen(0,'127.0.0.1',resolve));
  t.after(()=>authority.close());
  const base=await candidate(t,dir,false,{authorityBase:`http://127.0.0.1:${authority.address().port}`,draftWrites:true,totalImport:true});
  const planning=await fetch(base+'/api/planning');assert.equal(planning.status,200);
  const view=await planning.json();
  assert.equal(view.draftCapability.enabled,false);assert.equal(view.draftCapability.code,'planning_admin_required');
  assert.equal(view.totalImportCapability.enabled,false);assert.equal(view.totalImportCapability.code,'planning_admin_required');
  const before=fs.readFileSync(paths.storePath,'utf8');
  for(const route of ['/api/planning/draft','/api/planning/rest-setting','/api/planning/rest-profile','/api/planning/makeup/draft','/api/planning/import']){
    const response=await fetch(base+route,{method:'POST',headers:{origin:'https://hub.fandow.com','x-requested-with':'XMLHttpRequest','content-type':'application/json'},body:'{}'});
    assert.equal(response.status,403,route);
    assert.equal((await response.json()).code,'PLANNING_ADMIN_REQUIRED',route);
  }
  assert.equal(fs.readFileSync(paths.storePath,'utf8'),before,'ordinary member must not mutate the epoch store');
});

test('read-only UI labels old drafts as pending and disables save/import paths',()=>{
  const script=fs.readFileSync(path.join(__dirname,'planning-workbench.js'),'utf8');
  for(const fragment of ['planningBaselineStatus','旧历史草稿待恢复','/api/recovery/status','history_recovery_pending','disableRecoveryActions','新基线后已保存'])assert.ok(script.includes(fragment),fragment);
  for(const fragment of ['#savePlanningDraft','#previewPlanningImport','#saveRestEntitlement','#saveMakeupDraft','#commitMakeupImport'])assert.ok(script.includes(fragment),fragment);
  const scheduleScript=fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
  for(const fragment of ['writebackCapabilities[key] = payload.writebackCapability','if (!capability.enabled)','capability.message ||'])assert.ok(scheduleScript.includes(fragment),fragment);
});
