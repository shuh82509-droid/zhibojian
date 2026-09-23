import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Feishu cold reads coalesce identity requests and retry only transient reads', async () => {
  const originalFetch=globalThis.fetch, appId=process.env.FEISHU_APP_ID, secret=process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_ID='test-app';process.env.FEISHU_APP_SECRET='test-secret';
  let authCalls=0,reads=0;
  globalThis.fetch=async (url) => {
    if(String(url).includes('/auth/')){authCalls++;return Response.json({code:0,tenant_access_token:'test-only',expire:7200});}
    reads++;return reads===1?new Response('temporarily unavailable',{status:503}):Response.json({code:0,data:{verified:true}});
  };
  try {
    const {feishuReadJson}=await import('../app/api/_lib/coco.ts?test=retry');
    const result=await Promise.all([feishuReadJson('/sheets/test'),feishuReadJson('/sheets/test')]);
    assert.equal(authCalls,1);assert.equal(reads,2);assert.deepEqual(result[0],result[1]);
    assert.deepEqual(result[0].data,{verified:true});
  } finally {globalThis.fetch=originalFetch;if(appId===undefined)delete process.env.FEISHU_APP_ID;else process.env.FEISHU_APP_ID=appId;if(secret===undefined)delete process.env.FEISHU_APP_SECRET;else process.env.FEISHU_APP_SECRET=secret;}
});

test('Feishu permission errors are not retried or cached and cannot discard other dashboard sources', async () => {
  const originalFetch=globalThis.fetch, appId=process.env.FEISHU_APP_ID, secret=process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_ID='test-app';process.env.FEISHU_APP_SECRET='test-secret';let reads=0;
  globalThis.fetch=async (url) => {
    if(String(url).includes('/auth/'))return Response.json({code:0,tenant_access_token:'test-only',expire:7200});
    reads++;return Response.json({code:403,msg:'permission denied'},{status:403});
  };
  try {
    const {feishuReadJson}=await import('../app/api/_lib/coco.ts?test=permission');
    await assert.rejects(feishuReadJson('/sheets/denied'),/permission denied/);
    await assert.rejects(feishuReadJson('/sheets/denied'),/permission denied/);assert.equal(reads,2);
    const route=await readFile(new URL('../app/api/dashboard/route.ts',import.meta.url),'utf8');
    assert.match(route,/loadFeishuDashboardFallback\(context.date\)\.catch/);assert.match(route,/mcpErrors.feishu/);
  } finally {globalThis.fetch=originalFetch;if(appId===undefined)delete process.env.FEISHU_APP_ID;else process.env.FEISHU_APP_ID=appId;if(secret===undefined)delete process.env.FEISHU_APP_SECRET;else process.env.FEISHU_APP_SECRET=secret;}
});
