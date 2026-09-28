const prefix='/api/lifecycle/private-chat-auth/';
const callbackPath='/api/lifecycle/calendar-auth/callback';
const cookieName='live_private_chat_oauth_state';
const escapeHtml=value=>String(value).replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function createPrivateChatAuth({actors,readers,basePath,publicOrigin,enabled,json,verifyActor,clock=Date.now}) {
  const pending=new Map();
  const actorFor=auth=>{
    const number=auth?.user?.number, actor=actors[number];
    return auth?.ok && auth.mode==='central' && !auth.degraded && actor
      && (auth.user.name || auth.user.realName)===actor.name
      && (!auth.user.open_id || auth.user.open_id===actor.openId)
      ? {...actor,number} : null;
  };
  const cookie=(state,age)=>`${cookieName}=${state}; Max-Age=${age}; Path=${basePath}${callbackPath}; HttpOnly; Secure; SameSite=Lax`;
  const headers=res=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer')};
  // Check the browser origin against the canonical public URL, never a supplied
  // forwarded host. Test/deployment must supply that public origin explicitly.
  function validOrigin(req){
    return req.headers['x-requested-with']==='XMLHttpRequest' && req.headers['sec-fetch-site']!=='cross-site'
      && req.headers.origin===publicOrigin;
  }
  const publicError=error=>String(error?.code||'').startsWith('private_chat_') ? error.message : '授权服务暂时不可用，请稍后重试。';
  function page(res,status,title,detail){
    res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"});
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;padding:32px;font:16px/1.8 'Microsoft YaHei',sans-serif;color:#173c30;background:#f6faf8}main{max-width:620px;margin:12vh auto}h1{font-size:28px}a{color:#176147}</style><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><a href="${escapeHtml(basePath)}/#private-chat">返回考核私聊授权</a></main></html>`);
  }
  async function handleApi(req,res,path,auth){
    headers(res);
    const action=path.slice(prefix.length), actor=actorFor(auth);
    if(!['status','start','verify'].includes(action))return json(res,404,{ok:false,error:'授权接口不存在。'});
    if(action==='status' && req.method==='GET' && !actor)return json(res,200,{ok:true,eligible:false,enabled,reason:'请倪梦萍或刘慧迅使用本人 OA 账号登录后授权。添加应用协作者不能代替本人授权。'});
    if(!actor)return json(res,403,{ok:false,error:'仅倪梦萍或刘慧迅本人可以办理此授权。'});
    try{await verifyActor(actor)}catch{return json(res,403,{ok:false,error:'本人 OA 与飞书在职身份核验未通过，请联系管理员。'})}
    try{
      const reader=readers[actor.number];
      if(action==='status' && req.method==='GET')return json(res,200,{ok:true,eligible:true,enabled,name:actor.name,authorization:await reader.status()});
      if(req.method!=='POST')return json(res,405,{ok:false,error:'请从本人授权页面操作。'});
      if(!enabled)return json(res,423,{ok:false,error:'考核私聊授权入口尚未开放。'});
      if(!validOrigin(req))return json(res,403,{ok:false,error:'请从直播间本人授权页面发起。'});
      if(action==='verify')return json(res,200,{ok:true,verification:await reader.verify()});
      if(action!=='start')return json(res,405,{ok:false,error:'请求方式不支持。'});
      for(const [state,item] of pending)if(clock()-item.at>600000)pending.delete(state);
      if(pending.size>=32)return json(res,429,{ok:false,error:'授权请求较多，请稍后重试。'});
      const attempt=reader.begin();
      pending.set(attempt.state,{number:actor.number,at:clock()});
      res.setHeader('Set-Cookie',cookie(attempt.state,600));
      return json(res,200,{ok:true,authorizeUrl:attempt.url});
    }catch(error){return json(res,409,{ok:false,error:publicError(error)})}
  }
  async function handleCallback(req,res,url){
    const state=url.searchParams.get('state') || '';
    if(!state.startsWith('pchat_'))return false;
    const item=pending.get(state);pending.delete(state);
    res.setHeader('Set-Cookie',cookie('',0));
    if(req.method!=='GET' || !enabled || !item || clock()-item.at>600000){page(res,409,'私聊授权未完成','授权链接已失效，请返回入口，由本人重新发起。');return true}
    if(url.searchParams.has('error')){page(res,400,'私聊授权未完成','飞书授权已取消或未获批准。请确认应用已开通用户身份的会话、消息与单聊读取权限，再重新授权。');return true}
    const cookieState=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
    try{
      // OAuth is a cross-site top-level navigation: OA cookies may be Strict.
      // The actor was verified at start; the reader binds PKCE + callback cookie
      // and verifies this exact actor's Feishu identity before storing anything.
      const actor={...actors[item.number],number:item.number};
      await verifyActor(actor);
      await readers[item.number].complete({code:url.searchParams.get('code'),state,cookieState});
      page(res,200,'考核私聊授权完成',`${actor.name}的只读授权已保存，倪梦萍与刘慧迅之间的私聊读取权限已核验。此操作不会自动修改候选人的考核结论。`);
    }catch(error){page(res,400,'私聊授权未完成',publicError(error))}
    return true;
  }
  return {handleApi,handleCallback};
}
