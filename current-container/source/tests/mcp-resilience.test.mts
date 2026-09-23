import test from 'node:test';
import assert from 'node:assert/strict';
import {callMcpTool,sourceFailureMessage} from '../app/api/_lib/mcp.ts';
test('authentication failures and identity-service timeouts have distinct user messages',()=>{
 assert.match(sourceFailureMessage('公司身份服务请求超时，本次工具调用已拒绝。'),/超时/);
 assert.doesNotMatch(sourceFailureMessage('公司身份服务请求超时，本次工具调用已拒绝。'),/授权已失效/);
 assert.match(sourceFailureMessage('公司登录状态无效。'),/授权已失效/);
});
test('coalesces duplicate reads, limits concurrency, retries transient failures only',async()=>{
 const original=globalThis.fetch,originalToken=process.env.FANDOW_DATA_MCP_TOKEN;
 process.env.FANDOW_DATA_MCP_TOKEN='synthetic-test-token';
 let active=0,peak=0,calls=0;const attempts=new Map<string,number>();
 globalThis.fetch=async(_input,init)=>{
   const body=JSON.parse(String(init?.body));
   if(body.method!=='tools/call')return new Response('{}',{status:200});
   calls++;active++;peak=Math.max(peak,active);
   const id=body.params.arguments.id;const attempt=(attempts.get(id)||0)+1;attempts.set(id,attempt);
   await new Promise(r=>setTimeout(r,8));active--;
   const failure=id==='retry'&&attempt===1?'公司身份服务请求超时':id==='denied'?'公司登录状态无效。':null;
   return Response.json({result:{content:[{type:'text',text:JSON.stringify(failure?{ok:false,error:{message:failure}}:{ok:true,data:{rows:[{id}]}})}]}});
 };
 try{
   await Promise.all(['a','a','b','c','retry'].map(id=>callMcpTool('execute_sql',{id})));
   assert.equal(peak,2);assert.equal(attempts.get('a'),1);assert.equal(attempts.get('retry'),2);
   const before=calls;await callMcpTool('execute_sql',{id:'a'});assert.equal(calls,before);
   await assert.rejects(callMcpTool('execute_sql',{id:'denied'}),/登录状态无效/);assert.equal(attempts.get('denied'),1);
 }finally{globalThis.fetch=original;if(originalToken===undefined)delete process.env.FANDOW_DATA_MCP_TOKEN;else process.env.FANDOW_DATA_MCP_TOKEN=originalToken}
});
