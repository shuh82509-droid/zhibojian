(() => {
  const stages = ['暖场与痛点', '卖点与背书', '机制与售后', '第一轮逼单', '第二轮承接', '使用方法与换角度', '循环收口'];
  const apiBase = location.pathname.split('/modules/')[0];
  const $ = selector => document.querySelector(selector);
  const product = $('#generatorProduct'), customProduct = $('#generatorCustomProduct');
  const sourceUrls = $('#generatorSourceUrls'), count = $('#generatorCount'), brief = $('#generatorBrief'), persona = $('#generatorPersona'), customPersona = $('#generatorCustomPersona');
  const broadcastMode = $('#generatorBroadcastMode'), platform = $('#generatorPlatform'), price = $('#generatorPrice'), mainQuantity = $('#generatorMainQuantity'), gifts = $('#generatorGifts');
  const stageRoot = $('#generatorStages'), editors = $('#generatorEditors'), fullScript = $('#generatorFullScript'), status = $('#generatorStatus'), sources = $('#generatorSources');
  const generateButton = $('#generateCommunication'), saveButton = $('#saveCommunicationDraft'), versionSelect = $('#generatorVersion'), complianceRoot = $('#generatorCompliance'), historyRoot = $('#generatorHistory'), productSource = $('#generatorProductSource');
  let config = null, current = null, activeIndex = 0, drafts = [];
  const gEsc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const dateTime = value => { const date = new Date(value || ''); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date); };

  function setStatus(message, error = false) { status.textContent = message; status.classList.toggle('error', error); }
  async function api(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, {credentials:'same-origin',cache:'no-store',...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'}:{}),...(options.headers||{})}});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || '沟通稿服务请求失败。');
    return payload;
  }
  function selectedProduct() { return customProduct.value.trim() || product.value; }
  function selectedPersona() { return customPersona.value.trim() || persona.value; }
  function selectedStages() { return [...stageRoot.querySelectorAll('input:checked')].map(input => input.value); }
  function renderStageSelectors() { stageRoot.innerHTML = `<legend>生成环节</legend>${stages.map(stage => `<label><input type="checkbox" value="${stage}" checked />${stage}</label>`).join('')}`; }
  function currentScripts() {
    if (!current) return [];
    if (!Array.isArray(current.scripts) || !current.scripts.length) current.scripts = [{index:1,fullScript:current.fullScript || '',compliance:current.compliance || null}];
    return current.scripts;
  }
  function syncActive() {
    if (!current) return;
    stages.forEach(stage => {
      const values = Array.isArray(current.stages?.[stage]) ? current.stages[stage] : [];
      while (values.length <= activeIndex) values.push('');
      values[activeIndex] = editors.querySelector(`[data-stage-editor="${stage}"]`)?.value.trim() || '';
      current.stages[stage] = values;
    });
    const scripts = currentScripts(); scripts[activeIndex].fullScript = fullScript.value; current.fullScript = scripts[0]?.fullScript || '';
  }
  function combine() {
    fullScript.value = stages.map(stage => { const value = editors.querySelector(`[data-stage-editor="${stage}"]`)?.value.trim(); return value ? `【${stage}】\n${value}` : ''; }).filter(Boolean).join('\n\n');
    if (current) syncActive();
  }
  function renderCompliance(item) {
    const value = item?.compliance;
    if (!value) { complianceRoot.textContent = '该草稿的合规结果待重新生成或复核。'; return; }
    const risks = value.risks?.length ? value.risks : ['未读到明确风险项'];
    const pending = value.pendingConfirmations?.length ? value.pendingConfirmations : ['发布前仍需业务人确认当日价格、数量和赠品'];
    complianceRoot.innerHTML = `<b>${gEsc(value.conclusion || '待复核')}</b><div><strong>风险项</strong>${risks.map(row=>`<span>${gEsc(row)}</span>`).join('')}</div><div><strong>发布前确认</strong>${pending.map(row=>`<span>${gEsc(row)}</span>`).join('')}</div>`;
  }
  function renderEditors(data = null, index = 0) {
    activeIndex = index;
    editors.innerHTML = stages.map(stage => {
      const value = data?.stages?.[stage]?.[index] || '';
      return `<article class="generator-editor"><header><h3>${stage}</h3><small>${value ? `第 ${index + 1} 篇` : '未选/待编辑'}</small></header><textarea rows="6" data-stage-editor="${stage}" placeholder="${stage}内容">${gEsc(value)}</textarea></article>`;
    }).join('');
    editors.querySelectorAll('textarea').forEach(area => area.addEventListener('input', combine));
    if (data) fullScript.value = currentScripts()[index]?.fullScript || ''; else combine();
    renderCompliance(currentScripts()[index]);
  }
  function renderVersions() {
    const scripts = currentScripts(); versionSelect.hidden = scripts.length < 2;
    versionSelect.innerHTML = scripts.map((_, index) => `<option value="${index}">第 ${index + 1} 篇</option>`).join('');
    versionSelect.value = String(Math.min(activeIndex, scripts.length - 1));
  }
  function renderSources(data) {
    const rows = data?.sources || [];
    sources.innerHTML = rows.length ? `已核验 ${rows.length} 个飞书来源：${rows.map(item=>`<a href="${gEsc(item.sourceUrl)}" target="_blank" rel="noopener">${gEsc(item.title || '来源原文')}</a>`).join(' · ')}${data.sourceCoverage?.failures?.length?`；${data.sourceCoverage.failures.length} 个来源读取失败`:''}` : '没有可核验来源';
  }
  function renderProductSource() {
    const item = config?.productCatalog?.find(row => row.name === product.value);
    productSource.textContent = item ? `WIS 产品资料库 · ${item.sources?.length || 0} 个可读文档${item.filing?` · 备案 ${item.filing}`:''}` : `产品资料库${config?.productCatalogStatus || '待核验'}`;
  }
  function openDraft(draft) {
    current = structuredClone(draft); activeIndex = 0; customProduct.value = ''; product.value = current.product;
    if (current.context) { persona.value = current.context.persona || persona.value; broadcastMode.value = current.context.broadcastMode || '单播'; platform.value = current.context.platform || '抖音'; price.value = current.context.mechanism?.price || ''; mainQuantity.value = current.context.mechanism?.mainQuantity || ''; gifts.value = current.context.mechanism?.gifts || ''; }
    renderVersions(); renderEditors(current,0); renderSources(current); saveButton.disabled = false; setStatus(`已打开 ${dateTime(current.updatedAt || current.generatedAt)} 的草稿`);
  }
  function renderHistory() {
    historyRoot.innerHTML = drafts.length ? drafts.map((draft,index)=>`<button type="button" data-draft-index="${index}"><b>${gEsc(draft.product)}</b><span>${gEsc(draft.context?.persona || '旧版人设待补充')} · ${dateTime(draft.updatedAt)}</span></button>`).join('') : '暂无已保存草稿。';
    historyRoot.querySelectorAll('[data-draft-index]').forEach(button => button.addEventListener('click',()=>openDraft(drafts[Number(button.dataset.draftIndex)])));
  }
  async function loadHistory() { const payload = await api('/api/script-generator/drafts'); drafts = payload.drafts || []; renderHistory(); }
  async function loadConfig() {
    if (config) return;
    const payload = await api('/api/script-generator/config'); config = payload;
    product.innerHTML = payload.products.map(name => `<option value="${gEsc(name)}">${gEsc(name)}</option>`).join('');
    persona.innerHTML = (payload.personas || ['专业顾问型']).map(name=>`<option>${gEsc(name)}</option>`).join('');
    renderProductSource();
    setStatus(payload.configured ? `模型 ${payload.model} 已就绪 · 产品库${payload.productCatalogStatus}` : '模型服务尚未配置，当前不可生成', !payload.configured);
    await loadHistory();
  }
  async function generate() {
    const pickedStages = selectedStages(), name = selectedProduct();
    if (!pickedStages.length) return setStatus('请至少选择一个生成环节。', true);
    if (!name) return setStatus('请选择或填写产品。', true);
    if (customProduct.value.trim() && !sourceUrls.value.trim()) return setStatus('新增产品必须提供可验证的飞书资料链接。', true);
    generateButton.disabled = true; saveButton.disabled = true; setStatus('正在读取产品原文、生成完整稿并做合规复核…');
    try {
      const payload = await api('/api/script-generator/generate',{method:'POST',body:JSON.stringify({product:name,persona:selectedPersona(),broadcastMode:broadcastMode.value,platform:platform.value,mechanism:{price:price.value.trim(),mainQuantity:mainQuantity.value.trim(),gifts:gifts.value.trim()},stages:pickedStages,count:Number(count.value),brief:brief.value.trim(),sourceUrls:sourceUrls.value.split(/\r?\n/u).map(item=>item.trim()).filter(Boolean)})});
      current = payload.data; activeIndex = 0; renderVersions(); renderEditors(current,0); renderSources(current); saveButton.disabled = false;
      setStatus(`已生成 ${current.scripts?.length || 1} 篇 · ${current.model} · ${current.sourceCoverage.available}/${current.sourceCoverage.requested} 个来源可用`);
    } catch (error) { setStatus(error.message,true); }
    finally { generateButton.disabled = false; }
  }
  async function save() {
    if (!current) return;
    syncActive(); saveButton.disabled = true; setStatus('正在保存草稿…');
    try {
      current.context = {persona:selectedPersona(),broadcastMode:broadcastMode.value,platform:platform.value,mechanism:{price:price.value.trim(),mainQuantity:mainQuantity.value.trim(),gifts:gifts.value.trim()}};
      const payload = await api('/api/script-generator/save',{method:'POST',body:JSON.stringify(current)}); current={...current,...payload.draft}; setStatus(`草稿已保存 · ${dateTime(payload.draft.updatedAt)} · ${payload.draft.updatedBy}`); await loadHistory();
    } catch (error) { setStatus(error.message,true); }
    finally { saveButton.disabled = false; }
  }

  renderStageSelectors(); renderEditors();
  loadConfig().catch(error=>setStatus(error.message,true));
  product.addEventListener('change',renderProductSource); versionSelect.addEventListener('change',()=>{syncActive();renderEditors(current,Number(versionSelect.value));});
  $('#combineCommunication').addEventListener('click',combine); generateButton.addEventListener('click',generate); saveButton.addEventListener('click',save);
})();
