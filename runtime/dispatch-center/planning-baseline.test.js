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
       ...(options.mockFeishu?{NODE_OPTIONS:`--require=${path.join(__dirname,'planning-live-source-test-fixture.js')}`,TEST_FEISHU_REVISION:String(options.mockRevision ?? (options.fullRestSource ? 505 : 499)),TEST_MONTHLY_REST_FULL:options.fullRestSource?'1':'0'}:{}),
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

test('recovery serves source metadata without calling missing old drafts empty; audit stays 503 and writes 423',async t=>{
  const dir=folder(t);fs.writeFileSync(path.join(dir,'planning-baseline-manifest.json'),JSON.stringify(source()));
  const base=await candidate(t,dir,true);
  const health=await (await fetch(base+'/api/health')).json();
  assert.equal(health.ok,true);assert.equal(health.planningBaseline.historyStatus,'pending_recovery');
  assert.equal(JSON.stringify(health).includes(token),false,'unauthenticated health must not expose workbook token');
  const status=await (await fetch(base+'/api/recovery/status')).json();
  assert.deepEqual(status.planningBaseline,source());
  const planning=await fetch(base+'/api/planning');assert.equal(planning.status,200);
  const planningData=await planning.json();
  assert.equal(planningData.historyStatus,'pending_recovery');assert.equal(planningData.historyAvailable,false);
  assert.equal(planningData.drafts,null);assert.equal(planningData.makeupDrafts,null);
  assert.equal(planningData.totalSchedule.permissionStatus,'待回传');
  assert.equal(planningData.draftCapability.enabled,false);assert.equal(planningData.totalImportCapability.enabled,false);
  const audit=await fetch(base+'/api/schedule/writeback/audit');assert.equal(audit.status,503);
  assert.equal((await audit.json()).code,'history_recovery_pending');
  for(const route of ['/api/planning/draft','/api/planning/rest-setting','/api/planning/rest-profile','/api/planning/import/preview','/api/planning/import']){
    const write=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(write.status,423,route);assert.equal((await write.json()).code,'recovery_read_only',route);
  }
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
  const recoveryPlanning=await fetch(readOnlyBase+'/api/planning');
  assert.equal(recoveryPlanning.status,200);
  const recoveryView=await recoveryPlanning.json();
  assert.equal(recoveryView.historyAvailable,false);assert.equal(recoveryView.drafts,null);
  const oldAudit=await fetch(readOnlyBase+'/api/schedule/writeback/audit');
  assert.equal(oldAudit.status,503);assert.equal((await oldAudit.json()).code,'history_recovery_pending');
});

test('read-only new baseline reads current total schedule revision, rest days and all four room schedules',async t=>{
  const dir=folder(t);fs.writeFileSync(path.join(dir,'planning-baseline-manifest.json'),JSON.stringify(source()));
  const base=await candidate(t,dir,true,{mockFeishu:true});
  const planning=await (await fetch(base+'/api/planning')).json();
  assert.equal(planning.historyAvailable,false);assert.equal(planning.drafts,null);
  assert.equal(planning.planningBaseline.revision,498,'manifest is a historical anchor');
  assert.equal(planning.totalSchedule.revision,499,'current source is read separately');
  assert.equal(planning.totalSchedule.permissionStatus,'已读取');
  assert.equal(planning.totalSchedule.sourceMode,'official_live');
  const restResponse=await fetch(base+'/api/planning/rest?month=2026-09');
  assert.equal(restResponse.status,200);
  const rest=(await restResponse.json()).data;
  assert.equal(rest.available,true);assert.equal(rest.historyStatus,'pending_recovery');
  assert.equal(rest.source.mode,'official_live');assert.equal(rest.source.revision,499);
  assert.equal(rest.entitlement,null);
  for(const name of ['潘小慧','丁阳虹','王思佳','李安妮']){
    const person=rest.people.find(item=>item.name===name);
    assert.ok(person,`missing ${name}`);assert.equal(person.sourceStatus,'matched');
    assert.equal(person.usedRest,1);assert.equal(person.remainingRest,null);
    assert.ok(person.calendar.some(day=>day.date==='2026-09-25'));
  }
  const schedule=await (await fetch(base+'/api/schedule?date=2026-09-25')).json();
  assert.equal(schedule.rooms.length,4);
  assert.deepEqual(schedule.rooms.map(room=>room.code).sort(),['brand_selection','guanqi','wangou','youxuan']);
  const overviewResponse=await fetch(base+'/api/planning/source-diagnostic');
  assert.equal(overviewResponse.status,200);
  const overview=await overviewResponse.json();
  assert.equal(overview.data.readOnly,true);assert.equal(overview.data.writeBackAllowed,false);
  assert.equal(overview.data.dates.length,30);
  assert.equal(JSON.stringify(overview).includes('潘小慧'),false,'whole-month overview must not expose a staff name');
  const detailResponse=await fetch(base+'/api/planning/source-diagnostic?date=2026-09-25');
  assert.equal(detailResponse.status,200);
  const detail=await detailResponse.json();
  assert.equal(detail.data.dates.length,1);assert.equal(detail.data.writeBackAllowed,false);
  assert.equal(fs.existsSync(path.join(dir,'schedule-writeback-audit.ndjson')),false,'diagnostic GET must not write an audit');
  assert.equal(fs.existsSync(path.join(dir,'planning-workbench.json')),false,'read-only GET must not create empty history');
});

