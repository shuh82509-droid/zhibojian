// This handler never returns credentials. The callback is OAuth-state protected
// and may run before OA validation so a redirect cannot discard code/state.
export function createCalendarAuthHandler({reader, basePath, readOnly, json}) {
  const cookieName = 'live_calendar_oauth_state';
  const callback = '/api/lifecycle/calendar-auth/callback';
  const cookie = (state, age) => `${cookieName}=${state}; Max-Age=${age}; Path=${basePath}${callback}; HttpOnly; Secure; SameSite=Lax`;
  const holdMessage = '日历授权交换或续期结果待核验，已停止访问与自动重试。请勿刷新回调页或重复授权；需由管理员独立核验后恢复。';
  const unavailableMessage = '日历授权状态暂时无法安全核验，未发起新的授权。请勿刷新回调页或重复授权；需先核验处理结果。';
  // Keep existing public codes, but never trust a mutable error's message or
  // diagnostic object. No code/state/verifier/credential/body is reflected.
  const publicMessages = Object.freeze({
    calendar_auth_not_configured:'日历用户授权尚未配置。',
    calendar_redirect_invalid:'正式日历授权回调必须使用固定 HTTPS 地址。',
    calendar_oauth_state_invalid:'日历授权校验失败或已过期；请勿刷新旧回调页，请返回中枢核验授权状态。',
    calendar_pkce_local_invalid:'日历授权安全参数校验失败，未提交凭据请求。',
    calendar_oauth_wrong_user:'授权账号不是指定的本人账号，凭据未保存。',
    calendar_identity_unverified:'无法核验日历授权用户身份。',
    calendar_primary_unverified:'无法核验本人主日历，未读取或保存日历资料。',
    calendar_detail_permission_missing:'指定日历的详情读取权限尚未核验。',
    calendar_scope_missing:'飞书日历授权未包含所需的只读与离线权限。',
    calendar_token_expiry_invalid:'日历授权有效期无法核验，凭据未保存。',
    calendar_path_denied:'此日历未列入已核验的只读来源。',
    calendar_store_invalid:'日历授权存储格式不可识别，已停止处理。',
    calendar_store_unreadable:'正式日历授权无法读取，已停止处理。',
    calendar_oauth_exchange_failed:'飞书日历授权交换未完成。请勿刷新回调页或重复授权；需先核验处理结果。',
    calendar_authorization_busy:holdMessage,
    calendar_refresh_recovery_required:holdMessage
  });
  const heldBody = () => ({ok:false,error:holdMessage,code:'calendar_refresh_recovery_required',recoveryRequired:true,retryAllowed:false});
  const unavailableBody = () => ({ok:false,error:unavailableMessage,code:'calendar_auth_status_unavailable',retryAllowed:false});
  function publicFailure(failure) {
    let code;
    try { code=failure?.code; } catch { /* Untrusted accessors are not diagnostics. */ }
    if (typeof code!=='string' || !Object.hasOwn(publicMessages,code))
      return {ok:false,error:'日历授权处理未完成。请勿刷新回调页或重复授权；需先核验处理结果。',code:'calendar_auth_failed',retryAllowed:false};
    return {ok:false,error:publicMessages[code],code,retryAllowed:false};
  }
  async function checkedStatus() {
    let timer;
    try {
      const raw=await Promise.race([
        Promise.resolve().then(()=>reader.status()),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('status unavailable')),1500);})
      ]);
      if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('status unavailable');
      // Snapshot once: status must not change through a later property access.
      const authorized=raw.authorized,configured=raw.configured,status=raw.status,recoveryRequired=raw.recoveryRequired;
      if (typeof authorized!=='boolean' || (configured!==undefined && typeof configured!=='boolean')
        || (status!==undefined && status!=='recovery_required')
        || (recoveryRequired!==undefined && typeof recoveryRequired!=='boolean')
        || (configured===false && authorized)) throw new Error('status unavailable');
      const held=status==='recovery_required' || recoveryRequired===true;
      const calendar={...(configured===undefined?{}:{configured}),authorized:held?false:authorized,
        ...(held?{status:'recovery_required',recoveryRequired:true,reason:holdMessage}
          :authorized?{}:{reason:configured===false?'日历用户授权配置不完整':'日历读取尚未授权、已过期或待核验。'})};
      // Identity and grant expiry remain private reader metadata. HTTP needs
      // only these public booleans/flags and fixed guidance, not raw strings.
      return {calendar,held,configured};
    } finally { clearTimeout(timer); }
  }
  async function callbackFailure(res,failure,{cancelled=false}={}) {
    let status;
    try { status=await checkedStatus(); } catch { return json(res,503,unavailableBody()); }
    if (status.held) return json(res,409,heldBody());
    if (cancelled) return json(res,400,{ok:false,error:'已取消授权，原凭据保持不变。'});
    return json(res,400,publicFailure(failure));
  }
  return async function calendarAuth(req, res, url, routePath, auth) {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (routePath === callback) {
      if (req.method !== 'GET') return json(res,405,{ok:false,error:'仅支持授权回调 GET 请求。'});
      if (readOnly) return json(res,423,{ok:false,error:'候选或恢复只读状态，未保存授权。'});
      const stateCookie = String(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1) || '';
      res.setHeader('Set-Cookie',cookie('',0));
      try {
        if (url.searchParams.has('error')) return callbackFailure(res,null,{cancelled:true});
        const result=await reader.complete({code:url.searchParams.get('code'),state:url.searchParams.get('state'),cookieState:stateCookie});
        if (result?.authorized!==true) return callbackFailure(res,null);
        return json(res,200,{ok:true,authorized:true,message:'指定面试日历只读授权已保存，可返回直播中枢刷新日历。'});
      } catch (failure) { return callbackFailure(res,failure); }
    }
    if (!auth?.ok || !(auth.permissions?.super_admin || auth.permissions?.manage_permissions)) return json(res,403,{ok:false,error:'仅中枢管理员可以管理日历读取授权。'});
    if (req.method === 'GET' && routePath.endsWith('/status')) {
      try { return json(res,200,{ok:true,calendar:(await checkedStatus()).calendar}); }
      catch { return json(res,503,unavailableBody()); }
    }
    if (req.method === 'POST' && routePath.endsWith('/start')) {
      if(readOnly)return json(res,423,{ok:false,error:'恢复只读状态不允许新增授权。'});
      if(req.headers['x-requested-with']!=='XMLHttpRequest'||req.headers['sec-fetch-site']==='cross-site')return json(res,403,{ok:false,error:'请从中枢发起授权。'});
      if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{}if(!origin||origin.host!==req.headers.host)return json(res,403,{ok:false,error:'授权请求来源不匹配。'});}
      let status;
      try { status=await checkedStatus(); } catch { return json(res,503,unavailableBody()); }
      if (status.held) return json(res,409,heldBody());
      if (status.configured===false) return json(res,409,publicFailure({code:'calendar_auth_not_configured'}));
      try{const attempt=reader.begin();res.setHeader('Set-Cookie',cookie(attempt.state,600));return json(res,200,{ok:true,authorizeUrl:attempt.url});}
      catch(failure){return json(res,409,publicFailure(failure));}
    }
    return json(res,405,{ok:false,error:'授权接口请求方式不支持。'});
  };
}
