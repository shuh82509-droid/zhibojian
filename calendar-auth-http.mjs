// This handler never returns credentials. The callback is OAuth-state protected
// and may run before OA validation so a redirect cannot discard code/state.
export function createCalendarAuthHandler({reader, basePath, readOnly, json}) {
  const cookieName = 'live_calendar_oauth_state';
  const callback = '/api/lifecycle/calendar-auth/callback';
  const cookie = (state, age) => `${cookieName}=${state}; Max-Age=${age}; Path=${basePath}${callback}; HttpOnly; Secure; SameSite=Lax`;
  return async function calendarAuth(req, res, url, routePath, auth) {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (routePath === callback) {
      if (req.method !== 'GET') return json(res,405,{ok:false,error:'仅支持授权回调 GET 请求。'});
      if (readOnly) return json(res,423,{ok:false,error:'候选或恢复只读状态，未保存授权。'});
      const stateCookie = String(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1) || '';
      res.setHeader('Set-Cookie',cookie('',0));
      try {
        if (url.searchParams.has('error')) return json(res,400,{ok:false,error:'已取消授权，原凭据保持不变。'});
        const result=await reader.complete({code:url.searchParams.get('code'),state:url.searchParams.get('state'),cookieState:stateCookie});
        return json(res,200,{ok:true,authorized:result.authorized,message:'指定面试日历只读授权已保存，可返回直播中枢刷新日历。'});
      } catch (error) { return json(res,400,{ok:false,error:error.message,code:error.code||'calendar_auth_failed',...(error.diagnostic ? {diagnostic:error.diagnostic} : {})}); }
    }
    if (!auth?.ok || !(auth.permissions?.super_admin || auth.permissions?.manage_permissions)) return json(res,403,{ok:false,error:'仅中枢管理员可以管理日历读取授权。'});
    if (req.method === 'GET' && routePath.endsWith('/status')) return json(res,200,{ok:true,calendar:await reader.status()});
    if (req.method === 'POST' && routePath.endsWith('/start')) {
      if(readOnly)return json(res,423,{ok:false,error:'恢复只读状态不允许新增授权。'});
      if(req.headers['x-requested-with']!=='XMLHttpRequest'||req.headers['sec-fetch-site']==='cross-site')return json(res,403,{ok:false,error:'请从中枢发起授权。'});
      if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{}if(!origin||origin.host!==req.headers.host)return json(res,403,{ok:false,error:'授权请求来源不匹配。'});}
      try{const attempt=reader.begin();res.setHeader('Set-Cookie',cookie(attempt.state,600));return json(res,200,{ok:true,authorizeUrl:attempt.url});}
      catch(error){return json(res,409,{ok:false,error:error.message,code:error.code||'calendar_auth_failed'});}
    }
    return json(res,405,{ok:false,error:'授权接口请求方式不支持。'});
  };
}
