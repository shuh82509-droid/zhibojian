// Four coach-owned calendar authorizations share the already registered OAuth
// callback, but never share a token file, state, cookie or Feishu identity.
import {randomBytes} from 'node:crypto';
const cookieName = 'live_coach_calendar_oauth_state';
const callbackPath = '/api/lifecycle/calendar-auth/callback';
const statusPath = '/api/lifecycle/coach-calendar-auth/status';
const startPath = '/api/lifecycle/coach-calendar-auth/start';
const invitePath = '/api/lifecycle/coach-calendar-auth/invite';
const consentPath = '/api/lifecycle/coach-calendar-auth/consent';
const publicStartPath = '/api/lifecycle/coach-calendar-auth/public-start';

const escapeHtml = value => String(value).replace(/[&<>"']/gu, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export function createCoachCalendarAuth({readers,coachNames,employeeNos,openIds,basePath,enabled,readOnly,json,verifyActor,
  invitations=null,publicEnabled=false,publicCallbackUrl='',authorizeIssuer=async()=>false,clock=Date.now}) {
  const pending = new Map();
  const cookie = (state, age) => `${cookieName}=${state}; Max-Age=${age}; Path=${basePath}${callbackPath}; HttpOnly; Secure; SameSite=Lax`;
  const callbackUrl = (()=>{ try {
    const url=new URL(publicCallbackUrl);
    return url.protocol==='https:' && url.hostname==='hub.fandow.com' && !url.port
      && !url.username && !url.password && !url.search && !url.hash
      && url.pathname===`${basePath}${callbackPath}` ? url : null;
  } catch { return null; } })();
  const publicOrigin=callbackUrl?.origin || '';
  const publicReady = () => Boolean(enabled && publicEnabled && !readOnly && invitations?.configured && callbackUrl);
  // The formal gateway strips basePath before proxying to this server and
  // overwrites X-Forwarded-Prefix with the external module path. Never infer
  // the public route from a client-supplied URL or an unverified Host alone.
  const formalGatewayRequest = (req,url,path) => Boolean(callbackUrl
    && url.pathname===path && req.headers.host===callbackUrl.host
    && req.headers['x-forwarded-prefix']===basePath);
  const coachNameMatches = (user, expected) => {
    if (!user || typeof user !== 'object') return false;
    const supplied = [user.realName, user.name].filter(value => value !== undefined && value !== null && value !== '');
    return supplied.length > 0 && supplied.every(value => typeof value === 'string' && value.trim() === expected);
  };
  const roomFor = auth => Object.keys(employeeNos).find(room => auth?.ok && auth.mode === 'central' && !auth.degraded && auth.user?.number === employeeNos[room]
    && (!auth.user.open_id || auth.user.open_id === openIds[room]) && coachNameMatches(auth.user, coachNames[room]));
  function page(res, status, title, detail, publicFlow=false) {
    const back = `${basePath}/#coach-calendar`;
    res.writeHead(status, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"});
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:16px/1.7 system-ui,sans-serif;background:#f5f8f5;color:#183c30;min-height:100vh;display:grid;place-items:center}.card{max-width:520px;background:white;border:1px solid #dbe9e1;border-radius:16px;padding:30px}a{color:#116549}</style><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>${publicFlow?'':'<a href="'+escapeHtml(back)+'">返回直播中心</a>'}</main></html>`);
  }
  function sameOrigin(req) {
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest' || req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (!req.headers.origin) return true;
    try { const origin = new URL(req.headers.origin); return origin.protocol === 'https:' && origin.host === req.headers.host; }
    catch { return false; }
  }
  function sameFormOrigin(req) {
    if (!callbackUrl || req.headers['sec-fetch-site']==='cross-site') return false;
    try { return new URL(req.headers.origin).origin===publicOrigin && req.headers.host===new URL(publicOrigin).host; }
    catch { return false; }
  }
  function beginAttempt(room,mode) {
    const attempt=readers[room].begin();
    for (const [state,item] of pending) if (clock()-item.at > 600_000) pending.delete(state);
    pending.set(attempt.state,{room,openId:openIds[room],mode,at:clock()});
    return attempt;
  }
  async function handleApi(req,res,routePath,auth,requestUrl) {
    if (![statusPath,startPath,invitePath].includes(routePath)) return false;
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    if (routePath===invitePath) {
      if(req.method!=='POST') { json(res,405,{ok:false,error:'邀请仅支持 POST。'});return true; }
      if(!publicReady()) { json(res,423,{ok:false,error:'免登录的本人授权邀请尚未开放。'});return true; }
      if(req.headers['x-requested-with']!=='XMLHttpRequest' || req.headers['x-forwarded-prefix']!==basePath
        || !sameFormOrigin(req) || !await authorizeIssuer(auth)) {
        json(res,403,{ok:false,error:'仅已核验的中枢管理员可签发教练本人授权邀请。'});return true;
      }
      const query=requestUrl?.searchParams || new URL(req.url||'/',publicOrigin).searchParams;
      const room=query.getAll('room').length===1 && [...query.keys()].every(key=>key==='room') ? query.get('room') : '';
      if(!Object.hasOwn(coachNames,room) || !readers[room] || !openIds[room]) { json(res,400,{ok:false,error:'指定直播间无效。'});return true; }
      try {
        await verifyActor(room,openIds[room],coachNames[room],employeeNos[room]);
        const calendar=await readers[room].status();
        if(!calendar.configured) throw Error('日历用户授权配置不完整。');
        const invitation=await invitations.issue(room,openIds[room]);
        // A URL fragment is not sent to the gateway or recorded in access logs.
        json(res,200,{ok:true,room,coachName:coachNames[room],inviteUrl:`${publicOrigin}${basePath}${consentPath}#invite=${encodeURIComponent(invitation.token)}`,expiresAt:invitation.expiresAt});
      } catch { json(res,409,{ok:false,error:'教练身份、日历配置或邀请账本无法核验，未签发。'}); }
      return true;
    }
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
      const attempt=beginAttempt(room,'central');
      res.setHeader('Set-Cookie',cookie(attempt.state,600));
      json(res,200,{ok:true,authorizeUrl:attempt.url});
    } catch(error) { json(res,409,{ok:false,error:error.message,code:error.code||'coach_calendar_auth_failed'}); }
    return true;
  }
  async function handlePublic(req,res,routePath,url) {
    if(routePath!==consentPath && routePath!==publicStartPath) return false;
    if(url.pathname!==routePath) return false;
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    if(!publicReady()) { page(res,423,'本人授权暂不可用','教练本人授权邀请尚未开放，请联系管理员。',true);return true; }
    if(!formalGatewayRequest(req,url,routePath)) { page(res,421,'邀请入口不可用','请使用正式中枢域名打开本人邀请。',true);return true; }
    if(routePath===consentPath) {
      if(req.method!=='GET') { page(res,405,'请求方式不支持','请打开管理员发给本人的授权邀请。',true);return true; }
      if(url.search) { page(res,400,'邀请不可用','请使用管理员发给本人的完整授权链接。',true);return true; }
      const nonce=randomBytes(16).toString('base64');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer',
        'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
        'Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`});
      res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>教练本人日历授权</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:640px;margin:60px auto;padding:24px;color:#183c30}button{padding:10px 18px}</style><h1>教练本人日历只读授权</h1><p>请确认你正使用本人的飞书账号。系统只读取已核验教练本人主日历中复盘所需日程，不修改日程；无需登录中枢。</p><form method="post" action="${escapeHtml(basePath+publicStartPath)}"><input id="invite" type="hidden" name="invite"><button id="submit" type="submit" disabled>前往飞书完成本人授权</button></form><p id="status">正在核验邀请链接…</p><script nonce="${nonce}">try{const raw=location.hash.startsWith('#invite=')?decodeURIComponent(location.hash.slice(8)):'';history.replaceState(null,'',location.pathname);if(!/^[A-Za-z0-9_-]{43}\\.[0-9]{13}\\.[A-Za-z0-9_-]{43}$/.test(raw))throw Error();document.getElementById('invite').value=raw;document.getElementById('submit').disabled=false;document.getElementById('status').textContent='邀请十分钟内有效且只可使用一次。';}catch{document.getElementById('status').textContent='邀请无效，请联系管理员重新获取。';}</script>`);
      return true;
    }
    if(req.method!=='POST') { page(res,405,'请求方式不支持','请打开管理员发给本人的授权邀请。',true);return true; }
    if(!sameFormOrigin(req) || !/^application\/x-www-form-urlencoded(?:;|$)/iu.test(req.headers['content-type']||'')) {
      page(res,403,'授权未发起','请从本人邀请页点击授权按钮。',true);return true;
    }
    try {
      const chunks=[];let length=0;
      for await (const chunk of req) { length+=chunk.length; if(length>2048) throw Error('form too large'); chunks.push(chunk); }
      const form=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      if(form.getAll('invite').length!==1 || [...form.keys()].some(key=>key!=='invite')) throw Error('bad form');
      const token=form.get('invite');
      const candidate=await invitations.inspect(token);
      if(candidate.openId!==openIds[candidate.room] || !Object.hasOwn(coachNames,candidate.room)) throw Error('identity changed');
      await verifyActor(candidate.room,candidate.openId,coachNames[candidate.room],employeeNos[candidate.room]);
      const item=await invitations.consume(token); // Irrevocably one-time before redirect.
      if(item.room!==candidate.room || item.openId!==candidate.openId) throw Error('invitation changed');
      const attempt=beginAttempt(item.room,'public');
      res.writeHead(303,{'Location':attempt.url,'Set-Cookie':cookie(attempt.state,600),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
      res.end();
    } catch { page(res,409,'授权未发起','邀请已过期或无法核验，请联系管理员重新获取。',true); }
    return true;
  }
  async function handleCallback(req,res,url) {
    if(url.pathname!==callbackPath) return false;
    const state=url.searchParams.get('state') || '';
    const item=pending.get(state);
    if (!item) return false; // Leave the pre-existing interview OAuth callback untouched.
    pending.delete(state);
    res.setHeader('Set-Cookie',cookie('',0));
    if(!formalGatewayRequest(req,url,callbackPath)) {
      page(res,421,'日历授权未完成','回调地址与正式中枢不一致，未保存授权。',item.mode==='public');return true;
    }
    if (req.method !== 'GET') { page(res,405,'日历授权未完成','授权回调只接受 GET。');return true; }
    if (!enabled || readOnly || clock()-item.at>600_000) { page(res,409,'日历授权未完成','授权已过期或当前仅供查看，请由本人重新发起。');return true; }
    if (url.searchParams.has('error')) { page(res,400,'日历授权已取消','未保存新授权，原有日历资料保持不变。',item.mode==='public');return true; }
    const cookieState=String(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
    try {
      if(item.openId!==openIds[item.room]) throw Error('教练身份绑定已变化，请重新获取邀请。');
      try { await verifyActor(item.room,item.openId,coachNames[item.room],employeeNos[item.room]); }
      catch { throw Error('当前本人在职身份无法核验，凭据未保存。'); }
      await readers[item.room].complete({code:url.searchParams.get('code'),state,cookieState});
      page(res,200,'本人日历授权完成',`${coachNames[item.room]}的日历只读授权已保存。${item.mode==='public'?'无需登录中枢。':'返回直播中心后可核验复盘统计。'}`,item.mode==='public');
    } catch(error) { page(res,400,'日历授权未完成',error.message||'授权校验失败，请由本人重新发起。',item.mode==='public'); }
    return true;
  }
  return {handleApi,handlePublic,handleCallback,roomFor};
}
