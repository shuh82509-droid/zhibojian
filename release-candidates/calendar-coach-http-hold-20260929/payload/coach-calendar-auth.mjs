// Coach HTTP consumer only. The calendar reader owns the durable hold and lock;
// these read-only preflights are not an atomic recovery or unlock operation.
const cookieName = 'live_coach_calendar_oauth_state';
const callbackPath = '/api/lifecycle/calendar-auth/callback';
const statusPath = '/api/lifecycle/coach-calendar-auth/status';
const startPath = '/api/lifecycle/coach-calendar-auth/start';
const holdMessage = '本人日历授权交换或续期结果待核验，已停止访问与自动重试。请勿刷新回调页或重复授权；需由管理员独立核验后恢复。';
const unavailableMessage = '本人日历授权状态暂时无法安全核验，未发起新的授权。请勿刷新回调页或重复授权；需先核验处理结果。';
const escapeHtml = value => String(value).replace(/[&<>"']/gu, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const publicMessages = Object.freeze({
  calendar_auth_not_configured:'本人日历用户授权尚未配置。',
  calendar_redirect_invalid:'正式日历授权回调必须使用固定 HTTPS 地址。',
  calendar_oauth_state_invalid:'本人日历授权校验失败或已过期；请勿刷新旧回调页，请返回中枢核验授权状态。',
  calendar_pkce_local_invalid:'本人日历授权安全参数校验失败，未提交凭据请求。',
  calendar_oauth_wrong_user:'授权账号不是指定的本人账号，凭据未保存。',
  calendar_identity_unverified:'无法核验本人日历授权用户身份。',
  calendar_primary_unverified:'无法核验本人主日历，未读取或保存日历资料。',
  calendar_detail_permission_missing:'本人日历的详情读取权限尚未核验。',
  calendar_scope_missing:'飞书日历授权未包含所需的只读与离线权限。',
  calendar_token_expiry_invalid:'本人日历授权有效期无法核验，凭据未保存。',
  calendar_path_denied:'此日历未列入已核验的只读来源。',
  calendar_store_invalid:'本人日历授权存储格式不可识别，已停止处理。',
  calendar_store_unreadable:'本人日历授权无法读取，已停止处理。',
  calendar_oauth_exchange_failed:'本人日历授权交换未完成。请勿刷新回调页或重复授权；需先核验处理结果。',
  calendar_authorization_busy:holdMessage,
  calendar_refresh_recovery_required:holdMessage
});
const heldBody = () => ({ok:false,error:holdMessage,code:'calendar_refresh_recovery_required',recoveryRequired:true,retryAllowed:false});
const unavailableBody = () => ({ok:false,error:unavailableMessage,code:'calendar_auth_status_unavailable',retryAllowed:false});
function publicFailure(failure) {
  let code;
  try { code=failure?.code; } catch { /* Do not read arbitrary diagnostics. */ }
  if(typeof code!=='string'||!Object.hasOwn(publicMessages,code))
    return {ok:false,error:'本人日历授权处理未完成。请勿刷新回调页或重复授权；需先核验处理结果。',code:'coach_calendar_auth_failed',retryAllowed:false};
  return {ok:false,error:publicMessages[code],code,retryAllowed:false};
}
async function checkedStatus(reader) {
  let timer;
  try {
    const raw=await Promise.race([
      Promise.resolve().then(()=>reader.status()),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('status unavailable')),1500);})
    ]);
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('status unavailable');
    // Read each allowed field once, never copy identity, expiry or raw reason.
    const authorized=raw.authorized,configured=raw.configured,status=raw.status,recoveryRequired=raw.recoveryRequired,retryAllowed=raw.retryAllowed;
    if(typeof authorized!=='boolean'||(configured!==undefined&&typeof configured!=='boolean')
      ||(status!==undefined&&status!=='recovery_required')
      ||(recoveryRequired!==undefined&&typeof recoveryRequired!=='boolean')
      ||(retryAllowed!==undefined&&typeof retryAllowed!=='boolean')
      ||(configured===false&&authorized))throw new Error('status unavailable');
    const held=status==='recovery_required'||recoveryRequired===true||retryAllowed===false;
    const calendar={...(configured===undefined?{}:{configured}),authorized:held?false:authorized,
      ...(held?{status:'recovery_required',recoveryRequired:true,retryAllowed:false,reason:holdMessage}
        :authorized?{}:{reason:configured===false?'本人日历用户授权配置不完整':'本人日历尚未授权、已过期或待核验。'})};
    return {calendar,held,configured};
  } finally { clearTimeout(timer); }
}
async function checkedIdentity(verifyActor,person) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(()=>verifyActor(person.room,person.openId,person.name,person.number)),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('identity unavailable')),1500);})
    ]);
  } finally { clearTimeout(timer); }
}

