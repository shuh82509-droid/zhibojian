const dateLabel = document.querySelector('#dateLabel');
const today = new Date(ScheduleClock.businessDate()+'T00:00:00');
today.setHours(0, 0, 0, 0);
let currentDate = new Date(today);
let scheduleData = {};
let availabilityData = {};
let writebackData = {};
let writebackCapabilities = {};
let makeupDutyData = { available: false, people: [], source: { permissionStatus: '读取中' } };
let lastSyncAt = null;
let sourceBackup = null;
const refreshInterval = 60 * 60 * 1000;
const hubDispatchPath = window.location.pathname.match(/^(\/yxb\/wis-marketing-hub\/(?:live-flow-candidate-[a-z0-9-]+\/)?modules\/dispatch-center)(?:\/|$)/u)?.[1];
const apiBase = window.location.protocol === 'file:' ? 'http://127.0.0.1:3100' : hubDispatchPath || (window.location.pathname.startsWith('/fd-027340/dispatch-center/') ? '/fd-027340/dispatch-center' : '');

const dispatchViewTabs = [...document.querySelectorAll('[data-view-tab]')];
function setDispatchView(view, updateUrl = true) {
  const nextView = view === 'workbench' ? 'workbench' : 'current';
  document.body.dataset.dispatchPage = nextView;
  dispatchViewTabs.forEach((button) => {
    const active = button.dataset.viewTab === nextView;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (updateUrl && /^https?:$/u.test(window.location.protocol)) {
    const url = new URL(window.location.href);
    url.searchParams.set('view', nextView);
    window.history.replaceState(null, '', url);
  }
}

dispatchViewTabs.forEach((button) => {
  button.addEventListener('click', () => setDispatchView(button.dataset.viewTab));
});
setDispatchView(new URLSearchParams(window.location.search).get('view'), false);

const legacyAttendanceRoster = {
  '2026-08-13': [
    { name: '赵媛', shift: 'L（05:30-14:30）', room: '官旗' },
    { name: '潘小慧', shift: 'GJ2(7:30-15:00)', room: '官旗' },
    { name: '何嘉慧', shift: 'GJ(15:30-23:00)', room: '官旗' },
    { name: '林惠敏', shift: 'ZBB（18:30-次日2:00）', room: '官旗' },
    { name: '杨晓彤', shift: '休息', room: '官旗' },
    { name: '李晓茏', shift: 'AC1（07:30-16:30）', room: '品牌精选' },
    { name: '陈璐', shift: 'L（05:30-14:30）', room: '品牌精选' },
    { name: '丁阳虹', shift: '休息', room: '品牌精选' },
    { name: '刘晶晶', shift: '休息', room: '品牌精选' },
    { name: '蒋珂', shift: 'J2（14:30-23:00）', room: '品牌精选' },
    { name: '罗梓欣', shift: 'WB(17:30-次日02:00)', room: '品牌精选' },
    { name: '陈荟聿', shift: 'M（21:30-05:00）', room: '品牌精选' },
    { name: '林羽浠', shift: '原直播间', room: '品牌精选' },
    { name: '黄芷曈', shift: '休息', room: '优选' },
    { name: '王明玥', shift: 'M（21:30-05:00）', room: '优选' },
    { name: '刁心然', shift: 'X（10:00-19:00）', room: '优选' },
    { name: '胡琳琳', shift: 'R（06:30-15:30）', room: '优选' },
    { name: '王思佳', shift: 'B3（13:30-22:00）', room: '优选' },
    { name: '陈意彤', shift: 'R（06:30-15:30）', room: '王鸥美肤' },
    { name: '宋怡琳', shift: 'B3（13:30-22:00）', room: '王鸥美肤' },
    { name: '陈荟聿', shift: 'M（21:30-05:00）', room: '王鸥美肤' },
    { name: '林羽浠', shift: '休息', room: '王鸥美肤' },
    { name: '李安妮', shift: 'X（10:00-19:00）', room: '王鸥美肤' },
  ],
};
const shiftTimes = {
  GJ3: ['05:30', '13:00'], L: ['05:30', '14:30'], R: ['06:30', '15:30'], GJ2: ['07:30', '15:00'], AC1: ['07:30', '16:30'],
  F: ['08:00', '17:00'], A: ['08:30', '17:30'], TXQJ: ['08:30', '17:30'], W: ['09:00', '18:00'], D2: ['09:30', '18:30'], Q: ['09:30', '18:30'],
  X: ['10:00', '19:00'], H: ['10:00', '20:30'], Z: ['11:30', '20:00'], B2: ['12:00', '21:00'], S: ['12:30', '21:00'], I: ['13:00', '22:00'],
  GJ4: ['13:30', '21:00'], B3: ['13:30', '22:00'], J: ['14:00', '23:00'], GJ6: ['14:30', '22:00'], J2: ['14:30', '23:00'],
  G: ['15:00', '00:00'], GJ: ['15:30', '23:00'], G2: ['15:30', '23:59'], K: ['16:00', '01:00'], P: ['16:30', '01:00'],
  GJ5: ['17:30', '01:00'], WB: ['17:30', '02:00'], ZBB: ['18:30', '02:00'], N2: ['20:00', '04:30'], M: ['21:30', '05:00'], ZB1: ['05:00', '14:00'],
};
const datePicker = document.createElement('input');
datePicker.type = 'date';
datePicker.id = 'datePicker';
datePicker.setAttribute('aria-label', '选择排班日期');
dateLabel.replaceWith(datePicker);
document.querySelector('.rules-card')?.remove();
document.querySelector('.lower-grid')?.classList.add('single-column');
const defaultRooms = [
  { name: '官旗', platform: '抖音', className: 'flagship', anchors: [], assistants: [] },
  { name: '品牌精选', platform: '抖音', className: 'brand-room', anchors: [], assistants: [] },
  { name: '优选', platform: '抖音', className: 'best', anchors: [], assistants: [] },
  { name: '王鸥', platform: '视频号', className: 'wangou', anchors: [], assistants: [] },
];

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function timeToMinutes(time) {
  const [hours, minutes] = String(time).split(':').map(Number);
  return hours * 60 + minutes;
}

function isOnShift(range, now) { return ScheduleClock.onShift(range, now, dateKey(currentDate)); }

function currentPerson(shifts, now) {
  return (shifts || []).find((shift) => isOnShift(shift, now));
}

function currentSchedule() {
  return scheduleData[dateKey(currentDate)];
}

function shiftRange(rawShift) {
  const normalized = String(rawShift || '').replace(/（/g, '(').replace(/）/g, ')').trim();
  const code = Object.keys(shiftTimes).sort((a, b) => b.length - a.length).find((item) => normalized.startsWith(item));
  return code ? shiftTimes[code] : null;
}

function isShiftActive(rawShift, now) {
  const range = shiftRange(rawShift);
  return range ? isOnShift(range, now) : false;
}

function buildAvailability(date) {
  const roster = legacyAttendanceRoster[date] || [];
  const now = new Date();
  const activeLiveNames = new Set((scheduleData[date] || []).flatMap((room) => (room.anchors || []).filter((shift) => isOnShift(shift, now)).map((shift) => shift[2])));
  const deduped = new Map();
  roster.forEach((person) => {
    const existing = deduped.get(person.name);
    if (!existing || person.shift === '休息') deduped.set(person.name, person);
  });
  const people = [...deduped.values()];
  return {
    standby: date === dateKey(today) ? people.filter((person) => isShiftActive(person.shift, now) && !activeLiveNames.has(person.name)).map((person) => ({ ...person, shift: `${person.room} · ${person.shift}` })) : [],
    resting: people.filter((person) => person.shift === '休息').map((person) => ({ ...person, note: person.room })),
  };
}

function renderLiveStatus() {
  const liveGrid = document.querySelector('#liveRoomGrid');
  const now = new Date();
  const dailySchedule = currentSchedule();
  const cards = dailySchedule || defaultRooms;
  const dutyMakeup = (makeupDutyData.people || []).filter((person) => person.onDuty); const makeupPeople = dutyMakeup.length ? dutyMakeup : (makeupDutyData.people || []);
  const makeupLabel = makeupDutyData.available ? (makeupPeople.length ? makeupPeople.map((person) => `${person.name}${person.shiftCode ? ` · ${person.shiftCode}` : ''}`).join('、') : '该日无可验证排班') : (makeupDutyData.source?.permissionStatus || '待回传');
  liveGrid.innerHTML = cards.map((room) => {
    const anchor = currentPerson(room.anchors, now);
    const assistant = currentPerson(room.assistants, now);
    const online = anchor || assistant;
    const status = dateKey(currentDate) !== ScheduleClock.businessDate(now) ? '所选日期班表 · 非当前当班' : online ? '班表显示当班' : room.sourceFound === false ? '该日班表待回补' : dailySchedule ? '班表当前无安排' : '正在读取班表';
    return `<article class="live-room ${escapeHtml(room.className)}${online ? '' : ' is-offline'}">
      <div class="live-room-head"><span class="room-status"><i></i>${status}</span><span>${escapeHtml(room.platform)}</span></div>
      <h3>${escapeHtml(room.name)}直播间</h3>
      <div class="live-person"><span>排班主播</span><b>${anchor ? `${escapeHtml(anchor[2])} · ${anchor[0]}–${anchor[1]}` : '暂无当班主播'}</b></div>
      <div class="live-person"><span>排班助理</span><b>${assistant ? `${escapeHtml(assistant[2])} · ${assistant[0]}–${assistant[1]}` : '暂无当班助理'}</b></div>
    </article>`;
  }).join('') + `<article class="shared-makeup-row"><span>四个直播间共享值班化妆师</span><b>${escapeHtml(makeupLabel)}</b><small>${escapeHtml(makeupDutyData.source?.permissionStatus || '待回传')}</small></article>`;
}

window.setDispatchMakeupDuty = (data) => { makeupDutyData = data && typeof data === 'object' ? data : { available: false, people: [], source: { permissionStatus: '待回传' } }; renderLiveStatus(); };

function updateLiveClock() {
  const formatted = new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
  document.querySelector('#liveTime').textContent = `当前时间 ${formatted}${sourceBackup ? ' · 原表只读备份，非实时' : lastSyncAt ? ' · 班表读取 '+new Date(lastSyncAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : ''}`;
  renderLiveStatus();
  renderDispatchableAnchors();
  updateTimelineNowIndicator();
}

function formatDate(date) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(date).replace('星期', '周');
}

function scheduleMinute(time, isEnd = false) {
  const minutes = timeToMinutes(time);
  return minutes < 330 || (isEnd && minutes === 330) ? minutes + 1440 : minutes;
}

function renderTimeline() {
  const timeline = document.querySelector('#timeline');
  const dailySchedule = currentSchedule();
  const labels = ['05:30', ...Array.from({ length: 23 }, (_, index) => `${String((index + 6) % 24).padStart(2, '0')}:00`), '次日05:30'];
  if (!dailySchedule) {
    timeline.innerHTML = '<div class="timeline-empty">正在读取实时班表…</div>';
    return;
  }
  const header = `<div class="timeline-header"><div class="time-head room-head">直播间 / 岗位</div><div class="timeline-hours">${labels.map((label) => `<div class="time-head">${label}</div>`).join('')}</div></div>`;
  const roomsMarkup = dailySchedule.map((room) => {
    const tracks = [['主播', room.anchors, 'anchor'], ['助理', room.assistants, 'assistant']].map(([role, shifts, roleClass]) => {
      const blocks = shifts.map((shift) => {
        const start = ((scheduleMinute(shift[0]) - 330) / 1440) * 100;
        const duration = ((scheduleMinute(shift[1], true) - scheduleMinute(shift[0])) / 1440) * 100;
        return `<div class="shift s-${escapeHtml(room.className)} ${roleClass}" style="left:calc(${start}% + 4px);width:calc(${duration}% - 8px)"><b>${escapeHtml(shift[2])}</b><small>${shift[0]}–${shift[1]}</small></div>`;
      }).join('');
      return `<div class="schedule-role-line"><span class="role-name">${role}</span><div class="schedule-track">${blocks}</div></div>`;
    }).join('');
    return `<div class="schedule-room"><div class="room-group-label"><b>${escapeHtml(room.name)}</b><small>${escapeHtml(room.platform)}</small></div><div class="room-tracks">${tracks}</div></div>`;
  }).join('');
  timeline.innerHTML = `${header}${roomsMarkup}<div class="timeline-now-indicator" id="timelineNowIndicator" aria-hidden="true"><span></span></div>`;
  updateTimelineNowIndicator();
}

function updateTimelineNowIndicator() {
  const indicator = document.querySelector('#timelineNowIndicator');
  const timeline = document.querySelector('#timeline');
  const hours = timeline?.querySelector('.timeline-hours');
  if (!indicator || !timeline || !hours) return;
  const now = new Date();
  const minutes = ScheduleClock.timelineMinute(now);
  const isCurrentSchedule = dateKey(currentDate) === ScheduleClock.businessDate(now);
  if (!isCurrentSchedule) {
    indicator.hidden = true;
    return;
  }
  const timelineMinute = minutes < 330 ? minutes + 1440 : minutes;
  const percentage = ((timelineMinute - 330) / 1440) * 100;
  const timelineRect = timeline.getBoundingClientRect();
  const hoursRect = hours.getBoundingClientRect();
  indicator.hidden = percentage < 0 || percentage > 100;
  indicator.style.left = `${hoursRect.left - timelineRect.left + (hoursRect.width * percentage / 100)}px`;
  indicator.querySelector('span').textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
}

function renderDispatchableAnchors() {
  const key = dateKey(currentDate);
  const container = document.querySelector('#dispatchableContent');
  const dateLabel = document.querySelector('#dispatchableDate');
  if (!container || !dateLabel) return;
  dateLabel.textContent = formatDate(currentDate);
  const availability = availabilityData[key] || {};
  const standby = Array.isArray(availability.standby) ? availability.standby : [];
  const resting = Array.isArray(availability.resting) ? availability.resting : [];
  const verified = availability.coverageComplete === true;
  const count = people => verified ? people.length : people.length ? people.length+'（部分）' : '待核验';
  const renderPeople = (people, type) => people.length ? people.map((person) => `<li><b>${escapeHtml(person.name)}</b><span>${escapeHtml(person.shift || person.note || '')}</span></li>`).join('') : `<li class="availability-empty">${type === 'standby' ? (verified ? '已读取的班表中暂无待支援安排；不代表真实打卡情况。' : '班表覆盖不全，待支援人员待核验。') : (verified ? '已读取的班表中暂无休息安排。' : '班表覆盖不全，休息人员待核验。')}</li>`;
  container.innerHTML = `<article class="availability-panel standby"><div class="availability-title"><span>班表待支援</span><b>${count(standby)}</b></div><p>按排班推算 · 打卡尚未接入</p><ul>${renderPeople(standby, 'standby')}</ul></article><article class="availability-panel resting"><div class="availability-title"><span>班表休息安排</span><b>${count(resting)}</b></div><p>以所选日期班表为准</p><ul>${renderPeople(resting, 'resting')}</ul></article>`;
}

async function loadRemoteSchedule(date = currentDate) {
  const key = dateKey(date);
  try {
    const response = await fetch(`${apiBase}/api/schedule?date=${key}&refresh=1`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '读取实时班表失败。');
    scheduleData[key] = (payload.rooms || []).map(room=>({...room,sourceFound:payload.sourceStatus?.[room.code]?.found !== false}));
    availabilityData[key] = payload.availability || {};
    writebackData[key] = payload.writeback || {};
    writebackCapabilities[key] = payload.writebackCapability || {enabled:false,message:'排班写回状态待核验。'};
    document.querySelector('#newShiftButton').title = writebackCapabilities[key].enabled ? '预览并核对排班写回' : writebackCapabilities[key].message;
    lastSyncAt = payload.updatedAt;
    sourceBackup = ['verified_backup','official_user_snapshot'].includes(payload.source?.mode) ? payload.source : null;
    if (sourceBackup) {
      let note = document.querySelector('#scheduleSourceBackupNotice');
      if (!note) { note=document.createElement('p');note.id='scheduleSourceBackupNotice';note.setAttribute('role','status');document.querySelector('#timeline').before(note); }
      note.textContent=`${sourceBackup.mode === 'official_user_snapshot' ? '飞书原表已重新读取，当前为只读快照' : '原表只读备份'}，非实时同步。读取时间：${sourceBackup.readAt}；源修改时间：${sourceBackup.sourceModifiedAt}。未覆盖日期仍显示待回传，手工草稿未恢复。`;
    }
    renderLiveStatus();
    renderTimeline();
    renderDispatchableAnchors();
  } catch (error) {
    writebackCapabilities[key] = {enabled:false,message:'班表来源未通过核验，不能写回。'};
    document.querySelector('#timeline').innerHTML = '<div class="timeline-empty">班表暂时无法读取；已保留最近一次成功数据，稍后会自动重试。</div>';
    console.error(error);
  }
}

function updateDate() {
  datePicker.value = dateKey(currentDate);
  datePicker.title = formatDate(currentDate);
  window.dispatchEvent(new CustomEvent('dispatch-date-change', { detail: { date: dateKey(currentDate) } }));
}

datePicker.addEventListener('change', () => {
  if (!datePicker.value) return;
  currentDate = new Date(`${datePicker.value}T00:00:00`);
  updateDate(); renderLiveStatus(); renderTimeline(); renderDispatchableAnchors(); loadRemoteSchedule();
});

document.querySelector('#prevDay').addEventListener('click', () => {
  currentDate.setDate(currentDate.getDate() - 1);
  updateDate(); renderLiveStatus(); renderTimeline(); renderDispatchableAnchors(); loadRemoteSchedule();
});
document.querySelector('#nextDay').addEventListener('click', () => {
  currentDate.setDate(currentDate.getDate() + 1);
  updateDate(); renderLiveStatus(); renderTimeline(); renderDispatchableAnchors(); loadRemoteSchedule();
});
document.querySelector('#todayButton').addEventListener('click', () => {
  currentDate = new Date(today);
  updateDate(); renderLiveStatus(); renderTimeline(); renderDispatchableAnchors(); loadRemoteSchedule();
});

const dialog = document.querySelector('#shiftDialog');
const shiftForm = document.querySelector('#shiftForm');
const shiftRoom = document.querySelector('#shiftRoom');
const shiftRole = document.querySelector('#shiftRole');
const shiftStart = document.querySelector('#shiftStart');
const shiftEnd = document.querySelector('#shiftEnd');
const shiftName = document.querySelector('#shiftName');
const saveShift = document.querySelector('#saveShift');
const writebackPreview = document.querySelector('#writebackPreview');
const overwriteConfirm = document.querySelector('#overwriteConfirm');
const allowOverwrite = document.querySelector('#allowOverwrite');
let pendingWriteback = null;

function availableSlots() {
  return writebackData[dateKey(currentDate)]?.[shiftRoom.value]?.roles?.[shiftRole.value]?.slots || [];
}

function resetWritebackPreview() {
  pendingWriteback = null;
  writebackPreview.hidden = true;
  writebackPreview.innerHTML = '';
  overwriteConfirm.hidden = true;
  allowOverwrite.checked = false;
  saveShift.textContent = '预览飞书差异';
}

function populateEndTimes() {
  const slots = availableSlots();
  const selectedStart = shiftStart.value;
  const startIndex = slots.findIndex((slot) => slot.start === selectedStart);
  const ends = slots.slice(Math.max(0, startIndex)).map((slot) => slot.end);
  shiftEnd.innerHTML = ends.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  resetWritebackPreview();
}

function populateWritebackTimes() {
  const capability = writebackCapabilities[dateKey(currentDate)] || {enabled:false,message:'排班写回状态待核验。'};
  if (!capability.enabled) {
    shiftStart.innerHTML = '';
    shiftEnd.innerHTML = '';
    saveShift.disabled = true;
    writebackPreview.hidden = false;
    writebackPreview.innerHTML = `<p class="writeback-error">${escapeHtml(capability.message || '当前排班只读，不能写回。')}</p>`;
    return;
  }
  const slots = availableSlots();
  shiftStart.innerHTML = slots.map((slot) => `<option value="${escapeHtml(slot.start)}">${escapeHtml(slot.start)}</option>`).join('');
  saveShift.disabled = slots.length === 0;
  if (!slots.length) {
    shiftEnd.innerHTML = '';
    writebackPreview.hidden = false;
    writebackPreview.innerHTML = '<p class="writeback-error">该日期/直播间没有可识别的岗位时间轴，无法写回。</p>';
    return;
  }
  populateEndTimes();
}

function writebackInput() {
  return {
    date: dateKey(currentDate),
    action:document.querySelector('#shiftAction').value,
    roomCode: shiftRoom.value,
    role: shiftRole.value,
    name: shiftName.value.trim(),
    start: shiftStart.value,
    end: shiftEnd.value,
  };
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.add('show');
  setTimeout(() => { toast.classList.remove('show'); toast.hidden = true; toast.textContent = ''; }, 3200);
}

async function postWriteback(path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || '排班写回请求失败。');
    error.payload = payload;
    throw error;
  }
  return payload;
}

