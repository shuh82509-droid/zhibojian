// Whole-source reverse delta, not an edited-section or whitespace-only claim.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
const digest=b=>createHash('sha256').update(b).digest('hex');
function bytes(name) {
  const path=new URL(name,import.meta.url),stat=lstatSync(path);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink());return readFileSync(path);
}
const formal=bytes('./calendar-auth-http.original.mjs');
assert.equal(digest(formal),'0dfdeee60cce1e553127d889d67e35e5cba14da124771a5e078b0b6bea95c9d4');
const candidate=bytes('./calendar-auth-http.mjs');
assert.equal(digest(candidate),'d8705f422394926bc001351d2f622502cb3df087ac44267c8b974d9b3dbe3d4c');
let source=new TextDecoder('utf-8',{fatal:true}).decode(candidate);
assert.equal(source.includes('\r'),false);assert.equal(source.includes('\0'),false);
const start=source.indexOf('  const holdMessage = '),end=source.indexOf('  return async function calendarAuth');
assert.ok(start>0&&end>start);assert.equal(source.indexOf('  const holdMessage = ',start+1),-1);
assert.equal(source.indexOf('  return async function calendarAuth',end+1),-1);
source=source.slice(0,start)+source.slice(end);
function undo(current,previous) {
  const first=source.indexOf(current);assert.notEqual(first,-1,'required reverse delta present');
  assert.equal(source.indexOf(current,first+current.length),-1,'reverse delta unique');
  source=source.slice(0,first)+previous+source.slice(first+current.length);
}
undo("        if (url.searchParams.has('error')) return callbackFailure(res,null,{cancelled:true});",
  "        if (url.searchParams.has('error')) return json(res,400,{ok:false,error:'已取消授权，原凭据保持不变。'});");
undo('        if (result?.authorized!==true) return callbackFailure(res,null);\n','');
undo("        return json(res,200,{ok:true,authorized:true,message:'指定面试日历只读授权已保存，可返回直播中枢刷新日历。'});",
  "        return json(res,200,{ok:true,authorized:result.authorized,message:'指定面试日历只读授权已保存，可返回直播中枢刷新日历。'});");
undo('      } catch (failure) { return callbackFailure(res,failure); }',
  "      } catch (error) { return json(res,400,{ok:false,error:error.message,code:error.code||'calendar_auth_failed',...(error.diagnostic ? {diagnostic:error.diagnostic} : {})}); }");
undo("    if (req.method === 'GET' && routePath.endsWith('/status')) {\n      try { return json(res,200,{ok:true,calendar:(await checkedStatus()).calendar}); }\n      catch { return json(res,503,unavailableBody()); }\n    }",
  "    if (req.method === 'GET' && routePath.endsWith('/status')) return json(res,200,{ok:true,calendar:await reader.status()});");
undo("      let status;\n      try { status=await checkedStatus(); } catch { return json(res,503,unavailableBody()); }\n      if (status.held) return json(res,409,heldBody());\n      if (status.configured===false) return json(res,409,publicFailure({code:'calendar_auth_not_configured'}));\n",'');
undo('      catch(failure){return json(res,409,publicFailure(failure));}',
  "      catch(error){return json(res,409,{ok:false,error:error.message,code:error.code||'calendar_auth_failed'});}");
assert.deepEqual(Buffer.from(source,'utf8'),formal,'every original source byte after reversing only declared delta');
assert.equal(digest(bytes('./calendar-auth-http.test.mjs')),'c89b91262cf03a950bd7d7fffa3be91e88dd8d98d2d1b838e1bdb9dec264ddc7','four existing test bytes unchanged');
assert.equal(digest(bytes('./calendar-user-reader.mjs')),'9cbc9be0152abace6365d3f0dadef864dc9402e4b055e26a9d19424c09597912','frozen code-hold reader unchanged');
process.stdout.write(JSON.stringify({proof:'calendar_http_whole_source_reverse_delta',formalSha256:digest(formal),
  candidateSha256:digest(candidate),originalTestsUnchanged:true,frozenReaderUnchanged:true,productionApproved:false})+'\n');
