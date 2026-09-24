(() => {
  const hubDispatchPath = window.location.pathname.match(/^(\/yxb\/wis-marketing-hub\/(?:live-flow-candidate-[a-z0-9-]+\/)?modules\/dispatch-center)(?:\/|$)/u)?.[1];
  const planningBase = window.location.protocol === 'file:' ? 'http://127.0.0.1:3100' : hubDispatchPath || (window.location.pathname.startsWith('/fd-027340/dispatch-center/') ? '/fd-027340/dispatch-center' : '');
  const roomRules = {
    guanqi: '高资源位优先匹配周排名，兼顾均衡；L 不接 J2/P/M，F 不接 P/M；每人每天只排一个资源位。',
    brand_selection: 'AC1、L、J2、WB 四档资源位按周排名分配，资源分和日均分可调整。',
    youxuan: '默认周四至周三；第 3 名排官旗 M 通宵，休息时顺延第 4 名；B3/M 次日不可接 R。',
    wangou: '默认周三至下周三；第 3 名排品牌精选 M，休息顺延第 4 名；常规班按资源分排序轮转，促销日需复核。',
  };
  const state = { rooms: {}, shiftTimes: {}, drafts: {}, makeupDrafts: {}, totalSchedule: null, planningBaseline: null, historyStatus: null, historyUnavailable: false, draftCapability: {enabled:false}, totalImportCapability: {enabled:false}, context: null, shiftOrder: [], currentDraft: null, importPlan: null, anchorRoster: [], assistantRoster: [], restData: null, selectedRestName: '', makeupData: null, makeupRoster: [], currentMakeupDraft: null, makeupImportPlan: null };
  const $ = (selector) => document.querySelector(selector);
  const dialog = $('#planningDialog'); const title = $('#planningTitle'); const ruleHint = $('#planningRuleHint'); const startInput = $('#planningStart'); const endInput = $('#planningEnd');
  const anchorRosterBlock = $('#planningAnchorRosterBlock'); const anchorRosterRows = $('#anchorRosterRows'); const assistantRosterEditor = $('#assistantRosterEditor'); const assistantRosterRows = $('#assistantRosterRows');
  const customShiftInput = $('#planningCustomShifts'); const shiftOrderRoot = $('#planningShiftOrder'); const scoresRoot = $('#planningScores'); const statusRoot = $('#planningStatus'); const summaryRoot = $('#planningSummary');
  const gridRoot = $('#planningGrid'); const previewRoot = $('#planningImportPreview'); const generateButton = $('#generatePlanningDraft'); const saveButton = $('#savePlanningDraft'); const previewButton = $('#previewPlanningImport');
  const pEsc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const pDateKey = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  const weekday = (date) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(new Date(`${date}T12:00:00+08:00`));
  const setStatus = (message, error = false) => { statusRoot.textContent = message || ''; statusRoot.classList.toggle('error', error); };
  const baselineStatus = document.createElement('p'); baselineStatus.id = 'planningBaselineStatus'; baselineStatus.className = 'planning-status'; baselineStatus.setAttribute('role', 'status'); $('#planningRoomGrid').before(baselineStatus);
  function showBaselineStatus() {
    if (state.historyStatus !== 'pending_recovery') { baselineStatus.textContent = ''; return; }
    const b = state.planningBaseline;
    baselineStatus.textContent = `${b ? `正式排班新基线锚点：${b.spreadsheetToken} / ${b.sheetId} · 建立时版本 ${b.revision} · 核验 ${b.checkedAt}。` : '正式排班新基线待核验。'}${state.totalSchedule?.revision ? `当前原表只读版本 ${state.totalSchedule.revision} · 读取 ${state.totalSchedule.readAt}。` : ''}旧草稿、休息配置与写回审计仍待恢复，不能据此认定旧历史为空。${state.historyUnavailable ? '当前仅可查看来源，保存与写回已暂停。' : `${state.draftCapability.enabled ? '新基线后的草稿可保存。' : '新基线草稿保存仍未启用。'}${state.totalImportCapability.enabled ? '正式总表导入可在核对预览后确认。' : '正式总表导入仍处于只读验收。'}化妆师表及原直播间表尚无独立新基线，不能写回。`}`;
    baselineStatus.classList.add('error');
  }
  function disableRecoveryActions() {
    if (!state.historyUnavailable) return;
    for (const selector of ['[data-planning-room]','#loadPriorPlanning','#generatePlanningDraft','#savePlanningDraft','#previewPlanningImport','#commitPlanningImport','#saveRestEntitlement','#restEntitlement','[data-rest-room]','[data-rest-note]','[data-save-rest]','#addMakeupArtist','#generateMakeupDraft','#saveMakeupDraft','#previewMakeupImport','#commitMakeupImport']) {
      document.querySelectorAll(selector).forEach(element => { element.disabled = true; element.title = '旧历史待恢复，当前只读'; });
    }
  }
  function applyPlanningCapabilities() {
    if (state.historyUnavailable) { disableRecoveryActions(); return; }
    for (const selector of ['#saveRestEntitlement','#restEntitlement','[data-rest-room]','[data-rest-note]','[data-save-rest]']) {
      document.querySelectorAll(selector).forEach(element => { element.disabled = !state.draftCapability.enabled; if (element.disabled) element.title = '新基线草稿保存尚未启用'; });
    }
    saveButton.disabled = !state.draftCapability.enabled || !state.currentDraft;
    $('#saveMakeupDraft').disabled = !state.draftCapability.enabled || !state.currentMakeupDraft;
    document.querySelectorAll('#commitPlanningImport').forEach(element => { if (!state.totalImportCapability.enabled) { element.disabled = true; element.title = state.totalImportCapability.message || '正式总表导入仍处于只读验收'; } });
    const makeupCommit = $('#commitMakeupImport'); makeupCommit.disabled = true; makeupCommit.title = '化妆师源表尚无独立核验的新基线';
  }

  async function requestPlanning(path, options = {}) {
    const response = await fetch(`${planningBase}${path}`, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } : {}), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) { const error = new Error(payload.error || '排班工作台请求失败。'); error.payload = payload; throw error; }
    return payload;
  }

  function defaultRange(roomCode, role) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (role === 'anchor' && (roomCode === 'youxuan' || roomCode === 'wangou')) {
      const targetWeekday = roomCode === 'youxuan' ? 4 : 3; let distance = (targetWeekday - now.getDay() + 7) % 7; if (!distance) distance = 7;
      const start = addDays(now, distance); return [pDateKey(start), pDateKey(addDays(start, roomCode === 'wangou' ? 7 : 6))];
    }
    const start = new Date(now.getFullYear(), now.getMonth() + 1, 1); const end = new Date(now.getFullYear(), now.getMonth() + 2, 0); return [pDateKey(start), pDateKey(end)];
  }

  function currentScheduleDate() { try { return pDateKey(typeof currentDate !== 'undefined' ? currentDate : new Date()); } catch { return pDateKey(new Date()); } }
  function verifiedDefaultAnchorName(shift) {
    const name = String(shift?.[2] ?? '').trim();
    // The display timeline may retain an unresolved co-broadcast label for
    // human review. It is not a person's identity or a default draft row.
    return /^[\p{Script=Han}·]{2,12}$/u.test(name) && !/主播|助理|时间|待定|待排|未知|暂无|停播|取消/u.test(name) && name !== '曹总' ? name : '';
  }
  function anchorsFromCurrentSchedule(roomCode) {
    try {
      const daily = typeof scheduleData === 'object' ? scheduleData[currentScheduleDate()] || [] : [];
      const room = daily.find((item) => item.code === roomCode || item.roomCode === roomCode || ({ guanqi: '官旗', brand_selection: '品牌精选', youxuan: '优选', wangou: '王鸥美肤' }[roomCode] === item.name));
      return [...new Set((room?.anchors || []).map(verifiedDefaultAnchorName).filter(Boolean))];
    } catch { return []; }
  }

  function matchingSavedDraft(roomCode, role) {
    return Object.values(state.drafts || {}).filter((draft) => draft.roomCode === roomCode && draft.role === role).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
  }

  function renderDraftMeta() {
    Object.keys(state.rooms).forEach((roomCode) => {
      const count = Object.values(state.drafts).filter((draft) => draft.roomCode === roomCode && draft.role === 'anchor').length; const root = document.querySelector(`[data-draft-count="${roomCode}"]`);
      if (root) root.textContent = state.historyUnavailable ? '旧历史草稿待恢复' : state.historyStatus === 'pending_recovery' ? (count ? `新基线后已保存 ${count} 个主播范围 · 旧历史待恢复` : '旧历史草稿待恢复；新基线后尚无草稿') : count ? `已保存 ${count} 个主播范围` : '暂无主播草稿';
    });
  }

  function restDateFieldMarkup(person) {
    const dates = [...new Set(person.restDates || [])].sort(); const remaining = Math.max(0, (Number(person.entitlement) || 0) - dates.length); const month = dates[0]?.slice(0,7) || $('#makeupMonth')?.value || startInput?.value?.slice(0,7) || currentScheduleDate().slice(0,7); const [year,monthNumber]=month.split('-').map(Number); const days=new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
    const dayGrid=Array.from({length:days},(_,index)=>{const date=`${month}-${String(index+1).padStart(2,'0')}`;return `<button class="${dates.includes(date)?'selected':''}" data-pick-rest-date="${date}" type="button">${index+1}</button>`}).join('');
    return `<label class="rest-date-field">休息日期<small>可一次多选 · 剩余 <b data-rest-remaining>${remaining}</b> 天</small><details class="rest-date-calendar"><summary>批量选择 ${pEsc(month)}</summary><span class="rest-day-grid">${dayGrid}</span></details><span class="rest-date-chips" data-rest-values>${dates.length ? dates.map((date) => `<button data-remove-rest-date="${pEsc(date)}" type="button">${pEsc(date.slice(5))} ×</button>`).join('') : '<em>尚未选择</em>'}</span><input data-roster-rest type="hidden" value="${pEsc(dates.join(','))}"></label>`;
  }
  function rosterRowMarkup(person, index, role) {
    const poolControl = role === 'anchor' ? `<label class="roster-pool"><input data-roster-pool type="checkbox" ${person.poolSelected === false ? '' : 'checked'}>本周期参与</label>` : '';
    return `<div class="assistant-roster-row structured-roster-row" data-${role}-row="${index}"><label>姓名<input data-roster-name maxlength="40" value="${pEsc(person.name || '')}"></label>${role === 'anchor' ? `<label>周排名<input data-roster-rank type="number" min="1" max="7" value="${Number(person.rank) || index + 1}"></label>` : ''}<label>月应休<input data-roster-entitlement type="number" min="0" max="31" value="${Number(person.entitlement) || 0}"></label>${restDateFieldMarkup(person)}${poolControl}<button data-remove-roster type="button">删除</button></div>`;
  }
  function renderAnchorRoster() { anchorRosterRows.innerHTML = state.anchorRoster.map((person, index) => rosterRowMarkup(person, index, 'anchor')).join(''); }
  function readAnchorRoster() {
    state.anchorRoster = [...anchorRosterRows.querySelectorAll('[data-anchor-row]')].map((row, index) => ({ name: row.querySelector('[data-roster-name]').value.trim(), rank: Math.max(1, Math.min(7, Number(row.querySelector('[data-roster-rank]').value) || index + 1)), entitlement: Math.max(0, Number(row.querySelector('[data-roster-entitlement]').value) || 0), restDates: row.querySelector('[data-roster-rest]').value.split(/[,，、\s]+/u).filter(Boolean), poolSelected: row.querySelector('[data-roster-pool]')?.checked !== false })).filter((person) => person.name);
    return state.anchorRoster;
  }

  function renderAssistantRoster() {
    assistantRosterRows.innerHTML = state.assistantRoster.map((person, index) => rosterRowMarkup(person, index, 'assistant')).join('');
  }
  function readAssistantRoster() {
    state.assistantRoster = [...assistantRosterRows.querySelectorAll('[data-assistant-row]')].map((row, index) => ({ name: row.querySelector('[data-roster-name]').value.trim(), rank: index + 1, entitlement: Math.max(0, Number(row.querySelector('[data-roster-entitlement]').value) || 0), restDates: row.querySelector('[data-roster-rest]').value.split(/[,，、\s]+/u).filter(Boolean) })).filter((person) => person.name);
    return state.assistantRoster;
  }
  function syncRestDateField(row) { const hidden = row.querySelector('[data-roster-rest]'); if (!hidden) return; const dates = [...new Set(hidden.value.split(',').filter(Boolean))].sort(); hidden.value = dates.join(','); const entitlement = Number(row.querySelector('[data-roster-entitlement]')?.value || dates.length); row.querySelector('[data-rest-remaining]').textContent = Math.max(0, entitlement - dates.length); row.querySelector('[data-rest-values]').innerHTML = dates.length ? dates.map((date) => `<button data-remove-rest-date="${pEsc(date)}" type="button">${pEsc(date.slice(5))} ×</button>`).join('') : '<em>尚未选择</em>'; row.querySelectorAll('[data-pick-rest-date]').forEach(button=>button.classList.toggle('selected',dates.includes(button.dataset.pickRestDate))); }
  function handleRestDateClick(event) { const row = event.target.closest('[data-anchor-row],[data-assistant-row],[data-makeup-row]'); if (!row) return false; const pick = event.target.closest('[data-pick-rest-date]'), remove = event.target.closest('[data-remove-rest-date]'); if (!pick && !remove) return false; const hidden = row.querySelector('[data-roster-rest]'), dates = new Set(hidden.value.split(',').filter(Boolean)); if (pick) { if(dates.has(pick.dataset.pickRestDate))dates.delete(pick.dataset.pickRestDate);else dates.add(pick.dataset.pickRestDate); } if (remove) dates.delete(remove.dataset.removeRestDate); hidden.value = [...dates].sort().join(','); syncRestDateField(row); return true; }
  function removeRosterRow(event, role) { const button = event.target.closest('[data-remove-roster]'); if (!button) return; const root = button.closest(`[data-${role}-row]`); if (role === 'anchor') { readAnchorRoster(); state.anchorRoster.splice(Number(root.dataset.anchorRow), 1); renderAnchorRoster(); } else { readAssistantRoster(); state.assistantRoster.splice(Number(root.dataset.assistantRow), 1); renderAssistantRoster(); } }
  anchorRosterRows.addEventListener('click', (event) => { if (!handleRestDateClick(event)) removeRosterRow(event, 'anchor'); });
  assistantRosterRows.addEventListener('click', (event) => { if (!handleRestDateClick(event)) removeRosterRow(event, 'assistant'); });
  anchorRosterRows.addEventListener('input', (event) => { if (event.target.matches('[data-roster-entitlement]')) syncRestDateField(event.target.closest('[data-anchor-row]')); });
  assistantRosterRows.addEventListener('input', (event) => { if (event.target.matches('[data-roster-entitlement]')) syncRestDateField(event.target.closest('[data-assistant-row]')); });
  $('#addAnchorRoster').addEventListener('click', () => { readAnchorRoster(); state.anchorRoster.push({ name: '', rank: Math.min(7, state.anchorRoster.length + 1), entitlement: Number(state.restData?.entitlement)||0, restDates: [], poolSelected: true }); renderAnchorRoster(); anchorRosterRows.querySelector('[data-anchor-row]:last-child [data-roster-name]')?.focus(); });
  $('#addAssistantRoster').addEventListener('click', () => { readAssistantRoster(); state.assistantRoster.push({ name: '', rank: state.assistantRoster.length + 1, entitlement: Number(state.restData?.entitlement)||0, restDates: [] }); renderAssistantRoster(); assistantRosterRows.querySelector('[data-assistant-row]:last-child [data-roster-name]')?.focus(); });

  function parseCustomShiftTimes() {
    const result = {};
    customShiftInput.value.split(/[,，\n]+/u).forEach((entry) => { const [rawCode, rawTime] = entry.split('@').map((item) => item?.trim()); const time = String(rawTime || '').replace('-', '–'); if (/^[A-Za-z0-9\u4e00-\u9fff]{1,12}$/u.test(rawCode || '') && /^\d{2}:\d{2}–(?:次日)?\d{2}:\d{2}$/u.test(time)) result[rawCode] = time; });
    return result;
  }
  function shiftTime(code) { return parseCustomShiftTimes()[code] || state.currentDraft?.customShiftTimes?.[code] || state.shiftTimes[code] || (code === '休' ? '休息' : '时间待配置'); }
  function renderShiftOrder() {
    shiftOrderRoot.innerHTML = state.shiftOrder.map((shift) => `<span class="planning-shift" draggable="true" data-shift="${pEsc(shift)}"><b>${pEsc(shift)}</b><input data-shift-time aria-label="${pEsc(shift)} 班次时间" value="${pEsc(shiftTime(shift))}"><button type="button" data-remove-shift aria-label="删除 ${pEsc(shift)} 班次">删除</button></span>`).join('');
    let dragged = '';
    shiftOrderRoot.querySelectorAll('.planning-shift').forEach((chip) => {
      chip.querySelector('[data-shift-time]')?.addEventListener('change',event=>{const value=event.target.value.replace('-','–');if(!/^\d{2}:\d{2}–(?:次日)?\d{2}:\d{2}$/u.test(value)){setStatus('班次时间格式应为 09:00-18:00 或 18:00-次日02:00',true);return}const times={...parseCustomShiftTimes(),[chip.dataset.shift]:value};customShiftInput.value=Object.entries(times).map(([code,time])=>code+'@'+time).join(',');if(state.currentDraft){state.currentDraft.customShiftTimes=times;state.currentDraft.assignments.forEach(item=>{if(item.shiftCode===chip.dataset.shift)item.shiftTime=value});renderGrid()}setStatus('班次时间已修改，请保存草稿。')});
      chip.querySelector('[data-remove-shift]')?.addEventListener('click',()=>{const code=chip.dataset.shift;if(state.currentDraft?.assignments?.some(item=>item.shiftCode===code)){setStatus('该班次已用于草稿，请先调整对应日期的班次后再删除。',true);return}state.shiftOrder=state.shiftOrder.filter(item=>item!==code);const times=parseCustomShiftTimes();delete times[code];customShiftInput.value=Object.entries(times).map(([key,time])=>key+'@'+time).join(',');if(state.currentDraft){state.currentDraft.shifts=[...state.shiftOrder];state.currentDraft.customShiftTimes=times}renderShiftOrder();renderScores()});
      chip.addEventListener('dragstart', () => { dragged = chip.dataset.shift; chip.classList.add('dragging'); }); chip.addEventListener('dragend', () => chip.classList.remove('dragging')); chip.addEventListener('dragover', (event) => event.preventDefault());
      chip.addEventListener('drop', (event) => { event.preventDefault(); const target = chip.dataset.shift; if (!dragged || dragged === target) return; const next = state.shiftOrder.filter((item) => item !== dragged); next.splice(next.indexOf(target), 0, dragged); state.shiftOrder = next; renderShiftOrder(); renderScores(); });
    });
  }
  function renderScores() {
    if (state.context?.role !== 'anchor') { scoresRoot.innerHTML = '<header><b>助理班次时间</b><small>固定班次与自定义班次均会写入草稿</small></header><div>' + state.shiftOrder.map((shift) => `<span class="planning-shift"><b>${pEsc(shift)}</b><small>${pEsc(shiftTime(shift))}</small></span>`).join('') + '</div>'; return; }
    scoresRoot.innerHTML = '<header><b>主播资源位分值</b><small>用于计算每日平均资源分</small></header><div>' + state.shiftOrder.map((shift, index) => `<label class="planning-score">${pEsc(shift)} 分值<input type="number" min="0" step="0.1" data-score-shift="${pEsc(shift)}" value="${state.currentDraft?.resourceScores?.[shift] ?? Math.max(1, state.shiftOrder.length - index)}"></label>`).join('') + '</div>';
  }
  customShiftInput.addEventListener('change', () => { const custom = Object.keys(parseCustomShiftTimes()); state.shiftOrder = [...new Set([...state.shiftOrder, ...custom])]; renderShiftOrder(); renderScores(); });

  function assignmentFor(date, name) { return state.currentDraft?.assignments?.find((item) => item.date === date && item.name === name); }
  function optionMarkup(value) { return ['', ...state.shiftOrder, '休'].map((code) => `<option value="${pEsc(code)}" ${code === value ? 'selected' : ''}>${code ? `${pEsc(code)} · ${pEsc(shiftTime(code))}` : '未排班'}</option>`).join(''); }
  function updateAssignment(select) {
    if (!state.currentDraft) return; const { date, name } = select.dataset; const value = select.value;
    state.currentDraft.assignments = state.currentDraft.assignments.filter((item) => !(item.date === date && item.name === name));
    if (value) state.currentDraft.assignments.push({ date, name, shiftCode: value, rest: value === '休', score: value === '休' ? 0 : Number(state.currentDraft.resourceScores?.[value] || 0), shiftTime: shiftTime(value) });
    select.dataset.code=value;computeClientSummaries(); renderSummary(); saveButton.disabled = false; previewButton.disabled = false;
  }
  gridRoot.addEventListener('change', (event) => { const select = event.target.closest('[data-grid-shift]'); if (select) updateAssignment(select); });

  function computeClientSummaries() {
    const draft = state.currentDraft; if (!draft) return;
    draft.attendance = draft.roster.map((person) => { const rows = draft.assignments.filter((item) => item.name === person.name); const shifts = rows.filter((item) => !item.rest).map((item) => item.shiftCode); return { name: person.name, entitlement: person.entitlement || 0, usedRest: rows.filter((item) => item.rest).length, remainingRest: Math.max(0, (person.entitlement || 0) - rows.filter((item) => item.rest).length), opening: shifts.filter((code) => code === 'L').length, closing: shifts.filter((code) => ['P', 'WB'].includes(code)).length, overnight: shifts.filter((code) => ['M', 'ZBB'].includes(code)).length }; });
    draft.resourceAverages = draft.dates.map((date) => { const rows = draft.assignments.filter((item) => item.date === date && !item.rest && Number.isFinite(Number(item.score))); return { date, positions: rows.length, average: rows.length ? Number((rows.reduce((sum, item) => sum + Number(item.score), 0) / rows.length).toFixed(2)) : null }; });
    draft.anchorResourceSummary = draft.roster.filter((person) => person.poolSelected !== false).map((person) => { const rows = draft.assignments.filter((item) => item.name === person.name && !item.rest); const totalResourceScore = Number(rows.reduce((sum, item) => sum + (Number(item.score) || 0), 0).toFixed(2)); const actualWorkDays = new Set(rows.map((item) => item.date)).size; return { name: person.name, rank: person.rank, totalResourceScore, actualWorkDays, averageResourceScore: actualWorkDays ? Number((totalResourceScore / actualWorkDays).toFixed(2)) : null }; }).sort((a, b) => a.rank - b.rank);
  }
  function renderSummary() {
    const draft = state.currentDraft; if (!draft) { summaryRoot.hidden = true; return; } summaryRoot.hidden = false;
    if (draft.role === 'assistant') summaryRoot.innerHTML = `<h3>助理班次统计</h3><p class="summary-formula">开播=L；关播=P+WB；通宵=M+ZBB。</p><div class="assistant-stat-grid">${(draft.attendance || []).map((item) => `<article><b>${pEsc(item.name)}</b><span>月休 ${item.usedRest}/${item.entitlement}</span><span>剩余 ${item.remainingRest}</span><span>开播 ${item.opening}</span><span>关播 ${item.closing}</span><span>通宵 ${item.overnight}</span></article>`).join('')}</div>`;
    else summaryRoot.innerHTML = `<h3>主播周期资源汇总</h3><div class="assistant-stat-grid anchor-resource-grid">${(draft.anchorResourceSummary || []).map((item) => `<article><b>${pEsc(item.name)} · 第 ${item.rank} 名</b><span>周期资源总分 ${item.totalResourceScore}</span><span>实际工作 ${item.actualWorkDays} 天</span><strong>日均 ${item.averageResourceScore ?? '—'}</strong></article>`).join('')}</div>`;
  }
  function renderGrid() {
    const draft = state.currentDraft; if (!draft) { gridRoot.innerHTML = ''; renderSummary(); return; }
    if (draft.role === 'assistant') {
      gridRoot.innerHTML = `<table class="planning-grid assistant-grid"><thead><tr><th>助理</th>${draft.dates.map((date) => `<th>${pEsc(date.slice(5))}<small>${pEsc(weekday(date))}</small></th>`).join('')}</tr></thead><tbody>${draft.roster.map((person) => `<tr><th>${pEsc(person.name)}<small>剩余休 ${draft.attendance?.find((item) => item.name === person.name)?.remainingRest ?? '—'}</small></th>${draft.dates.map((date) => { const assignment = assignmentFor(date, person.name); return `<td><select data-grid-shift data-date="${date}" data-name="${pEsc(person.name)}" aria-label="${pEsc(date)} ${pEsc(person.name)} 班次">${optionMarkup(assignment?.shiftCode || '')}</select></td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    } else {
      gridRoot.innerHTML = `<table class="planning-grid"><thead><tr><th>主播</th>${draft.dates.map((date) => `<th class="${draft.eventDates?.includes(date) ? 'event-date' : ''}">${pEsc(date.slice(5))}<small>${pEsc(weekday(date))}${draft.eventDates?.includes(date) ? ' · 活动' : ''}</small></th>`).join('')}</tr></thead><tbody>${draft.roster.filter((person) => person.poolSelected !== false).map((person) => `<tr><th>${pEsc(person.name)}<small>排名 ${person.rank} · 剩余休 ${draft.attendance?.find((item) => item.name === person.name)?.remainingRest ?? '—'}</small></th>${draft.dates.map((date) => { const assignment = assignmentFor(date, person.name); return `<td class="${draft.eventDates?.includes(date) ? 'event-date' : ''}"><select data-grid-shift data-date="${date}" data-name="${pEsc(person.name)}" aria-label="${pEsc(date)} ${pEsc(person.name)} 班次">${optionMarkup(assignment?.shiftCode || '')}</select></td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    }
    gridRoot.querySelectorAll('[data-grid-shift]').forEach(select=>{select.dataset.code=select.value;const assignment=assignmentFor(select.dataset.date,select.dataset.name);if(assignment?.linkedOvernight){select.title='通宵支援 '+({guanqi:'官旗',brand_selection:'品牌精选'}[assignment.targetRoomCode]||'配对直播间')}});
    renderSummary();
  }

  function openPlanning(roomCode, role) {
    const room = state.rooms[roomCode]; if (!room) return;
    const saved = matchingSavedDraft(roomCode, role); const range = saved ? [saved.startDate, saved.endDate] : defaultRange(roomCode, role); state.context = { roomCode, role }; state.currentDraft = saved ? structuredClone(saved) : null; state.importPlan = null;
    title.textContent = role === 'assistant' ? `${room.name} · 助理预排` : `${room.name} · 主播预排`; ruleHint.textContent = role === 'assistant' ? '助理名单按直播间独立保存；人员为行、日期为列，只维护班次与休息日。' : roomRules[roomCode]; $('#planningShiftHeading').textContent = role === 'assistant' ? '助理班次顺序' : '主播资源位顺序'; startInput.value = range[0]; endInput.value = range[1];
    anchorRosterBlock.hidden = role === 'assistant'; assistantRosterEditor.hidden = role !== 'assistant';
    $('#planningEventDatesBlock').hidden = !(role === 'anchor' && roomCode === 'wangou'); $('#planningEventDates').value = (saved?.eventDates || []).join(',');
    if (role === 'assistant') { $('#assistantRosterTitle').textContent = `${room.name}助理名单`; state.assistantRoster = structuredClone(saved?.roster || room.assistants.map((name, index) => ({ name, rank: index + 1, entitlement: Number(state.restData?.entitlement)||0, restDates: [] }))); renderAssistantRoster(); }
    else { state.anchorRoster = structuredClone(saved?.roster || anchorsFromCurrentSchedule(roomCode).map((name, index) => ({ name, rank: index + 1, entitlement: Number(state.restData?.entitlement)||0, restDates: [], poolSelected: true }))); renderAnchorRoster(); }
    state.shiftOrder = [...(saved?.shifts || (role === 'assistant' ? room.assistantShifts : room.anchorShifts))]; customShiftInput.value = Object.entries(saved?.customShiftTimes || {}).map(([code, time]) => `${code}@${time}`).join(',');
    renderShiftOrder(); renderScores(); previewRoot.hidden = true; saveButton.disabled = !saved; previewButton.disabled = !saved; renderGrid(); setStatus(saved ? `已载入 ${new Date(saved.updatedAt).toLocaleString('zh-CN')} 保存的 ${saved.startDate} — ${saved.endDate} 草稿。` : '配置日期与人员后生成草稿。'); dialog.showModal();
  }


  const syncRestButton=document.createElement('button');syncRestButton.type='button';syncRestButton.id='syncPlanningRest';syncRestButton.textContent='同步休息日（保留其他班次）';generateButton.before(syncRestButton);
  syncRestButton.onclick=async()=>{
    if(!state.currentDraft){setStatus('请先生成或载入草稿，再同步修改的休息日。',true);return}
    syncRestButton.disabled=true;
    try{const roster=state.context.role==='assistant'?readAssistantRoster():readAnchorRoster();const payload=await requestPlanning('/api/planning/sync-rest',{method:'POST',body:JSON.stringify({draft:state.currentDraft,roster})});state.currentDraft=payload.draft;renderGrid();setStatus('已同步 '+payload.changes.length+' 处休息日变化，其余班次保持不变；请核对并保存草稿。');saveButton.disabled=false;previewButton.disabled=false}catch(error){setStatus(error.message,true)}finally{syncRestButton.disabled=false}
  };

  async function generateDraft() {
    try {
      const role = state.context.role; const resourceScores = Object.fromEntries([...scoresRoot.querySelectorAll('[data-score-shift]')].map((input) => [input.dataset.scoreShift, Number(input.value)])); const customShiftTimes = parseCustomShiftTimes();
      const eventDates = $('#planningEventDates').value.split(/[,，、\s]+/u).filter(Boolean); const input = { roomCode: state.context.roomCode, role, startDate: startInput.value, endDate: endInput.value, roster: role === 'assistant' ? readAssistantRoster() : readAnchorRoster(), shifts: state.shiftOrder, customShiftTimes, resourceScores, eventDates };
      setStatus('正在生成排班草稿…'); const payload = await requestPlanning('/api/planning/generate', { method: 'POST', body: JSON.stringify(input) }); state.currentDraft = payload.draft; state.shiftOrder = [...payload.draft.shifts]; renderShiftOrder(); renderScores(); renderGrid(); saveButton.disabled = !state.draftCapability.enabled; previewButton.disabled = false; setStatus(`已生成 ${payload.draft.dates.length} 天、${payload.draft.assignments.length} 条排班；${payload.draft.warnings.length ? `有 ${payload.draft.warnings.length} 条待人工复核。` : '未发现重复排人。'}`);
    } catch (error) { setStatus(error.message, true); }
  }

  function loadPriorPlanning() {
    if (!state.context) return;
    const drafts = Object.values(state.drafts || {}).filter((draft) => draft.roomCode === state.context.roomCode && draft.role === state.context.role && draft.assignments?.length).sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)));
    const prior = drafts.find((draft) => draft.key !== state.currentDraft?.key) || drafts[0]; if (!prior) { setStatus('没有可导入的上期草稿。', true); return; }
    const dates = []; const start = new Date(`${startInput.value}T12:00:00+08:00`); const end = new Date(`${endInput.value}T12:00:00+08:00`); for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) dates.push(pDateKey(cursor));
    const priorByOffset = new Map(prior.dates.map((date, index) => [date, index])); const mapped = prior.assignments.map((item) => { const offset = priorByOffset.get(item.date); const date = dates[offset]; return date ? { ...item, date } : null; }).filter(Boolean);
    state.currentDraft = { ...structuredClone(prior), key: undefined, startDate: dates[0], endDate: dates.at(-1), dates, assignments: mapped, eventDates: [], updatedAt: new Date().toISOString() }; state.shiftOrder = [...prior.shifts];
    if (state.context.role === 'anchor') { state.anchorRoster = structuredClone(prior.roster); renderAnchorRoster(); } else { state.assistantRoster = structuredClone(prior.roster); renderAssistantRoster(); }
    computeClientSummaries(); renderShiftOrder(); renderScores(); renderGrid(); saveButton.disabled = !state.draftCapability.enabled; previewButton.disabled = false; setStatus(`已将上期 ${prior.startDate} — ${prior.endDate} 按日期顺序映射到当前范围，请复核后保存。`);
  }
  async function saveDraft() {
    try { if(state.currentDraft){state.currentDraft.shifts=[...state.shiftOrder];state.currentDraft.customShiftTimes=parseCustomShiftTimes()}setStatus('正在保存草稿…'); const payload = await requestPlanning('/api/planning/draft', { method: 'POST', body: JSON.stringify(state.currentDraft) }); state.currentDraft = payload.draft; state.drafts=payload.drafts||{...state.drafts,[payload.draft.key]:payload.draft}; renderDraftMeta(); renderSummary(); setStatus(`草稿已保存：${payload.draft.startDate} — ${payload.draft.endDate}。${payload.linkedKeys?.length?'已同步配对直播间通宵，其他班次保持不变。':['youxuan','wangou'].includes(payload.draft.roomCode)&&payload.draft.role==='anchor'?'配对直播间尚无覆盖该周期的草稿，通宵联动待建立配对草稿后保存。':''}`); }
    catch (error) { setStatus(error.message, true); }
  }
  async function previewImport() {
    try { setStatus('正在核对总表姓名、日期列与现有单元格…'); const payload = await requestPlanning('/api/planning/import/preview', { method: 'POST', body: JSON.stringify({ draft: state.currentDraft }) }); const plan = payload.plan; state.importPlan = plan; const blocked = plan.unresolved.length > 0;
      previewRoot.hidden = false; previewRoot.innerHTML = `<h3>导入预览 · ${pEsc(plan.target.label)}</h3><p>${pEsc(plan.role === 'anchor' ? '主播' : '助理')} · 已匹配 ${plan.resolvedCount}/${plan.assignmentCount} 条，写入 ${plan.ranges.length} 个精确范围；已有值冲突 ${plan.overwrites.length} 处。</p><p><a href="${pEsc(state.totalSchedule?.url || 'https://jqx28l0j4lx.feishu.cn/wiki/UKVDwxpz7iKAv8k5KxTcxiDVnuf')}" target="_blank" rel="noopener noreferrer">打开排班总表核查 ↗</a></p>${plan.unresolved.length ? `<ul>${plan.unresolved.map((item) => `<li>${pEsc(item.date)} · ${pEsc(item.name)}：${pEsc(item.reason)}</li>`).join('')}</ul>` : '<p>姓名和日期列均已匹配，可进入确认导入。</p>'}<details><summary>查看全部 ${plan.ranges.length} 个写入范围及修改前后值</summary><table><thead><tr><th>单元格</th><th>原值</th><th>将写入</th></tr></thead><tbody>${plan.ranges.map((item) => `<tr><td>${pEsc(item.range)}</td><td>${pEsc(item.before.join(' / ') || '空白')}</td><td>${pEsc(item.after.join(' / '))}</td></tr>`).join('')}</tbody></table></details>${plan.overwrites.length ? '<label class="planning-import-confirm"><input id="planningAllowOverwrite" type="checkbox">我已核对并同意覆盖预览中的已有排班</label>' : ''}<button id="commitPlanningImport" type="button" ${blocked ? 'disabled' : ''}>确认导入并回读</button>`;
      $('#commitPlanningImport')?.addEventListener('click', commitImport); applyPlanningCapabilities(); setStatus(blocked ? '仍有未匹配人员或日期，已阻断导入。' : state.totalImportCapability.enabled ? '预览完成；请核对后确认导入。' : (state.totalImportCapability.message || '正式总表导入仍处于只读验收。'), blocked || !state.totalImportCapability.enabled);
    } catch (error) { setStatus(error.message, true); }
  }
  async function commitImport() {
    if (!state.importPlan) return; const allowOverwrite = Boolean($('#planningAllowOverwrite')?.checked); if (state.importPlan.overwrites.length && !allowOverwrite) { setStatus('目标日期已有值，请勾选覆盖确认。', true); return; }
    try { setStatus('正在核对精确单元格并读取结果…'); const payload = await requestPlanning('/api/planning/import', { method: 'POST', body: JSON.stringify({ draft: state.currentDraft, confirm: true, expectedHash: state.importPlan.expectedHash, allowOverwrite }) }); setStatus(payload.noChange ? `原表已为目标值，本次未写入；来源已重新读取，审计编号 ${payload.auditId}。` : `导入完成并通过回读；审计编号 ${payload.auditId}。`); previewRoot.innerHTML += `<p>${payload.noChange ? '本次未写入，正式来源已核对一致。' : `已回读 ${payload.readbacks.length} 个写入范围，结果一致。`}<a href="${pEsc(state.totalSchedule?.url || 'https://jqx28l0j4lx.feishu.cn/wiki/UKVDwxpz7iKAv8k5KxTcxiDVnuf')}" target="_blank" rel="noopener noreferrer">立即打开排班总表复核 ↗</a></p>`; }
    catch (error) { setStatus(error.message, true); }
  }

  function renderRestCalendar(person) {
    const root = $('#restCalendar'); if (!person || person.sourceStatus !== 'matched' || !person.calendar?.length) { root.innerHTML = '<header><div><h4>主播月历</h4><span>点击已匹配主播查看工作、休息与未排班</span></div><b>待选择</b></header>'; return; }
    const first = new Date(`${person.calendar[0]?.date || `${$('#restMonth').value}-01`}T12:00:00+08:00`); const offset = first.getDay();
    root.innerHTML = `<header><div><h4>${pEsc(person.name)} · ${pEsc(person.roomName)}</h4><span>${pEsc($('#restMonth').value)} 排班状态</span></div><b>${person.alert ? '需关注' : '正常'}</b></header><div class="calendar-week"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="calendar-days">${'<i></i>'.repeat(offset)}${person.calendar.map((day) => `<button type="button" class="${day.status}" title="${pEsc(day.shiftCode || '未排班')}"><b>${Number(day.date.slice(-2))}</b><small>${day.status === 'work' ? pEsc(day.shiftCode) : day.status === 'rest' ? '休' : day.status === 'leave' ? '请假' : day.status === 'unverified' ? '待核验' : '未排'}</small></button>`).join('')}</div><div class="calendar-legend"><span><i class="work"></i>上班</span><span><i class="rest"></i>休息</span><span><i class="unassigned"></i>未排班</span><span>请假/待核验不计月休</span></div>`;
  }
  function renderRestBoard(data) {
    state.restData = data; const source = data.source || {}; const allPeople = data.people || []; const allMatched = allPeople.filter((person) => person.sourceStatus === 'matched'); const allPending = data.unmatched || []; const terms = $('#restAnchorFilter').value.split(/[,，、\s]+/u).map((value) => value.trim().toLowerCase()).filter(Boolean); const matchesFilter = (person) => !terms.length || terms.some((term) => `${person.name} ${person.roomName}`.toLowerCase().includes(term)); const people = allMatched.filter(matchesFilter); const pending = allPending.filter(matchesFilter); const warnings = allMatched.filter((person) => person.alert).length;
    if (document.activeElement !== $('#restEntitlement')) $('#restEntitlement').value = data.entitlement ?? '';
    $('#restEntitlementStatus').textContent=data.historyStatus==='pending_recovery'?(state.draftCapability.enabled?'旧手工月应休及补班说明待恢复；新基线记录另存':'旧手工月应休及补班说明待恢复，当前只读'):data.entitlement==null?'尚未填写本月固定应休':`${$('#restMonth').value} 固定月应休 ${data.entitlement} 天`;
    $('#restSummaryStrip').innerHTML = `<span><b>来源状态</b>${pEsc(source.permissionStatus || '待核验')} · ${pEsc(source.label || '排班总表')}${source.crossMonth ? ' · 已跨月' : ''}${source.mode==='verified_backup' ? `<br>备份读取 ${pEsc(source.readAt)}<br>源修改 ${pEsc(source.sourceModifiedAt)}<br>手工休假配置待恢复` : source.mode==='official_live' ? `<br>当前原表版本 ${pEsc(source.revision ?? '待核验')} · 读取 ${pEsc(data.checkedAt || '')}` : ''}</span><span><b>主播数</b>${data.available ? `${allMatched.length} 已匹配 / ${allPending.length} 待核验` : '待核验'}</span><span class="${warnings ? 'warning' : ''}"><b>连播预警</b>${data.available ? `${warnings} 人` : '待核验'}</span>`;
    const body = $('#restBoardTable'); if (!data.available) { body.innerHTML = `<tr><td colspan="7">${pEsc(data.reason || '数据源暂不可读取。')}</td></tr>`; renderRestCalendar(null); return; }
    body.innerHTML = people.length || pending.length ? people.map((person) => `<tr data-rest-person="${pEsc(person.name)}" class="${person.alert ? 'warning-row' : ''}"><td><button class="rest-status" data-open-rest-calendar type="button"><i></i><span>${pEsc(person.name)}<small>${person.alert ? '需关注' : '排班已读取'}</small></span></button></td><td><select data-rest-room aria-label="${pEsc(person.name)} 直播间">${['官旗','品牌精选','优选','王鸥美肤'].map((room) => `<option ${room === person.roomName ? 'selected' : ''}>${room}</option>`).join('')}</select></td><td>${person.usedRest} / ${person.remainingRest ?? '待核验'}${person.remainingRestReason?`<small>${pEsc(person.remainingRestReason)}</small>`:''}${person.restAdjustment?`<small>补班说明已调整应休 ${person.restAdjustment>0?'+':''}${person.restAdjustment}</small>`:''}</td><td><div class="streak-meter"><span style="--streak:${Math.min(10, person.maximumConsecutiveWorkDays || 0)}"></span><b>${person.maximumConsecutiveWorkDays || 0} 天</b></div></td><td>${pEsc(person.suggestedRestDate || '待确认')}</td><td><input data-rest-note value="${pEsc(person.compNote || '')}" placeholder="如：上月多休一天"></td><td><button data-save-rest type="button">保存</button></td></tr>`).join('') + pending.map((person) => `<tr class="warning-row"><td><b>${pEsc(person.name)}</b><small>待核验</small></td><td>${pEsc(person.roomName || '直播间待核验')}</td><td>待核验</td><td>待核验</td><td>待核验</td><td colspan="2">${pEsc(person.reason || '原表尚未匹配')}</td></tr>`).join('') : `<tr><td colspan="7">${pEsc(data.reason || '当前筛选没有匹配到主播。')}</td></tr>`;
    const selected = people.find((person) => person.name === state.selectedRestName) || people[0]; state.selectedRestName = selected?.name || ''; renderRestCalendar(selected);
    if(source.mode==='verified_backup'||state.historyUnavailable||!state.draftCapability.enabled) {
      const scope=document.createElement('small');scope.textContent=source.scopeNote||'仅展示已映射的原表来源';$('#restSummaryStrip').append(scope);
      $('#restEntitlement').disabled=true;$('#saveRestEntitlement').disabled=true;
      body.querySelectorAll('[data-rest-room]').forEach((select,index)=>{const span=document.createElement('span');span.textContent=people[index]?.roomName||'直播间待核验';select.replaceWith(span);});
      body.querySelectorAll('[data-rest-note],[data-save-rest]').forEach(el=>{el.disabled=true;el.title='新基线草稿保存尚未启用，当前只读';});
    }
  }
  async function loadRestBoard() { const month = $('#restMonth').value || currentScheduleDate().slice(0, 7); $('#restMonth').value = month; try { $('#restSummaryStrip').innerHTML = '<span><b>来源状态</b>正在读取</span><span><b>主播数</b>待核验</span><span><b>连播预警</b>待核验</span>'; const payload = await requestPlanning(`/api/planning/rest?month=${encodeURIComponent(month)}`); renderRestBoard(payload.data); } catch (error) { renderRestBoard({ available: false, reason: error.message, people: [], source: { permissionStatus: '待回传' } }); } finally { disableRecoveryActions(); } }
  $('#restBoardTable').addEventListener('click', async (event) => {
    const row = event.target.closest('[data-rest-person]'); if (!row) return; const person = state.restData?.people?.find((item) => item.name === row.dataset.restPerson);
    if (event.target.closest('[data-open-rest-calendar]')) { state.selectedRestName = person.name; renderRestCalendar(person); return; }
    if (!event.target.closest('[data-save-rest]')) return;
    try { await requestPlanning('/api/planning/rest-profile', { method: 'POST', body: JSON.stringify({ name: person.name, roomName: row.querySelector('[data-rest-room]').value, compNote: row.querySelector('[data-rest-note]').value }) }); await loadRestBoard(); }
    catch (error) { window.alert(error.message); }
  });

  function applyDefaultEntitlement(value){state.anchorRoster=state.anchorRoster.map(person=>({...person,entitlement:value}));state.assistantRoster=state.assistantRoster.map(person=>({...person,entitlement:value}));state.makeupRoster=state.makeupRoster.map(person=>({...person,entitlement:value}));document.querySelectorAll('[data-roster-entitlement]').forEach(input=>{input.value=String(value);syncRestDateField(input.closest('[data-anchor-row],[data-assistant-row],[data-makeup-row]'))})}
  $('#saveRestEntitlement').addEventListener('click', async () => { const value = Number($('#restEntitlement').value); const status=$('#restEntitlementStatus'); if (!Number.isInteger(value) || value < 0 || value > 31) { status.textContent='请填写 0—31 的整数。'; return; } try { status.textContent='正在保存…'; await requestPlanning('/api/planning/rest-setting', { method: 'POST', body: JSON.stringify({ month: $('#restMonth').value, entitlement: value }) }); applyDefaultEntitlement(value); await loadRestBoard(); status.textContent=`${$('#restMonth').value} 全员固定月应休已保存为 ${value} 天。`; } catch (error) { status.textContent=error.message; } });
  $('#restAnchorFilter').addEventListener('input', () => { if (state.restData) renderRestBoard(state.restData); });

  function renderMakeupRoster() {
    $('#makeupRosterEditor').innerHTML = state.makeupRoster.map((person, index) => `<div class="makeup-roster-row" data-makeup-row="${index}"><label>化妆师姓名<input data-roster-name maxlength="40" value="${pEsc(person.name || '')}"></label><label>月应休<input data-roster-entitlement type="number" min="0" max="31" value="${Number(person.entitlement) || 0}"></label>${restDateFieldMarkup(person)}<button data-remove-makeup type="button">删除</button></div>`).join('');
  }
  function readMakeupRoster() { state.makeupRoster = [...document.querySelectorAll('[data-makeup-row]')].map((row, index) => ({ name: row.querySelector('[data-roster-name]').value.trim(), rank: index + 1, entitlement: Math.max(0, Number(row.querySelector('[data-roster-entitlement]').value) || 0), restDates: row.querySelector('[data-roster-rest]').value.split(',').filter(Boolean) })).filter((person) => person.name); return state.makeupRoster; }
  function renderMakeupDraft() {
    const draft = state.currentMakeupDraft; if (!draft) { $('#makeupPlanningGrid').innerHTML = ''; $('#makeupPlanningSummary').innerHTML = ''; $('#previewMakeupImport').disabled = true; $('#commitMakeupImport').disabled = true; return; }
    const lookup = new Map((draft.assignments || []).map((item) => [`${item.name}|${item.date}`, item]));
    $('#makeupPlanningSummary').innerHTML = (draft.attendance || []).map((item) => `<article><b>${pEsc(item.name)}</b><span>上班 ${item.workDays} 天 · 已选休 ${item.usedRest} 天 · 剩余休 ${item.remainingRest}</span><span>AC1 ${item.shifts?.AC1 || 0} · F ${item.shifts?.F || 0} · Q ${item.shifts?.Q || 0}</span></article>`).join('');
    $('#makeupPlanningGrid').innerHTML = `<div class="makeup-shift-legend"><span class="shift-ac1">AC1</span><span class="shift-f">F</span><span class="shift-q">Q</span><span class="shift-rest">休息</span></div><table class="planning-grid makeup-planning-grid"><thead><tr><th>化妆师</th>${draft.dates.map((date) => `<th>${pEsc(date.slice(5))}<small>${pEsc(weekday(date))}</small></th>`).join('')}</tr></thead><tbody>${draft.roster.map((person) => `<tr><th>${pEsc(person.name)}</th>${draft.dates.map((date) => { const item = lookup.get(`${person.name}|${date}`); const shiftClass=item?.rest||item?.shiftCode==='休'?'shift-rest':`shift-${String(item?.shiftCode||'unplanned').toLowerCase()}`; return `<td class="${shiftClass}">${item ? `<b>${pEsc(item.shiftCode)}</b><small>${pEsc(item.shiftTime || '')}</small>` : '<small>未排</small>'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    $('#saveMakeupDraft').disabled = !state.draftCapability.enabled;
    $('#previewMakeupImport').disabled = false;
  }
  function resetMakeupImportPreview() { state.makeupImportPlan = null; $('#makeupImportPreview').hidden = true; $('#makeupImportPreview').innerHTML = ''; $('#commitMakeupImport').disabled = true; }
  async function generateMakeupPlanningDraft() { try { const input = { month: $('#makeupMonth').value, roster: readMakeupRoster() }; $('#makeupPlanningStatus').textContent = '正在按班次数均衡生成…'; const payload = await requestPlanning('/api/planning/makeup/generate', { method: 'POST', body: JSON.stringify(input) }); state.currentMakeupDraft = payload.draft; resetMakeupImportPreview(); renderMakeupDraft(); $('#makeupPlanningStatus').textContent = `已生成 ${payload.draft.dates.length} 天排班；${payload.draft.warnings.length ? `${payload.draft.warnings.length} 条需人工确认。` : '三人排 AC1/F/Q，两人排 AC1/Q。'}`; } catch (error) { $('#makeupPlanningStatus').textContent = error.message; } }
  async function saveMakeupPlanningDraft() { if (!state.currentMakeupDraft) return; try { $('#makeupPlanningStatus').textContent = '正在保存化妆师草稿…'; const payload = await requestPlanning('/api/planning/makeup/draft', { method: 'POST', body: JSON.stringify(state.currentMakeupDraft) }); state.currentMakeupDraft = payload.draft; state.makeupDrafts[payload.draft.month] = payload.draft; resetMakeupImportPreview(); renderMakeupDraft(); $('#makeupPlanningStatus').textContent = `化妆师 ${payload.draft.month} 月排班草稿已保存。`; } catch (error) { $('#makeupPlanningStatus').textContent = error.message; } }
  function selectMakeupMonth() { resetMakeupImportPreview(); const saved = state.makeupDrafts[$('#makeupMonth').value]; if (saved) { state.currentMakeupDraft = structuredClone(saved); state.makeupRoster = structuredClone(saved.roster || []); renderMakeupRoster(); renderMakeupDraft(); $('#makeupPlanningStatus').textContent = `已载入 ${saved.month} 月保存草稿。`; } else { state.currentMakeupDraft = null; renderMakeupDraft(); } }
  async function previewMakeupPlanningImport() {
    if (!state.currentMakeupDraft) return;
    try {
      $('#makeupPlanningStatus').textContent = '正在读取化妆师表并生成导入预览…';
      const payload = await requestPlanning('/api/planning/makeup/import/preview', { method: 'POST', body: JSON.stringify({ draft: state.currentMakeupDraft }) }); const plan = payload.plan; state.makeupImportPlan = plan;
      const blocked = Boolean(plan.unresolved?.length); const preview = $('#makeupImportPreview'); preview.hidden = false;
      preview.innerHTML = `<h3>化妆师排班导入预览</h3><p>${plan.mode === 'append' ? '目标月份尚无区块，将在表尾新增并保留历史月份。' : '目标月份已存在，将只更新匹配人员的日期单元格。'} 共 ${plan.ranges.length} 个精确范围，已有值冲突 ${plan.overwrites.length} 处。</p>${blocked ? `<ul>${plan.unresolved.map((item) => `<li>${pEsc(item.name || item.date)}：${pEsc(item.reason)}</li>`).join('')}</ul>` : '<p>人员、月份和目标范围已核对，可确认导入。</p>'}${plan.overwrites.length ? '<label class="planning-import-confirm"><input id="makeupAllowOverwrite" type="checkbox">我已核对并同意覆盖预览中的已有排班</label>' : ''}`;
      $('#commitMakeupImport').disabled = true; $('#makeupPlanningStatus').textContent = blocked ? '仍有未匹配项，已阻断导入。' : '化妆师源表尚无独立核验的新基线；预览仅供核查，不能提交。';
    } catch (error) { resetMakeupImportPreview(); $('#makeupPlanningStatus').textContent = error.message; }
  }
  async function commitMakeupPlanningImport() {
    const plan = state.makeupImportPlan; if (!plan || !state.currentMakeupDraft) return;
    if (plan.overwrites.length && !$('#makeupAllowOverwrite')?.checked) { $('#makeupPlanningStatus').textContent = '请先勾选同意覆盖已有排班。'; return; }
    try {
      $('#commitMakeupImport').disabled = true; $('#makeupPlanningStatus').textContent = '正在写入化妆师排班并回读核验…';
      const payload = await requestPlanning('/api/planning/makeup/import', { method: 'POST', body: JSON.stringify({ draft: state.currentMakeupDraft, expectedHash: plan.expectedHash, confirm: true, allowOverwrite: Boolean($('#makeupAllowOverwrite')?.checked) }) });
      $('#makeupImportPreview').innerHTML = `<h3>导入完成</h3><p>已写入 ${payload.plan.ranges.length} 个精确范围，并通过飞书回读核验。审计编号：${pEsc(payload.auditId)}</p>`; $('#makeupPlanningStatus').textContent = '化妆师排班已写入并回读一致。'; state.makeupImportPlan = null; await loadMakeup();
    } catch (error) { $('#commitMakeupImport').disabled = true; $('#makeupPlanningStatus').textContent = error.message; }
  }
  async function loadMakeup() {
    try { const payload = await requestPlanning(`/api/planning/makeup?date=${encodeURIComponent(currentScheduleDate())}`); state.makeupData = payload.data; window.setDispatchMakeupDuty?.(payload.data); if (!state.makeupRoster.length) { state.makeupRoster = (payload.data.roster || []).map((name, index) => ({ name, rank: index + 1, entitlement: Number(state.restData?.entitlement)||0, restDates: [] })); renderMakeupRoster(); } const saved = state.makeupDrafts[$('#makeupMonth').value]; if (saved) selectMakeupMonth(); $('#makeupPlanningStatus').textContent = `${payload.data.source?.permissionStatus || '待回传'} · ${payload.data.reason || `在职化妆师 ${payload.data.roster?.length || 0} 名`}`; }
    catch (error) { state.makeupData = { available: false, people: [], roster: [], reason: error.message, source: { permissionStatus: '待回传' } }; window.setDispatchMakeupDuty?.(state.makeupData); $('#makeupPlanningStatus').textContent = error.message; }
    finally { disableRecoveryActions(); }
  }

  async function loadPlanning() {
    try { const payload = await requestPlanning('/api/planning'); state.rooms = payload.rooms || {}; state.shiftTimes = payload.shiftTimes || {}; state.drafts = payload.drafts || {}; state.makeupDrafts = payload.makeupDrafts || {}; state.totalSchedule = payload.totalSchedule || null; state.planningBaseline = payload.planningBaseline || null; state.historyStatus = payload.historyStatus || null; state.historyUnavailable = payload.historyAvailable === false; state.draftCapability = payload.draftCapability || {enabled:false}; state.totalImportCapability = payload.totalImportCapability || {enabled:false}; showBaselineStatus(); applyPlanningCapabilities(); const sourceLink = $('#planningSourceLink'); if (sourceLink && state.totalSchedule?.url) { try { const sourceUrl = new URL(state.totalSchedule.url); if (sourceUrl.protocol === 'https:' && sourceUrl.hostname === 'jqx28l0j4lx.feishu.cn') sourceLink.href = sourceUrl.href; } catch {} } renderDraftMeta(); if (state.totalSchedule?.permissionStatus && !['已连接','已读取'].includes(state.totalSchedule.permissionStatus)) setStatus(`${state.totalSchedule.label}：${state.totalSchedule.permissionStatus}。${state.totalSchedule.reason || ''}`, true); }
    catch (error) {
      if (['history_recovery_pending','planning_epoch_uninitialized'].includes(error.payload?.code)) {
        state.historyUnavailable = true; state.historyStatus = 'pending_recovery';
        try { const recovery = await requestPlanning('/api/recovery/status'); state.planningBaseline = recovery.planningBaseline || null; } catch { state.planningBaseline = null; }
        document.querySelectorAll('[data-draft-count]').forEach((element) => { element.textContent = '旧历史草稿待恢复'; });
        showBaselineStatus(); disableRecoveryActions(); setStatus(error.message, true);
      } else { document.querySelectorAll('[data-planning-room]').forEach((button) => { button.disabled = true; }); setStatus(error.message, true); }
    }
  }

  document.querySelectorAll('[data-planning-room]').forEach((button) => button.addEventListener('click', () => openPlanning(button.dataset.planningRoom, button.dataset.planningRole)));
  $('#closePlanningDialog').addEventListener('click', () => dialog.close()); generateButton.addEventListener('click', generateDraft); saveButton.addEventListener('click', saveDraft); previewButton.addEventListener('click', previewImport);
  $('#loadPriorPlanning').addEventListener('click', loadPriorPlanning);
  $('#refreshRestBoard').addEventListener('click', loadRestBoard); $('#restMonth').addEventListener('change', loadRestBoard);
  $('#makeupRosterEditor').addEventListener('click', (event) => { if (handleRestDateClick(event)) return; const row = event.target.closest('[data-makeup-row]'); if (!row || !event.target.closest('[data-remove-makeup]')) return; readMakeupRoster(); state.makeupRoster.splice(Number(row.dataset.makeupRow), 1); renderMakeupRoster(); });
  $('#makeupRosterEditor').addEventListener('input', (event) => { if (event.target.matches('[data-roster-entitlement]')) syncRestDateField(event.target.closest('[data-makeup-row]')); });
  $('#addMakeupArtist').addEventListener('click', () => { readMakeupRoster(); state.makeupRoster.push({ name: '', rank: state.makeupRoster.length + 1, entitlement: Number(state.restData?.entitlement)||0, restDates: [] }); renderMakeupRoster(); });
  $('#generateMakeupDraft').addEventListener('click', generateMakeupPlanningDraft); $('#saveMakeupDraft').addEventListener('click', saveMakeupPlanningDraft); $('#previewMakeupImport').addEventListener('click', previewMakeupPlanningImport); $('#commitMakeupImport').addEventListener('click', commitMakeupPlanningImport); $('#makeupMonth').addEventListener('change', selectMakeupMonth);
  window.addEventListener('dispatch-date-change', () => window.setTimeout(loadMakeup, 0));
  $('#restMonth').value = currentScheduleDate().slice(0, 7); $('#makeupMonth').value = currentScheduleDate().slice(0, 7); loadPlanning().then(loadRestBoard).then(loadMakeup);
})();