test('read-only source behind baseline revision is marked unverified, without zero-valued rest',async t=>{
  const dir=folder(t);fs.writeFileSync(path.join(dir,'planning-baseline-manifest.json'),JSON.stringify(source()));
  const base=await candidate(t,dir,true,{mockFeishu:true,mockRevision:497});
  const planning=await (await fetch(base+'/api/planning')).json();
  assert.equal(planning.totalSchedule.permissionStatus,'待回传');
  assert.equal(planning.totalSchedule.revision,undefined);
  const rest=(await (await fetch(base+'/api/planning/rest?month=2026-09')).json()).data;
  assert.equal(rest.available,false);assert.equal(rest.historyStatus,'pending_recovery');
  assert.deepEqual(rest.people,[]);assert.equal(rest.entitlement,null);
  assert.match(rest.reason,/未通过新基线核验/);
});

test('administrator reads 52-person monthly rest counts without creating a draft or import',async t=>{
  const dir=folder(t);fs.writeFileSync(path.join(dir,'planning-baseline-manifest.json'),JSON.stringify(source()));
  const base=await candidate(t,dir,true,{mockFeishu:true,fullRestSource:true});
  const capability=await (await fetch(base+'/api/planning')).json();
  assert.equal(capability.restStatisticsCapability.enabled,true);
  const response=await fetch(base+'/api/planning/rest-statistics?month=2026-09');
  assert.equal(response.status,200);
  const {data}=await response.json();
  assert.equal(data.available,true);assert.equal(data.readOnly,true);assert.equal(data.writeBackAllowed,false);
  assert.equal(data.personCount,52);assert.equal(data.dateCount,30);assert.equal(data.people.length,52);
  assert.deepEqual([data.people[0].explicitRestDays,data.people[0].explicitWorkDays,data.people[0].pendingDays],[1,1,28]);
  assert.deepEqual([data.people[42].explicitRestDays,data.people[42].explicitWorkDays,data.people[42].pendingDays],[0,0,30], 'gray rest text remains pending');
  assert.deepEqual([data.people[43].explicitRestDays,data.people[43].explicitWorkDays,data.people[43].pendingDays],[0,0,30], 'gray work text remains pending');
  assert.equal(data.source.revision,505);assert.equal(data.source.styleRevision,505);assert.equal(data.source.mode,'official_live');
  assert.equal(fs.existsSync(path.join(dir,'planning-workbench.json')),false);
  assert.equal(fs.existsSync(path.join(dir,'schedule-writeback-audit.ndjson')),false);
  const wrongMonth=await fetch(base+'/api/planning/rest-statistics?month=2026-10');
  assert.equal(wrongMonth.status,422);assert.equal((await wrongMonth.json()).code,'REST_STATISTICS_MONTH_UNVERIFIED');
});

test('rest statistics reject a newer source until gray-cell styles are audited again',async t=>{
  const dir=folder(t);fs.writeFileSync(path.join(dir,'planning-baseline-manifest.json'),JSON.stringify(source()));
  const base=await candidate(t,dir,true,{mockFeishu:true,fullRestSource:true,mockRevision:506});
  const response=await fetch(base+'/api/planning/rest-statistics?month=2026-09');
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'REST_STATISTICS_STYLE_UNVERIFIED');
  assert.equal(fs.existsSync(path.join(dir,'planning-workbench.json')),false);
  assert.equal(fs.existsSync(path.join(dir,'schedule-writeback-audit.ndjson')),false);
});

test('read-only source views still require central authentication in an embedded hub',async t=>{
  const authority=http.createServer((request,response)=>{
    response.writeHead(401,{'content-type':'application/json'});
    response.end(JSON.stringify({detail:'fixture: OA login required'}));
  });
  await new Promise(resolve=>authority.listen(0,'127.0.0.1',resolve));
  t.after(()=>authority.close());
  const dir=folder(t);fs.writeFileSync(path.join(dir,'planning-baseline-manifest.json'),JSON.stringify(source()));
  const base=await candidate(t,dir,true,{mockFeishu:true,authorityBase:`http://127.0.0.1:${authority.address().port}`});
  for(const route of ['/api/planning','/api/planning/rest?month=2026-09','/api/planning/rest-statistics?month=2026-09','/api/schedule?date=2026-09-25']){
    const response=await fetch(base+route);
    assert.equal(response.status,401,route);
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
  assert.equal(view.restStatisticsCapability.enabled,false);
  const diagnostic=await fetch(base+'/api/planning/source-diagnostic');
  assert.equal(diagnostic.status,403,'source cells with staff names require a planning manager');
  const deniedDiagnostic=await diagnostic.json();
  assert.equal(deniedDiagnostic.code,'PLANNING_ADMIN_REQUIRED');
  assert.equal(deniedDiagnostic.error,'仅排班管理员可查看原表来源诊断。');
  const deniedRest=await fetch(base+'/api/planning/rest-statistics?month=2026-09');
  assert.equal(deniedRest.status,403);
  assert.equal((await deniedRest.json()).code,'PLANNING_ADMIN_REQUIRED');
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