function renderWritebackPreview(plan) {
  const before = plan.before.map((value) => value || '空白').join(' / ');
  const after = [...new Set(plan.after)].map(value=>value||'清空该姓名（删除排班）').join(' / ');
  writebackPreview.hidden = false;
  writebackPreview.innerHTML = `<h3>飞书写回预览</h3>
    <dl><div><dt>目标范围</dt><dd>${escapeHtml(plan.range)}</dd></div><div><dt>当前内容</dt><dd>${escapeHtml(before)}</dd></div><div><dt>写入内容</dt><dd>${escapeHtml(after)}</dd></div><div><dt>时间</dt><dd>${escapeHtml(plan.start)}–${escapeHtml(plan.end)}</dd></div></dl>
    <p>${plan.noChange ? '目标内容已相同；确认后会记录一次无变更审计。' : '提交时会再次读取这些单元格；如有变化，将要求重新预览。'}</p>`;
  overwriteConfirm.hidden = plan.overwrites.length === 0;
  saveShift.textContent = '确认写回飞书';
}

document.querySelector('#newShiftButton').addEventListener('click', () => {
  resetWritebackPreview();
  populateWritebackTimes();
  dialog.showModal();
  shiftName.focus();
});
document.querySelector('#closeShiftDialog').addEventListener('click', () => dialog.close());
document.querySelector('#cancelShift').addEventListener('click', () => dialog.close());
[shiftRoom, shiftRole].forEach((element) => element.addEventListener('change', populateWritebackTimes));
shiftStart.addEventListener('change', populateEndTimes);
[shiftEnd, shiftName, document.querySelector('#shiftAction')].forEach((element) => element.addEventListener('input', resetWritebackPreview));

shiftForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!shiftForm.reportValidity()) return;
  saveShift.disabled = true;
  try {
    const input = writebackInput();
    if (!pendingWriteback) {
      const payload = await postWriteback('/api/schedule/writeback/preview', input);
      pendingWriteback = { input, plan: payload.plan };
      renderWritebackPreview(payload.plan);
      return;
    }
    if (pendingWriteback.plan.overwrites.length && !allowOverwrite.checked) {
      throw new Error('请先核对并勾选“同意覆盖现有姓名”。');
    }
    const payload = await postWriteback('/api/schedule/writeback', {
      ...pendingWriteback.input,
      confirm: true,
      expectedHash: pendingWriteback.plan.expectedHash,
      allowOverwrite: allowOverwrite.checked,
    });
    showToast(`已写回飞书并通过回读 · ${payload.plan.range}`);
    dialog.close();
    resetWritebackPreview();
    shiftForm.reset();
    await loadRemoteSchedule(currentDate);
  } catch (error) {
    pendingWriteback = null;
    writebackPreview.hidden = false;
    writebackPreview.innerHTML = `<p class="writeback-error">${escapeHtml(error.message)}</p><p>请重新预览最新班表后再提交。</p>`;
    saveShift.textContent = '重新预览飞书差异';
    overwriteConfirm.hidden = true;
  } finally {
    saveShift.disabled = availableSlots().length === 0;
  }
});

