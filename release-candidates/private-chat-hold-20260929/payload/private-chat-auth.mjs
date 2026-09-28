const prefix='/api/lifecycle/private-chat-auth/';
const callbackPath='/api/lifecycle/calendar-auth/callback';
const cookieName='live_private_chat_oauth_state';
const escapeHtml=value=>String(value).replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const heldMessage='私聊授权交换或续期结果待核验，已停止访问与自动重试。请勿刷新回调页或重复授权；需独立核验后恢复。';
const busyMessage='私聊授权正在处理或结果待核验，已停止新的访问与授权。请勿刷新回调页或重复授权；请先核验处理结果。';
const unavailableMessage='私聊授权状态暂时无法安全核验，未发起新的授权或读取。请勿刷新回调页或重复授权；请先核验处理结果。';
const publicMessages=Object.freeze({
  private_chat_authorization_held:heldMessage,
  private_chat_authorization_busy:busyMessage,
  private_chat_auth_not_configured:'私聊用户授权配置不完整，未发起授权或读取。',
  private_chat_redirect_invalid:'私聊授权回调配置无法核验，未发起授权。',
  private_chat_store_invalid:'私聊授权存储格式无法核验，已停止访问；请勿重复授权，需独立核验。',
  private_chat_store_unreadable:'私聊授权存储无法安全读取，已停止访问；请勿重复授权，需独立核验。',
  private_chat_authorization_required:'私聊本人只读授权尚未有效核验，未读取消息；请先核验现有处理结果。',
  private_chat_oauth_state_invalid:'私聊授权状态未通过核验，未确认授权完成；请勿刷新回调页或重复授权。',
  private_chat_pkce_local_invalid:'私聊授权安全参数未通过核验，未提交凭据请求。',
  private_chat_oauth_wrong_user:'授权账号不是指定本人，未确认新授权；请先核验处理结果。',
  private_chat_oauth_exchange_failed:'私聊授权交换未确认完成；请勿刷新回调页或重复授权，需独立核验处理结果。',
  private_chat_scope_missing:'私聊只读授权范围无法核验，未确认新授权；请先核验处理结果。',
  private_chat_token_expiry_invalid:'私聊授权有效期无法核验，未确认新授权；请先核验处理结果。',
  private_chat_identity_unverified:'私聊本人身份无法核验，未确认新授权；请先核验处理结果。',
  private_chat_pair_unverified:'指定双人私聊来源无法唯一核验，未确认新授权或读取。',
  private_chat_access_failed:'指定私聊的只读权限未通过核验，未确认读取；请联系管理员核验既有权限。',
  private_chat_unavailable:'指定私聊读取暂未完成，未返回消息或统计；请先核验处理结果。',
  private_chat_range_invalid:'私聊读取时间范围未通过核验，未读取消息。',
  private_chat_incomplete:'指定私聊来源未完整核验，统计保持待核验。',
});
const own=(object,key)=>{
  if(!object || (typeof object!=='object'&&typeof object!=='function'))return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  return descriptor && Object.hasOwn(descriptor,'value') ? descriptor.value : undefined;
};
const nonempty=value=>typeof value==='string'&&value.length>0&&value.trim()===value&&!/[\p{Cc}]/u.test(value);
const strictField=(object,key)=>{
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  if((descriptor&&!Object.hasOwn(descriptor,'value'))||(!descriptor&&key in object))throw new Error('invalid field');
  return descriptor?.value;
};
const publicCode=failure=>{try{const code=own(failure,'code');return typeof code==='string'&&Object.hasOwn(publicMessages,code)?code:null;}catch{return null;}};
const publicError=failure=>publicMessages[publicCode(failure)]||unavailableMessage;

