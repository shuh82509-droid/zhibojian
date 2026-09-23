import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
// Reuse the same company authentication helper as the installed read-only data connector.
// The credential travels only over SSH stdin and is never logged or written locally.
const headers=JSON.parse(execFileSync(process.execPath,[path.join(os.homedir(),'.codex/helpers/fandow-mcp-headers.mjs')],{encoding:'utf8'}));
const token=String(headers.Authorization||'').replace(/^Bearer /,'');
if(!token)throw Error('公司登录凭据不可用');
const remote=String.raw`
import sys,json,subprocess,pathlib,os,datetime
payload=json.load(sys.stdin)
probe=r"""const token=JSON.parse(await new Promise(r=>{let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>r(s))})).token;const url='https://cloud.fandow.com/gpt/ai-platform/mcp/data/';async function send(body,sid){const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,Accept:'application/json, text/event-stream','Content-Type':'application/json',...(sid?{'Mcp-Session-Id':sid}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=JSON.parse(t.split('\n').filter(x=>x.startsWith('data:')).at(-1)?.slice(5)||'{}')}return {j,sid:r.headers.get('Mcp-Session-Id')||sid}}const a=await send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'livehub-auth-check',version:'1'}}});await send({jsonrpc:'2.0',method:'notifications/initialized'},a.sid);const b=await send({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'list_query_databases',arguments:{}}},a.sid);const t=b.j.result?.content?.find(x=>x.type==='text')?.text;const d=t?JSON.parse(t):b.j;if(d.ok!==true)throw Error(d.error?.message||'公司登录验证失败');console.log('AUTH_VERIFIED')"""
r=subprocess.run(['docker','exec','-i','fd-027340-data-center','node','--input-type=module','-e',probe],input=json.dumps(payload),text=True,capture_output=True,timeout=70)
if r.returncode or r.stdout.strip()!='AUTH_VERIFIED':
 print('AUTH_VERIFY_FAILED: configuration unchanged');sys.exit(1)
target=pathlib.Path('/home/fandow-deploy/fandow-apps/runtime/fd-027340/data-center/.env')
original=target.read_text()
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
backup=target.with_name('.env.auth-backup-'+stamp)
backup.write_text(original);os.chmod(backup,0o600)
updated='\n'.join(line for line in original.splitlines() if not line.startswith('FANDOW_DATA_MCP_TOKEN='))+'\nFANDOW_DATA_MCP_TOKEN='+payload['token']+'\n'
temporary=target.with_name('.env.auth-refresh-'+stamp)
temporary.write_text(updated);os.chmod(temporary,0o600);os.replace(temporary,target)
print('AUTH_VERIFIED; DATA_RUNTIME_CONFIG_UPDATED; RUNNING_CONTAINER_UNCHANGED; backup='+str(backup))
`;
const result=spawnSync('ssh',['-o','ConnectTimeout=20','-o','StrictHostKeyChecking=accept-new','-i',path.join(os.homedir(),'.ssh/codex-fandow-deploy-ed25519'),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','fandow-deploy@120.27.143.111',"python3 -c '"+remote.replaceAll("'","'\\''")+"'"],{input:JSON.stringify({token}),encoding:'utf8',timeout:90000});
process.stdout.write(result.stdout||'');if(result.status!==0)throw Error('凭据验证或受控更新失败；没有输出任何凭据。');

