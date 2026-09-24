'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wis-planning-import-guard-'));
const guardPath = path.join(directory, 'planning-import-guard.json');
const auditPath = path.join(directory, 'planning-audit.ndjson');
const spreadsheetToken = 'Wj4zs3oDfhGUfetlTXicxblmnHe';
const sheetId = '0jFdXf';
const manifestPath = path.join(directory, 'planning-baseline-manifest.json');
const epochPath = path.join(directory, 'planning-epoch.json');
const storePath = path.join(directory, 'planning-workbench.json');
process.env.DATA_DIR = directory;
process.env.PLANNING_IMPORT_GUARD_PATH = guardPath;
process.env.SCHEDULE_AUDIT_LOG_PATH = auditPath;
process.env.PLANNING_DRAFT_WRITES_ENABLED = '1';
process.env.PLANNING_TOTAL_IMPORT_ENABLED = '1';
process.env.TOTAL_SCHEDULE_SPREADSHEET_TOKEN = spreadsheetToken;
process.env.TOTAL_SCHEDULE_SHEET_ID = sheetId;
process.env.RECOVERY_READ_ONLY = '0';
process.env.FEISHU_APP_ID = 'local-test-app';
process.env.FEISHU_APP_SECRET = 'local-test-only';
const {guardedSheetWrite, readPlanningImportGuard, writePlanningImportGuard, reconcilePlanningImport, totalImportCapability, initializePlanningEpoch, readPlanningEpoch, writePlanningStore} = require('./schedule-api-server');
const admin = {mode:'internal',user:{name:'测试员'}};
const member = {mode:'central',user:{name:'普通成员'},permissions:{super_admin:false,operation_admin:false,manage_permissions:false}};