updateDate();
renderLiveStatus();
renderTimeline();
renderDispatchableAnchors();
async function loadResourcePriorities() {
  try {
    const response = await fetch(`${apiBase}/api/planning`, { credentials: 'same-origin', cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || '资源位配置读取失败');
    document.querySelectorAll('[data-resource-room]').forEach((card) => {
      const room = payload.rooms?.[card.dataset.resourceRoom];
      if (!room?.anchorShifts?.length) return;
      const row = card.querySelector('p');
      row.innerHTML = room.anchorShifts.map((shift, index) => `${index ? '<i>›</i>' : ''}<strong>${escapeHtml(shift)}</strong>`).join('');
    });
    const source = document.querySelector('.resource-source');
    if (source) source.textContent = `调度配置实时读取 · ${new Intl.DateTimeFormat('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date())}`;
  } catch (error) {
    const source = document.querySelector('.resource-source');
    if (source) source.textContent = `调度配置读取失败 · ${error.message}`;
  }
}
loadResourcePriorities();
loadRemoteSchedule();
updateLiveClock();
setInterval(updateLiveClock, 1000);
function refreshEntireDashboardOnTheHour() {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 2, 0);
  window.setTimeout(() => window.location.reload(), Math.max(1000, nextHour.getTime() - now.getTime()));
}

refreshEntireDashboardOnTheHour();
