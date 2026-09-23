(() => {
  const apiRoot = location.pathname.split('/modules/')[0];
  const devDialog = document.querySelector('#developmentDialog');
  const listRoot = document.querySelector('#developmentList');
  const search = document.querySelector('#developmentSearch');
  const fieldsRoot = document.querySelector('#developmentFields');
  const emptyRoot = document.querySelector('#developmentEmpty');
  const matrixRoot = document.querySelector('#developmentRatingMatrix');
  const profileLayout = document.querySelector('#developmentProfileLayout');
  const state = { profiles:{}, dimensions:['话术','节奏','演绎','控场'], trainingStages:[], courses:[], accounts:[], selected:'', loaded:false };
  const aliases = {'黄芷瞳':'黄芷曈'};
  const canonical = (value) => aliases[String(value || '').trim()] || String(value || '').trim();
  const dEsc = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const todayKey = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const roomFor = (name) => Object.entries(D.rooms || {}).find(([,items]) => items.some(item => canonical(item.name) === canonical(name)))?.[0] || state.profiles[canonical(name)]?.account || '待核验';
  const activeNames = () => [...new Set(allHosts().map(item => canonical(item.name)).filter(Boolean))];
  const allNames = () => [...new Set([...activeNames(), ...Object.values(state.profiles).filter(profile => profile?.newcomer).map(profile => canonical(profile.name))])].sort((a,b) => Number(Boolean(state.profiles[b]?.newcomer))-Number(Boolean(state.profiles[a]?.newcomer)) || a.localeCompare(b,'zh-CN'));
  const numeric = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? Number(value) : null;
  const grade = (value) => ['A','B','C','D'].includes(String(value || '').toUpperCase()) ? String(value).toUpperCase() : '';

  async function devApi(options = {}) {
    const response = await fetch(`${apiRoot}/api/anchor-development`,{credentials:'same-origin',cache:'no-store',...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'}:{}),...(options.headers||{})}});
    const payload = await response.json().catch(()=>({}));
    if(!response.ok||payload.ok===false) throw new Error(payload.error||'主播成长档案请求失败。');
    return payload;
  }

  function gradeSelect(dimension,value,scope='matrix') {
    return `<select aria-label="${dEsc(dimension)}等级" data-${scope}-ability="${dEsc(dimension)}"><option value="">待评</option>${['A','B','C','D'].map(item=>`<option ${item===grade(value)?'selected':''}>${item}</option>`).join('')}</select>`;
  }
  function growthRows(profile) {
    return (profile?.growthRecords || []).filter(item => numeric(item.score) != null && /^\d{4}-\d{2}-\d{2}$/u.test(String(item.date || ''))).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  }
  function growthTrend(profile,name) {
    const rows=growthRows(profile),width=560,height=150,pad=28;
    if(!rows.length) return `<div class="rating-trend-empty">${dEsc(name)} 暂无课程周期成长评分。</div>`;
    const x=index=>rows.length===1?width/2:pad+index*(width-pad*2)/(rows.length-1), y=value=>height-pad-(Number(value)/100)*(height-pad*2), points=rows.map((item,index)=>`${x(index)},${y(item.score)}`).join(' ');
    return `<div class="rating-trend-title"><div><b>${dEsc(name)} · 成长评分趋势</b><span>${rows.length} 期 · 最新 ${rows.at(-1).score} 分</span></div><em>0–100 分</em></div><svg class="rating-trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${dEsc(name)}成长评分趋势">${[0,50,100].map(value=>`<g><line x1="${pad}" y1="${y(value)}" x2="${width-pad}" y2="${y(value)}"></line><text x="3" y="${y(value)+4}">${value}</text></g>`).join('')}<polyline points="${points}"></polyline>${rows.map((item,index)=>`<circle cx="${x(index)}" cy="${y(item.score)}" r="4"><title>${dEsc(item.date)} · ${item.score} 分 · ${dEsc(item.coursePeriod||'培养周期')}</title></circle>`).join('')}<text class="date-label" x="${pad}" y="${height-3}">${dEsc(rows[0].date.slice(5))}</text><text class="date-label" x="${width-pad}" y="${height-3}" text-anchor="end">${dEsc(rows.at(-1).date.slice(5))}</text></svg>`;
  }
  function ratingHistory(profile) {
    return (profile?.ratings || []).slice(0,8).map(item => `<span>${dEsc(item.date || '历史')} · ${dEsc(item.overallGrade || '待评')} · ${state.dimensions.map(dimension=>`${dimension} ${grade(item.scores?.[dimension])||'—'}`).join(' / ')}${item.comment?` · ${dEsc(item.comment)}`:''}</span>`).join('') || '<span>尚无 ABCD 周期评级</span>';
  }

  function renderList() {
    const q=search.value.trim().toLowerCase();
    listRoot.innerHTML=allNames().filter(name=>!q||`${name} ${roomFor(name)}`.toLowerCase().includes(q)).map(name=>{const profile=state.profiles[name];return `<button type="button" class="development-list-item ${state.selected===name?'active':''}" data-dev-name="${dEsc(name)}"><span><b>${dEsc(name)}</b><small>${dEsc(profile?.account||roomFor(name))} · ${dEsc(profile?.trainingStage||'培养阶段待录入')}</small></span><em>${profile?.newcomer?'新人池':profile?.courseProgress||'未建档'}</em></button>`}).join('');
    listRoot.querySelectorAll('[data-dev-name]').forEach(button=>button.onclick=()=>selectAnchor(button.dataset.devName));
  }

  function renderMatrix() {
    const names=activeNames().sort((a,b)=>a.localeCompare(b,'zh-CN'));
    matrixRoot.innerHTML=`<header><div><h3>在职主播周期评级</h3><p>话术、节奏、演绎、控场分别使用 A / B / C / D；不生成趋势，也不换算百分制。</p></div><span>当前在职 ${names.length} 名</span></header><div class="rating-matrix-scroll"><table><thead><tr><th>主播</th>${state.dimensions.map(item=>`<th>${dEsc(item)}</th>`).join('')}<th>评级日期</th><th>一句话评语</th><th>最新综合</th><th></th></tr></thead><tbody>${names.map(name=>{const profile=state.profiles[name]||{};return `<tr data-rating-name="${dEsc(name)}"><td><b>${dEsc(name)}</b><small>${dEsc(profile.account||roomFor(name))}</small></td>${state.dimensions.map(item=>`<td>${gradeSelect(item,profile.abilities?.[item])}</td>`).join('')}<td><input data-rating-date type="date" value="${todayKey()}"></td><td><input data-rating-comment value="" placeholder="本周期表现与下一步"></td><td><strong class="grade-chip grade-${dEsc(profile.latestGrade||'pending')}">${dEsc(profile.latestGrade||'待评')}</strong></td><td><button type="button" data-save-rating>提交</button></td></tr>`}).join('')}</tbody></table></div>`;
    matrixRoot.querySelectorAll('[data-save-rating]').forEach(button=>button.onclick=()=>saveRatingRow(button));
  }

  async function saveRatingRow(button) {
    const row=button.closest('[data-rating-name]'),name=canonical(row.dataset.ratingName),scores=Object.fromEntries([...row.querySelectorAll('[data-matrix-ability]')].map(input=>[input.dataset.matrixAbility,grade(input.value)])),date=row.querySelector('[data-rating-date]').value,comment=row.querySelector('[data-rating-comment]').value;
    if(Object.values(scores).some(value=>!value)){button.textContent='请填满四项';return}
    button.disabled=true;button.textContent='保存中';
    try {const response=await devApi({method:'POST',body:JSON.stringify({name,abilities:scores,abilityComment:comment,rating:{scores,date,comment}})});state.profiles[name]=response.profile;syncProfiles();renderMatrix();renderList()}
    catch(error){button.textContent=error.message}
    finally{button.disabled=false}
  }

  function selectAnchor(rawName) {
    const name=canonical(rawName);state.selected=name;renderList();const profile=state.profiles[name]||{};
    emptyRoot.hidden=true;fieldsRoot.hidden=false;fieldsRoot.className='development-fields';
    fieldsRoot.innerHTML=`
      <section class="development-card"><h3>${dEsc(name)} · 基础名片</h3><div class="development-identity"><label>当前账号<select id="devAccount">${state.accounts.map(item=>`<option ${item===(profile.account||roomFor(name))?'selected':''}>${dEsc(item)}</option>`).join('')}</select></label><label>入职日期<input id="devJoinDate" type="date" value="${dEsc(profile.joinDate||'')}"></label><label>职务<input id="devTitle" value="${dEsc(profile.title||'主播')}"></label><label>当前资源位<input id="devResource" value="${dEsc(profile.currentResource||'')}"></label></div><label style="margin-top:9px">培养阶段<select id="devStage">${state.trainingStages.map(item=>`<option ${item===profile.trainingStage?'selected':''}>${dEsc(item)}</option>`).join('')}</select></label><div class="newcomer-quick"><label><input id="devNewcomer" type="checkbox" style="width:auto" ${profile.newcomer?'checked':''}>加入新人池</label><button id="quickNewcomer" type="button">加入新人池</button></div></section>
      <section class="development-card"><h3>最近在职周期评级 <small>${dEsc(profile.latestGrade||'待评')}</small></h3><div class="rating-history">${ratingHistory(profile)}</div><label style="margin-top:9px">最近评级评语<textarea id="devAbilityComment" rows="2">${dEsc(profile.abilityComment||'')}</textarea></label></section>
      <section class="development-card"><h3>成长记录 <small>课程周期单次 0–100 分</small></h3><div class="development-rating growth-entry"><label>课程周期<input id="devGrowthPeriod" placeholder="例：基础播感第 2 周"></label><label>评分日期<input id="devGrowthDate" type="date" value="${todayKey()}"></label><label>成长评分<input id="devGrowthScore" type="number" min="0" max="100" step="0.1" placeholder="待录入"></label><label>评语<input id="devGrowthComment" placeholder="本周期进步与下一步"></label></div><div class="profile-trend">${growthTrend(profile,name)}</div></section>
      <section class="development-card"><h3>培养课程 <small>${dEsc(profile.courseProgress||`0/${state.courses.length}`)}</small></h3><div class="course-grid">${state.courses.map(item=>`<label><input type="checkbox" data-course="${dEsc(item)}" ${profile.courses?.includes(item)?'checked':''}>${dEsc(item)}</label>`).join('')}</div></section>
      <div class="development-save"><span id="devSaveStatus">保存后记录操作人和更新时间</span><button id="saveDevelopment" type="button">保存成长档案</button></div>`;
    document.querySelector('#saveDevelopment').onclick=saveProfile;
    document.querySelector('#quickNewcomer').onclick=quickNewcomer;
  }

  async function quickNewcomer() {
    const name=state.selected,status=document.querySelector('#devSaveStatus'),button=document.querySelector('#quickNewcomer');if(!name)return;
    button.disabled=true;status.textContent='正在加入新人池…';
    try {const response=await devApi({method:'POST',body:JSON.stringify({name,newcomer:true,account:document.querySelector('#devAccount').value,joinDate:document.querySelector('#devJoinDate').value,trainingStage:state.trainingStages[0]})});state.profiles[name]=response.profile;syncProfiles();renderList();selectAnchor(name)}
    catch(error){status.textContent=error.message}
    finally{button.disabled=false}
  }

  async function createNewcomer() {
    const input=document.querySelector('#newcomerName'),button=document.querySelector('#createNewcomer'),name=canonical(input.value);
    if(!name){input.focus();return}
    button.disabled=true;
    try {const response=await devApi({method:'POST',body:JSON.stringify({name,newcomer:true,trainingStage:state.trainingStages[0],account:state.accounts[0]})});state.profiles[name]=response.profile;input.value='';syncProfiles();renderList();selectAnchor(name)}
    catch(error){window.alert(error.message)}
    finally{button.disabled=false}
  }

  async function saveProfile() {
    const name=state.selected;if(!name)return;const button=document.querySelector('#saveDevelopment'),status=document.querySelector('#devSaveStatus'),growthScore=numeric(document.querySelector('#devGrowthScore').value);
    button.disabled=true;status.textContent='保存中…';
    try {
      const payload={name,account:document.querySelector('#devAccount').value,joinDate:document.querySelector('#devJoinDate').value,title:document.querySelector('#devTitle').value,currentResource:document.querySelector('#devResource').value,trainingStage:document.querySelector('#devStage').value,newcomer:document.querySelector('#devNewcomer').checked,abilityComment:document.querySelector('#devAbilityComment').value,courses:[...fieldsRoot.querySelectorAll('[data-course]:checked')].map(input=>input.dataset.course),growthRecord:growthScore==null?null:{score:growthScore,date:document.querySelector('#devGrowthDate').value,coursePeriod:document.querySelector('#devGrowthPeriod').value,comment:document.querySelector('#devGrowthComment').value}};
      const response=await devApi({method:'POST',body:JSON.stringify(payload)});state.profiles[name]=response.profile;syncProfiles();status.textContent=`已保存 · ${new Date(response.profile.updatedAt).toLocaleString('zh-CN')} · ${response.profile.updatedBy}`;renderList();renderMatrix();selectAnchor(name);
    } catch(error){status.textContent=error.message}
    finally{button.disabled=false}
  }

  function syncProfiles() {
    window.anchorDevelopmentProfiles=state.profiles;
    if(typeof renderAll==='function') renderAll();
    document.querySelectorAll('.card[data-name]').forEach(card => { const name=canonical(card.dataset.name),profile=state.profiles[name]; let line=card.querySelector('[data-latest-grade]'); if(!line){line=document.createElement('div');line.className='line';line.dataset.latestGrade='1';card.querySelector('.comment')?.before(line)} if(line)line.innerHTML=`<span>最新周期评级</span><b>${dEsc(profile?.latestGrade||'待评')}</b>`; });
  }
  async function loadDevelopment() {
    const payload=await devApi();state.profiles=payload.profiles||{};state.dimensions=payload.dimensions||state.dimensions;state.trainingStages=payload.trainingStages||[];state.courses=payload.courses||[];state.accounts=payload.accounts||[];state.loaded=true;syncProfiles();renderList();renderMatrix();
  }

  function evidenceMarkup(name) {
    const canonicalName=canonical(name),evidence=activeSnapshot?.evidenceByAnchor?.[canonicalName]||{},sources=activeSnapshot?.evidenceSources||{},evaluationItems=(evidence.evaluations||[]).slice(0,5),recordingItems=(evidence.recordings||[]).slice(0,6),sourceState=Object.values(sources).map(source=>`${source.name||'来源'}：${source.available?'已读取':'待授权/待回传'}`).join(' · '),profile=state.profiles[canonicalName],growth=growthRows(profile).at(-1);
    return `<section class="modal-card evidence-card"><h3>主播成长与能力</h3>${profile?`<p>最新综合评级 ${dEsc(profile.latestGrade||'待评')} · ${state.dimensions.map(item=>`${item} ${grade(profile.abilities?.[item])||'待评'}`).join(' · ')}</p><small>${dEsc(profile.abilityComment||'暂无评级评语')} · 课程 ${dEsc(profile.courseProgress||'0/8')}${growth?` · 成长 ${growth.score} 分`:''}</small>`:'<p>成长能力尚未在工作台录入。</p>'}<h3>近 5 日可验证评价</h3><div class="evidence-list">${evaluationItems.length?evaluationItems.map(item=>`<div class="evidence-item">${dEsc(item.text||'评价附件')}<small>${dEsc(item.source)} · ${formatChinaTime(item.createdAt)} ${item.appLink?`· <a href="${dEsc(item.appLink)}" target="_blank" rel="noopener">原消息 ↗</a>`:''}</small></div>`).join(''):'<div class="evidence-item">待授权群聊回传；不以旧评价补齐。</div>'}</div><h3>近 3 日录屏 / 录音</h3><div class="evidence-list">${recordingItems.length?recordingItems.map(item=>`<div class="evidence-item">${dEsc(item.text||'直播录屏')}<small>${dEsc(item.source)} · ${formatChinaTime(item.createdAt)} ${item.appLink?`· <a href="${dEsc(item.appLink)}" target="_blank" rel="noopener">原消息 ↗</a>`:''}</small></div>`).join(''):'<div class="evidence-item">当前窗口没有可验证附件，保持待回传。</div>'}</div><div class="source-boundary">${dEsc(sourceState||'群聊来源状态将在下一次生命周期刷新后显示。')}</div></section>`;
  }

  const originalOpenAnchor=openAnchor;
  openAnchor=function(name){originalOpenAnchor(name);const grid=document.querySelector('#detail .detail-grid');if(grid){grid.querySelector('aside.review')?.remove();const profile=PROFILE_BY_NAME.get(canonical(name));grid.insertAdjacentHTML('beforeend',evidenceMarkup(name));if(profile?.reviewDocumentUrl){const section=document.createElement('section');section.className='modal-card review';const heading=document.createElement('h3');heading.textContent='主播复盘文档';const link=document.createElement('a');link.href=profile.reviewDocumentUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='打开培养档案中的复盘原文';section.append(heading,link);grid.append(section)}}};
  document.querySelectorAll('[data-development-view]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-development-view]').forEach(item=>item.classList.toggle('active',item===button));const ratings=button.dataset.developmentView==='ratings';matrixRoot.hidden=!ratings;profileLayout.hidden=ratings});
  document.querySelector('#openDevelopment').onclick=()=>{devDialog.showModal();if(!state.loaded)loadDevelopment().catch(error=>{matrixRoot.innerHTML=`<div class="source-boundary">${dEsc(error.message)}</div>`})};
  document.querySelector('#closeDevelopment').onclick=()=>devDialog.close();
  document.querySelector('#createNewcomer').onclick=createNewcomer;
  devDialog.addEventListener('click',event=>{if(event.target===devDialog)devDialog.close()});
  search.oninput=renderList;
  loadDevelopment().catch(()=>{});
})();