test('planning import intent survives process-independent file read and malformed guard blocks retry', async (t) => {
  const originalFetch = global.fetch;
  const originalOpen = fsp.open;
  t.after(() => {
    global.fetch = originalFetch;
    fsp.open = originalOpen;
    fs.rmSync(directory,{recursive:true,force:true});
  });
  fs.writeFileSync(manifestPath,JSON.stringify({schemaVersion:1,spreadsheetToken,sheetId,revision:498,checkedAt:new Date().toISOString(),historyStatus:'pending_recovery'}));
  await initializePlanningEpoch({confirm:true,manifestPath,epochPath,storePath,auditPath,guardPath});
  assert.equal(await readPlanningImportGuard(), null);
  const {epoch}=await readPlanningEpoch({manifestPath,epochPath,storePath,auditPath});
  const intent = {schemaVersion:1,id:'test-intent',epochId:epoch.epochId,baselineHash:epoch.baselineHash,state:'intent',at:'2026-09-24T00:00:00.000Z',ranges:[{range:`${sheetId}!E3:E3`,before:[''],after:['L']} ]};
  await writePlanningImportGuard(intent);
  assert.deepEqual(JSON.parse(fs.readFileSync(guardPath,'utf8')),intent);
  assert.deepEqual(await readPlanningImportGuard(),intent);
  const pendingCapability=await totalImportCapability(admin);
  assert.equal(pendingCapability.enabled,false);
  assert.equal(pendingCapability.code,'write_result_pending');
  assert.match(pendingCapability.message,/test-intent/);
  fs.rmSync(guardPath);
  let postCount = 0;
  global.fetch = async (url) => {
    if (String(url).includes('/values_batch_update')) {postCount++; throw Object.assign(new Error('local timeout simulation'),{name:'TimeoutError'});}
    if (String(url).includes('/tenant_access_token/internal')) return {ok:true,status:200,json:async()=>({code:0,tenant_access_token:'local-token',expire:7200})};
    if (String(url).includes('/values/')) return {ok:true,status:200,json:async()=>({code:0,data:{valueRange:{range:'',values:[]}}})};
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  const write = () => guardedSheetWrite({kind:'planning-import',auth:admin,plan:{expectedHash:'test-hash',month:'2026-09',target:{spreadsheetToken,sheetId}},token:'local-token',spreadsheetToken,ranges:[{range:`${sheetId}!E3:E3`,before:[''],after:['L']}],auditAction:'planning-import'});
  await assert.rejects(guardedSheetWrite({kind:'planning-import',auth:member,plan:{target:{spreadsheetToken,sheetId}},token:'local-token',spreadsheetToken,ranges:[{range:`${sheetId}!E3:E3`,before:[''],after:['L']}],auditAction:'planning-import'}),error=>error.status===403&&error.code==='PLANNING_ADMIN_REQUIRED');
  await assert.rejects(write(),error=>error.code==='SCHEDULE_WRITE_UNCERTAIN');
  assert.equal(postCount,1);
  assert.equal((await readPlanningImportGuard()).state,'uncertain');
  assert.equal((await totalImportCapability(admin)).code,'write_result_pending');
  await assert.rejects(write(),error=>error.code==='SCHEDULE_WRITE_UNCERTAIN');
  assert.equal(postCount,1,'a retry must not send a second Feishu write');
  fs.rmSync(guardPath);
  let sentBody;
  global.fetch = async (url,options) => {
    if (String(url).includes('/values_batch_update')) { sentBody=JSON.parse(options.body);assert.equal(options.headers['Content-Type'],'application/json; charset=utf-8');return {ok:true,status:200,json:async()=>({code:0,data:{revision:9,spreadsheetToken,responses:[{spreadsheetToken,updatedRange:`${sheetId}!E3:E3`,updatedRows:1,updatedColumns:1,updatedCells:1}]}})}; }
    if (String(url).includes('/tenant_access_token/internal')) return {ok:true,status:200,json:async()=>({code:0,tenant_access_token:'local-token',expire:7200})};
    if (String(url).includes('/values/')) return {ok:true,status:200,json:async()=>({code:0,data:{valueRange:{range:`${sheetId}!E3:E3`,values:[['L']]}}})};
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  const success = await write();
  assert.equal(success.readbackVerified,true);
  assert.deepEqual(sentBody,{valueRanges:[{range:`${sheetId}!E3:E3`,values:[['L']]}]});
  assert.equal((await readPlanningImportGuard()).state,'verified');
  await assert.rejects(guardedSheetWrite({kind:'planning-import',auth:{mode:'internal'},plan:{target:{spreadsheetToken,sheetId}},token:'local-token',spreadsheetToken,ranges:[{range:`${sheetId}!E3:E3`,before:['L'],after:['L']}],auditAction:'planning-import'}),error=>error.code==='TOTAL_SCHEDULE_RANGE_INVALID');
  fs.rmSync(guardPath);
  let malformedPosts=0;
  global.fetch = async url => {
    if (String(url).includes('/values_batch_update')) {malformedPosts++;return {ok:true,status:200,json:async()=>({code:0,data:{revision:10,spreadsheetToken,responses:[{spreadsheetToken,updatedRange:`${sheetId}!F3:F3`,updatedRows:1,updatedColumns:1,updatedCells:1}]}})};}
    if (String(url).includes('/values/')) return {ok:true,status:200,json:async()=>({code:0,data:{valueRange:{range:`${sheetId}!E3:E3`,values:[['L']]}}})};
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  await assert.rejects(write(),error=>error.code==='SCHEDULE_WRITE_UNCERTAIN');
  assert.equal((await readPlanningImportGuard()).state,'uncertain');
  await assert.rejects(write(),error=>error.code==='SCHEDULE_WRITE_UNCERTAIN');
  assert.equal(malformedPosts,1,'an ambiguous Feishu response must not trigger another write');
  fs.rmSync(guardPath);
  let verifiedPosts=0;
  global.fetch = async url => {
    if (String(url).includes('/values_batch_update')) {verifiedPosts++;return {ok:true,status:200,json:async()=>({code:0,data:{revision:11,spreadsheetToken,responses:[{spreadsheetToken,updatedRange:`${sheetId}!E3:E3`,updatedRows:1,updatedColumns:1,updatedCells:1}]}})};}
    if (String(url).includes('/values/')) return {ok:true,status:200,json:async()=>({code:0,data:{valueRange:{range:`${sheetId}!E3:E3`,values:[['L']]}}})};
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  let auditWrites=0;
  fsp.open = async (file,flags,...args) => {
    if (file===auditPath && flags==='r+' && ++auditWrites===2) throw Object.assign(new Error('simulated audit disk failure'),{code:'ENOSPC'});
    return originalOpen(file,flags,...args);
  };
  await assert.rejects(write(),error=>error.code==='SCHEDULE_WRITE_UNCERTAIN');
  assert.equal(verifiedPosts,1);
  const auditFailureGuard=await readPlanningImportGuard();
  assert.equal(auditFailureGuard.state,'uncertain','readback success without durable success audit must remain blocking');
  await assert.rejects(write(),error=>error.code==='SCHEDULE_WRITE_UNCERTAIN');
  assert.equal(verifiedPosts,1,'audit failure cannot permit a second Feishu POST');
  fsp.open = async (file,flags,...args) => {
    if (file===auditPath && flags==='r+') throw Object.assign(new Error('simulated reconciliation audit failure'),{code:'ENOSPC'});
    return originalOpen(file,flags,...args);
  };
  await assert.rejects(reconcilePlanningImport({intentId:auditFailureGuard.id,confirm:true},admin),error=>error.code==='ENOSPC');
  assert.equal((await readPlanningImportGuard()).state,'uncertain','reconciliation cannot unlock a guard without durable audit');
  await assert.rejects(write(),error=>error.code==='SCHEDULE_WRITE_UNCERTAIN');
  assert.equal(verifiedPosts,1);
  fsp.open = originalOpen;
  fs.writeFileSync(guardPath,JSON.stringify({...intent,epochId:'another-epoch'}),'utf8');
  await assert.rejects(readPlanningImportGuard(),error=>error.code==='TOTAL_SCHEDULE_GUARD_UNREADABLE');
  fs.writeFileSync(guardPath,'{','utf8');
  await assert.rejects(readPlanningImportGuard(),error=>error.code==='TOTAL_SCHEDULE_GUARD_UNREADABLE');
  assert.equal((await totalImportCapability(admin)).code,'total_import_guard_unreadable');
  fs.rmSync(guardPath);
  const {store}=await readPlanningEpoch({manifestPath,epochPath,storePath,auditPath});
  const first={...store,drafts:{first:{verified:true}}};
  await assert.rejects(writePlanningStore(first,member),error=>error.status===403&&error.code==='PLANNING_ADMIN_REQUIRED');
  await writePlanningStore(first,admin);
  await assert.rejects(writePlanningStore({...store,drafts:{second:{stale:true}}},admin),error=>error.code==='PLANNING_STORE_CHANGED');
  const after=await readPlanningEpoch({manifestPath,epochPath,storePath,auditPath});
  assert.equal(after.store.storeRevision,1);
  assert.deepEqual(after.store.drafts,{first:{verified:true}});
});