export function createCoachCalendarAuth({readers,coachNames,employeeNos,openIds,basePath,enabled,readOnly,json,verifyActor,clock=Date.now}) {
  // Pin existing configured people and readers. Later caller-map mutation must
  // not change which OA identity can begin or consume a pending authorization.
  const identities=Object.freeze(Object.keys(employeeNos).map(room=>Object.freeze({room,
    number:employeeNos[room],name:coachNames[room],openId:openIds[room],reader:readers[room]})));
  const byRoom=new Map(identities.map(person=>[person.room,person]));
  const pending = new Map();
  const cookie = (state, age) => `${cookieName}=${state}; Max-Age=${age}; Path=${basePath}${callbackPath}; HttpOnly; Secure; SameSite=Lax`;
  const roomFor = auth => {
    try {
      const ok=auth?.ok,mode=auth?.mode,degraded=auth?.degraded,user=auth?.user;
      if(ok!==true||mode!=='central'||degraded||!user||typeof user!=='object')return undefined;
      const number=user.number,realName=user.realName,name=user.name,openId=user.open_id;
      if(realName===undefined&&name===undefined)return undefined;
      return identities.find(person=>number===person.number
        && (realName===undefined||realName===person.name) && (name===undefined||name===person.name)
        && (openId===undefined||openId===''||openId===person.openId))?.room;
    } catch { return undefined; }
  };
  function page(res, status, title, detail) {
    const back = `${basePath}/#coach-calendar`;
    res.writeHead(status, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"});
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:16px/1.7 system-ui,sans-serif;background:#f5f8f5;color:#183c30;min-height:100vh;display:grid;place-items:center}.card{max-width:520px;background:white;border:1px solid #dbe9e1;border-radius:16px;padding:30px}a{color:#116549}</style><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><a href="${escapeHtml(back)}">返回直播中心</a></main></html>`);
  }
  function sameOrigin(req) {
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest' || req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (!req.headers.origin) return true;
    try { const origin = new URL(req.headers.origin); return origin.protocol === 'https:' && origin.host === req.headers.host; }
    catch { return false; }
  }
  async function callbackFailure(res,person,failure,{cancelled=false}={}) {
    let status;
    try { status=await checkedStatus(person.reader); }
    catch { page(res,503,'日历授权状态待核验',unavailableMessage);return; }
    if(status.held){page(res,409,'日历授权结果待核验',holdMessage);return;}
    if(cancelled){page(res,400,'日历授权已取消','未保存新授权，原有日历资料保持不变。请返回直播中心核验授权状态。');return;}
    page(res,400,'日历授权未完成',publicFailure(failure).error);
  }
  async function handleApi(req,res,routePath,auth) {
    if (routePath !== statusPath && routePath !== startPath) return false;
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    const room=roomFor(auth),person=byRoom.get(room);
    if (!person) { json(res,403,{ok:false,error:'仅已核验的四位直播间教练本人可管理本人日历授权。'});return true; }
    try { await checkedIdentity(verifyActor,person); }
    catch { json(res,403,{ok:false,error:'当前 OA 与飞书在职身份无法双重核验，未发起授权。'});return true; }
    if (routePath === statusPath && req.method === 'GET') {
      try { const {calendar}=await checkedStatus(person.reader);json(res,200,{ok:true,enabled:enabled&&!readOnly,room,coachName:person.name,calendar}); }
      catch { json(res,503,unavailableBody()); }
      return true;
    }
    if (routePath !== startPath || req.method !== 'POST') { json(res,405,{ok:false,error:'授权接口请求方式不支持。'});return true; }
    if (!enabled || readOnly) { json(res,423,{ok:false,error:'本人日历授权尚未开放或当前为只读候选。'});return true; }
    if (!sameOrigin(req)) { json(res,403,{ok:false,error:'请从直播中心本人页面发起授权。'});return true; }
    let status;
    try { status=await checkedStatus(person.reader); }
    catch { json(res,503,unavailableBody());return true; }
    if(status.held){json(res,409,heldBody());return true;}
    if(status.configured!==true){json(res,409,publicFailure({code:'calendar_auth_not_configured'}));return true;}
    try {
      const attempt=person.reader.begin();
      for (const [state,item] of pending) if (clock()-item.at > 600_000) pending.delete(state);
      pending.set(attempt.state,{room,at:clock()});
      res.setHeader('Set-Cookie',cookie(attempt.state,600));
      json(res,200,{ok:true,authorizeUrl:attempt.url});
    } catch(error) { json(res,409,publicFailure(error)); }
    return true;
  }
  async function handleCallback(req,res,url) {
    const state=url.searchParams.get('state') || '';
    const item=pending.get(state);
    if (!item) return false; // Keep the interview/private routing untouched.
    pending.delete(state);
    res.setHeader('Set-Cookie',cookie('',0));
    if (req.method !== 'GET') { page(res,405,'日历授权未完成','授权回调只接受 GET。');return true; }
    const person=byRoom.get(item.room);
    if (!enabled || readOnly) { page(res,423,'日历授权未完成','授权入口已关闭或当前仅供查看，未保存新授权。请返回中枢核验状态。');return true; }
    if(clock()-item.at>600_000){await callbackFailure(res,person,{code:'calendar_oauth_state_invalid'});return true;}
    if (url.searchParams.has('error')) { await callbackFailure(res,person,null,{cancelled:true});return true; }
    let status;
    try { status=await checkedStatus(person.reader); }
    catch { page(res,503,'日历授权状态待核验',unavailableMessage);return true; }
    if(status.held){page(res,409,'日历授权结果待核验',holdMessage);return true;}
    const cookieState=String(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
    try {
      const result=await person.reader.complete({code:url.searchParams.get('code'),state,cookieState});
      if(result?.authorized!==true){await callbackFailure(res,person,null);return true;}
      page(res,200,'本人日历授权完成',`${person.name}的日历只读授权已保存，返回直播中心后可核验复盘统计。`);
    } catch(error) { await callbackFailure(res,person,error); }
    return true;
  }
  return {handleApi,handleCallback,roomFor};
}
