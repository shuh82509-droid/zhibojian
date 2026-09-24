// Four coach-owned calendar authorizations share the already registered OAuth
// callback, but never share a token file, state, cookie or Feishu identity.
const cookieName = 'live_coach_calendar_oauth_state';
const callbackPath = '/api/lifecycle/calendar-auth/callback';
const statusPath = '/api/lifecycle/coach-calendar-auth/status';
const startPath = '/api/lifecycle/coach-calendar-auth/start';

const escapeHtml = value => String(value).replace(/[&<>"']/gu, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export function createCoachCalendarAuth({readers,coachNames,employeeNos,openIds,basePath,enabled,readOnly,json,verifyActor,clock=Date.now}) {
  const pending = new Map();
  const cookie = (state, age) => `${cookieName}=${state}; Max-Age=${age}; Path=${basePath}${callbackPath}; HttpOnly; Secure; SameSite=Lax`;
  const roomFor = auth => Object.keys(employeeNos).find(room => auth?.ok && auth.mode === 'central' && !auth.degraded && auth.user?.number === employeeNos[room]
    && (!auth.user.open_id || auth.user.open_id === openIds[room]) && auth.user.name === coachNames[room]);
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
  async function handleApi(req,res,routePath,auth) {
    if (routePath !== statusPath && routePath !== startPath) return false;
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    const room=roomFor(auth);
    if (!room) { json(res,403,{ok:false,error:'仅已核验的四位直播间教练本人可管理本人日历授权。'});return true; }
    try { await verifyActor(room,openIds[room],coachNames[room],employeeNos[room]); }
    catch { json(res,403,{ok:false,error:'当前 OA 与飞书在职身份无法双重核验，未发起授权。'});return true; }
    if (routePath === statusPath && req.method === 'GET') {
      const calendar=await readers[room].status();
      json(res,200,{ok:true,enabled,room,coachName:coachNames[room],calendar});return true;
    }
    if (routePath !== startPath || req.method !== 'POST') { json(res,405,{ok:false,error:'授权接口请求方式不支持。'});return true; }
    if (!enabled || readOnly) { json(res,423,{ok:false,error:'本人日历授权尚未开放或当前为只读候选。'});return true; }
    if (!sameOrigin(req)) { json(res,403,{ok:false,error:'请从直播中心本人页面发起授权。'});return true; }
    try {
      const attempt=readers[room].begin();
      for (const [state,item] of pending) if (clock()-item.at > 600_000) pending.delete(state);
      pending.set(attempt.state,{room,at:clock()});
      res.setHeader('Set-Cookie',cookie(attempt.state,600));
      json(res,200,{ok:true,authorizeUrl:attempt.url});
    } catch(error) { json(res,409,{ok:false,error:error.message,code:error.code||'coach_calendar_auth_failed'}); }
    return true;
  }
  async function handleCallback(req,res,url) {
    const state=url.searchParams.get('state') || '';
    const item=pending.get(state);
    if (!item) return false; // Leave the pre-existing interview OAuth callback untouched.
    pending.delete(state);
    res.setHeader('Set-Cookie',cookie('',0));
    if (req.method !== 'GET') { page(res,405,'日历授权未完成','授权回调只接受 GET。');return true; }
    if (!enabled || readOnly || clock()-item.at>600_000) { page(res,409,'日历授权未完成','授权已过期或当前仅供查看，请由本人重新发起。');return true; }
    if (url.searchParams.has('error')) { page(res,400,'日历授权已取消','未保存新授权，原有日历资料保持不变。');return true; }
    const cookieState=String(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
    try {
      await readers[item.room].complete({code:url.searchParams.get('code'),state,cookieState});
      page(res,200,'本人日历授权完成',`${coachNames[item.room]}的日历只读授权已保存，返回直播中心后可核验复盘统计。`);
    } catch(error) { page(res,400,'日历授权未完成',error.message||'授权校验失败，请由本人重新发起。'); }
    return true;
  }
  return {handleApi,handleCallback,roomFor};
}