export function createPrivateChatAuth({actors,readers,basePath,publicOrigin,enabled,json,verifyActor,clock=Date.now}) {
  // Snapshot trusted configuration; later mutations cannot retarget an actor,
  // peer, reader method, or callback already verified at start.
  const actorMap=Object.create(null),readerMap=Object.create(null);
  for(const number of Object.keys(actors||{})){
    const actor=own(actors,number),reader=own(readers,number);
    const name=own(actor,'name'),openId=own(actor,'openId'),peerOpenId=own(actor,'peerOpenId');
    if(!nonempty(number)||!nonempty(name)||!nonempty(openId)||!nonempty(peerOpenId)||peerOpenId===openId)continue;
    actorMap[number]=Object.freeze({number,name,openId,peerOpenId});
    const methods=Object.create(null);
    for(const method of ['status','begin','complete','verify']){
      const fn=own(reader,method);if(typeof fn==='function')methods[method]=fn.bind(reader);
    }
    readerMap[number]=Object.freeze(methods);
  }
  Object.freeze(actorMap);Object.freeze(readerMap);
  const entryEnabled=enabled===true;
  const pending=new Map(),inFlight=new Set();
  let lastClock=0;
  const failure=(code='private_chat_unavailable')=>Object.assign(new Error(publicMessages[code]||unavailableMessage),{code});
  const actorFor=auth=>{
    try{
      const user=strictField(auth,'user'),number=strictField(user,'number'),actor=own(actorMap,number);
      const name=strictField(user,'name'),realName=strictField(user,'realName'),openId=strictField(user,'open_id'),degraded=strictField(auth,'degraded');
      if(own(auth,'ok')!==true||own(auth,'mode')!=='central'||(degraded!==undefined&&degraded!==false)||!actor
        ||typeof number!=='string'||number!==actor.number||(openId!==undefined&&(typeof openId!=='string'||openId!==actor.openId))
        ||(name===undefined&&realName===undefined)||(name!==undefined&&name!==actor.name)||(realName!==undefined&&realName!==actor.name))return null;
      return actor;
    }catch{return null;}
  };
  const cookie=(state,age)=>`${cookieName}=${state}; Max-Age=${age}; Path=${basePath}${callbackPath}; HttpOnly; Secure; SameSite=Lax`;
  const headers=res=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer')};
  function validOrigin(req){
    try{
      const canonical=new URL(publicOrigin);
      return canonical.protocol==='https:'&&!canonical.username&&!canonical.password&&canonical.origin===publicOrigin
        &&req.headers?.['x-requested-with']==='XMLHttpRequest'&&req.headers?.['sec-fetch-site']!=='cross-site'
        &&req.headers?.origin===publicOrigin;
    }catch{return false;}
  }
  async function bounded(operation){
    let timer;
    try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure()),1500);})]);}
    finally{clearTimeout(timer);}
  }
  async function checkedActor(actor){if(await bounded(()=>verifyActor(actor))!==true)throw failure();}
  function checkedStatusValue(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw failure();
    const configured=strictField(raw,'configured'),authorized=strictField(raw,'authorized'),status=strictField(raw,'status'),recoveryRequired=strictField(raw,'recoveryRequired'),retryAllowed=strictField(raw,'retryAllowed');
    if(typeof configured!=='boolean'||typeof authorized!=='boolean'
      ||!['unconfigured','unauthorized','authorized','recovery_required','busy'].includes(status)
      ||typeof recoveryRequired!=='boolean'||typeof retryAllowed!=='boolean')throw failure();
    const consistent=status==='unconfigured'?!configured&&!authorized&&!recoveryRequired&&!retryAllowed
      :status==='unauthorized'?configured&&!authorized&&!recoveryRequired&&retryAllowed
      :status==='authorized'?configured&&authorized&&!recoveryRequired&&retryAllowed
      :status==='recovery_required'?!authorized&&recoveryRequired&&!retryAllowed
      :!authorized&&!recoveryRequired&&!retryAllowed;
    if(!consistent)throw failure();
    return Object.freeze({configured,authorized,status,recoveryRequired,retryAllowed,
      ...(status==='recovery_required'?{reason:heldMessage}:status==='busy'?{reason:busyMessage}
        :authorized?{}:{reason:configured?'私聊本人只读授权尚未有效核验。':'私聊用户授权配置不完整。'})});
  }
  async function checkedStatus(reader){return checkedStatusValue(await bounded(()=>reader.status()));}
  const blocked=authorization=>authorization.status==='recovery_required'||authorization.status==='busy';
  const blockBody=authorization=>authorization.status==='busy'
    ?{ok:false,error:busyMessage,code:'private_chat_authorization_busy',status:'busy',retryAllowed:false}
    :{ok:false,error:heldMessage,code:'private_chat_authorization_held',status:'recovery_required',recoveryRequired:true,retryAllowed:false};
  const localBusy=authorization=>Object.freeze({configured:authorization.configured,authorized:false,status:'busy',recoveryRequired:false,retryAllowed:false,reason:busyMessage});
  const hasPending=number=>[...pending.values()].some(item=>item.number===number);
  function timestamp(){const value=clock();if(!Number.isSafeInteger(value)||value<=0||value>8640000000000000||value<lastClock)throw failure();lastClock=value;return value;}
  function cleanPending(at,number){for(const [state,item]of pending)if(item.number===number&&at-item.at>600000)pending.delete(state);}
  function checkedAttempt(attempt){
    const state=own(attempt,'state'),value=own(attempt,'url');
    if(typeof state!=='string'||!/^pchat_[A-Za-z0-9_-]{1,256}$/u.test(state)||typeof value!=='string')throw failure();
    const url=new URL(value);
    if(!value.startsWith('https://accounts.feishu.cn/')||value.includes('#')||url.protocol!=='https:'||url.hostname!=='accounts.feishu.cn'||url.username||url.password||url.port
      ||url.pathname!=='/open-apis/authen/v1/authorize'||url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==state)throw failure();
    return {state,url:url.toString()};
  }
  function checkedVerification(raw){
    const verified=own(raw,'verified'),sampleAvailable=own(raw,'sampleAvailable');
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||verified!==true||typeof sampleAvailable!=='boolean')throw failure();
    return {verified:true,sampleAvailable};
  }
  function page(res,status,title,detail){
    res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"});
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;padding:32px;font:16px/1.8 'Microsoft YaHei',sans-serif;color:#173c30;background:#f6faf8}main{max-width:620px;margin:12vh auto}h1{font-size:28px}a{color:#176147}</style><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><a href="${escapeHtml(basePath)}/#private-chat">返回考核私聊授权</a></main></html>`);
  }
  async function callbackFailure(res,actor,cause){
    if(actor){
      try{const authorization=await checkedStatus(readerMap[actor.number]);if(blocked(authorization)){page(res,409,'私聊授权未完成',blockBody(authorization).error);return;}}
      catch(statusFailure){const code=publicCode(statusFailure);page(res,409,'私聊授权未完成',code==='private_chat_authorization_held'||code==='private_chat_authorization_busy'?publicMessages[code]:unavailableMessage);return;}
    }
    page(res,409,'私聊授权未完成',cause?publicError(cause):unavailableMessage);
  }
  async function handleApi(req,res,path,auth){
    headers(res);
    const action=path.slice(prefix.length),actor=actorFor(auth);
    if(!['status','start','verify'].includes(action))return json(res,404,{ok:false,error:'授权接口不存在。'});
    if(action==='status'&&req.method==='GET'&&!actor)return json(res,200,{ok:true,eligible:false,enabled:entryEnabled,reason:'请倪梦萍或刘慧迅使用本人 OA 账号登录后授权。添加应用协作者不能代替本人授权。'});
    if(!actor)return json(res,403,{ok:false,error:'仅倪梦萍或刘慧迅本人可以办理此授权。'});
    if(action!=='status'){
      if(req.method!=='POST')return json(res,405,{ok:false,error:'请从本人授权页面操作。'});
      if(!entryEnabled)return json(res,423,{ok:false,error:'考核私聊授权入口尚未开放。'});
      if(!validOrigin(req))return json(res,403,{ok:false,error:'请从直播间本人授权页面发起。'});
      if(inFlight.has(actor.number))return json(res,409,blockBody({status:'busy'}));
      inFlight.add(actor.number);
    }else if(req.method!=='GET')return json(res,405,{ok:false,error:'请从本人授权页面操作。'});
    let operationStarted=false;
    try{
      try{await checkedActor(actor);}catch{return json(res,403,{ok:false,error:'本人 OA 与飞书在职身份核验未通过或未及时完成，未发起授权或读取。'});}
      const reader=readerMap[actor.number];
      let authorization=await checkedStatus(reader);
      if(action==='status'){
        const normal=authorization.status==='authorized'||authorization.status==='unauthorized';
        // Only an exact healthy reader snapshot may expire this actor's local
        // pre-POST URL state. Never clear a reader hold, lock, grant or busy work.
        if(normal&&!inFlight.has(actor.number))cleanPending(timestamp(),actor.number);
        if(normal&&(inFlight.has(actor.number)||hasPending(actor.number)))authorization=localBusy(authorization);
        return json(res,200,{ok:true,eligible:true,enabled:entryEnabled,name:actor.name,authorization});
      }
      if(blocked(authorization))return json(res,409,blockBody(authorization));
      const at=timestamp();cleanPending(at,actor.number);
      if(hasPending(actor.number))return json(res,409,blockBody({status:'busy'}));
      if(!authorization.configured)return json(res,409,{ok:false,error:publicMessages.private_chat_auth_not_configured,code:'private_chat_auth_not_configured',retryAllowed:false});
      if(action==='verify'){
        if(!authorization.authorized)return json(res,409,{ok:false,error:publicMessages.private_chat_authorization_required,code:'private_chat_authorization_required',retryAllowed:false});
        operationStarted=true;
        const verification=checkedVerification(await reader.verify());
        const after=await checkedStatus(reader);if(blocked(after))return json(res,409,blockBody(after));
        if(!after.authorized)throw failure();
        return json(res,200,{ok:true,verification});
      }
      if(pending.size>=32)return json(res,429,{ok:false,error:'授权请求较多，未发起新的授权。请先核验已有处理结果。'});
      operationStarted=true;
      const attempt=checkedAttempt(reader.begin());
      if(pending.has(attempt.state))throw failure();
      pending.set(attempt.state,{number:actor.number,at:timestamp()});
      res.setHeader('Set-Cookie',cookie(attempt.state,600));
      return json(res,200,{ok:true,authorizeUrl:attempt.url});
    }catch(cause){
      const code=publicCode(cause);
      if(operationStarted&&code!=='private_chat_authorization_held'&&code!=='private_chat_authorization_busy'){
        try{const after=await checkedStatus(readerMap[actor.number]);if(blocked(after))return json(res,409,blockBody(after));}
        catch{return json(res,409,{ok:false,error:unavailableMessage,retryAllowed:false});}
      }
      return json(res,409,code==='private_chat_authorization_held'||code==='private_chat_authorization_busy'?blockBody({status:code==='private_chat_authorization_busy'?'busy':'recovery_required'}):{ok:false,error:publicError(cause),retryAllowed:false});
    }finally{if(action!=='status')inFlight.delete(actor.number);}
  }
  async function handleCallback(req,res,url){
    const state=url.searchParams.get('state')||'';
    if(!state.startsWith('pchat_'))return false;
    const item=pending.get(state);pending.delete(state);
    res.setHeader('Set-Cookie',cookie('',0));
    const actor=item?actorMap[item.number]:null;
    if(!actor){await callbackFailure(res,null,null);return true;}
    if(inFlight.has(actor.number)){page(res,409,'私聊授权未完成',busyMessage);return true;}
    inFlight.add(actor.number);
    try{
      const at=timestamp();
      if(req.method!=='GET'||!entryEnabled||at-item.at>600000){await callbackFailure(res,actor,null);return true;}
      if(url.searchParams.has('error')){await callbackFailure(res,actor,null);return true;}
      await checkedActor(actor);
      const before=await checkedStatus(readerMap[actor.number]);
      if(blocked(before)){page(res,409,'私聊授权未完成',blockBody(before).error);return true;}
      if(!before.configured)throw failure('private_chat_auth_not_configured');
      if(timestamp()-item.at>600000)throw failure('private_chat_oauth_state_invalid');
      const cookieState=String(req.headers?.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
      // The reader alone exchanges codes, checks PKCE + cookie, fixed identity,
      // pair and durable grant. This wrapper never resets a hold or reads data.
      const result=checkedStatusValue(await readerMap[actor.number].complete({code:url.searchParams.get('code'),state,cookieState}));
      if(result.status!=='authorized'||!result.authorized)throw failure();
      const after=await checkedStatus(readerMap[actor.number]);if(blocked(after)){page(res,409,'私聊授权未完成',blockBody(after).error);return true;}
      if(!after.authorized)throw failure();
      page(res,200,'考核私聊授权完成',`${actor.name}的只读授权已保存，倪梦萍与刘慧迅之间的私聊读取权限已核验。此操作不会自动修改候选人的考核结论。`);
    }catch(cause){await callbackFailure(res,actor,cause);}
    finally{inFlight.delete(actor.number);}
    return true;
  }
  return Object.freeze({handleApi,handleCallback});
}
