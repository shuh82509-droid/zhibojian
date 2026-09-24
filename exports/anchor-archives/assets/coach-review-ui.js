((global) => {
const ROOMS = Object.freeze([
  ['官旗', '曾泳淇'],
  ['品牌精选', '梁瑜涵'],
  ['优选', '李爽'],
  ['王鸥美肤', '鲍敏纳'],
]);
const datePattern = /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;
const validDate = value => {
  if (!datePattern.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
};
const pendingRoom = reason => ({status:'pending',reason,anchors:[]});
function coachReviewEndpoint(pathname) {
  const path = String(pathname || '');
  const index = path.lastIndexOf('/modules/');
  return index < 0 ? '' : `${path.slice(0,index)}/api/lifecycle/coach-review`;
}

// Keep only the aggregate counts needed by this page. Calendar titles, event
// IDs and authorization details must not be copied into the rendered model.
function normalizeCoachReview(data) {
  const week = data?.summary?.week;
  const rotationWeek = data?.rotation?.week;
  const validWeek = validDate(week?.start) && validDate(week?.end) &&
    week.start === rotationWeek?.start && week.end === rotationWeek?.end &&
    validDate(data?.date) && week.start <= data.date && data.date <= week.end &&
    new Date(`${week.start}T00:00:00.000Z`).getUTCDay() === 3 &&
    new Date(`${week.end}T00:00:00.000Z`).getUTCDay() === 2 &&
    Date.parse(`${week.end}T00:00:00.000Z`) - Date.parse(`${week.start}T00:00:00.000Z`) === 6*86400000;
  const rooms = {};
  for (const [room, coach] of ROOMS) {
    let state = pendingRoom('周排名或绩效周待核验');
    if (validWeek && data.rotation?.status === 'ready') {
      if (data.calendarStatus?.[room]?.status !== '已读取') {
        state = pendingRoom('教练本人日历待授权或读取待核验');
      } else {
        const summary = data.summary?.rooms?.[room];
        if (summary?.status === 'ready' && Array.isArray(summary.anchors)) {
          const anchors = summary.anchors.map(item => ({name:String(item?.name || '').trim(),count:item?.count}));
          const names = anchors.map(item => item.name);
          if (anchors.every(item => item.name && Number.isSafeInteger(item.count) && item.count >= 0) && new Set(names).size === names.length)
            state = {status:'ready',reason:'',anchors};
          else state = pendingRoom('复盘计次返回值待核验');
        } else state = pendingRoom('复盘计次待核验');
      }
    }
    rooms[room] = {coach,...state};
  }
  return {week:validWeek ? {start:week.start,end:week.end} : null,rooms};
}

function coachReviewLabel(model, room, name) {
  const state = model?.rooms?.[room];
  if (!state || state.status !== 'ready' || !model.week) return '待核验（周排名或教练本人日历未完成核验）';
  const anchor = state.anchors.find(item => item.name === name);
  if (!anchor) return '本周未列入该房间轮转名单（不计次）';
  return `${anchor.count} 次 · ${model.week.start}—${model.week.end}（周三至周二）`;
}

function startCoachReviewUI(doc = global.document) {
  if (!doc) return;
  const banner = doc.querySelector('#banner');
  const detail = doc.querySelector('#detail');
  if (!banner || !detail) return;
  const endpoint = coachReviewEndpoint(global.location.pathname);
  if (!endpoint) return;
  const board = doc.createElement('section');
  board.className = 'coach-review-board';
  board.setAttribute('aria-live','polite');
  banner.parentNode.insertBefore(board,banner);
  const styles = doc.createElement('style');
  styles.textContent = '.coach-review-board{margin:0 0 16px;padding:16px 18px;background:#fff;border:1px solid #e4e8ef;border-radius:14px}.coach-review-board h2{margin:0;font-size:17px}.coach-review-board p{margin:3px 0 12px;color:#748096;font-size:12px}.coach-review-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.coach-review-room{min-width:0;padding:11px;border:1px solid #e4e8ef;border-radius:10px;background:#fafbfe}.coach-review-room b{display:block}.coach-review-room small{color:#748096}.coach-review-room ul{margin:8px 0 0;padding-left:18px}.coach-review-room li{margin:3px 0}@media(max-width:960px){.coach-review-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.coach-review-grid{grid-template-columns:1fr}}';
  doc.head.appendChild(styles);

  let model = null;
  let request = 0;
  function updateDetail() {
    const row = [...detail.querySelectorAll('.line')].find(item => item.querySelector('span')?.textContent === '本绩效周复盘');
    const output = row?.querySelector('b');
    if (!output) return;
    const name = doc.querySelector('#dName')?.textContent?.trim() || '';
    const room = doc.querySelector('#dSub')?.textContent?.split(' · ')[0]?.trim() || '';
    const label = coachReviewLabel(model,room,name);
    if (output.textContent !== label) output.textContent = label;
  }
  new MutationObserver(updateDetail).observe(detail,{childList:true,subtree:true});

  function render(message = '') {
    board.replaceChildren();
    const heading = doc.createElement('h2');
    heading.textContent = '本绩效周主播复盘';
    board.appendChild(heading);
    const note = doc.createElement('p');
    note.textContent = model?.week
      ? `${model.week.start}—${model.week.end}（周三至周二） · 仅统计教练本人日历中可核验的复盘事件`
      : message || '周排名与教练本人日历待核验；缺失计次不显示为 0。';
    board.appendChild(note);
    const grid = doc.createElement('div');
    grid.className = 'coach-review-grid';
    for (const [room,coach] of ROOMS) {
      const state = model?.rooms?.[room] || pendingRoom(message || '正在读取');
      const card = doc.createElement('section');
      card.className = 'coach-review-room';
      const title = doc.createElement('b');
      title.textContent = `${room} · ${coach}`;
      card.appendChild(title);
      const status = doc.createElement('small');
      status.textContent = state.status === 'ready' ? '本人日历已授权 · 复盘计次已核验' : `待核验 · ${state.reason}`;
      card.appendChild(status);
      if (state.status === 'ready') {
        const list = doc.createElement('ul');
        if (!state.anchors.length) {
          const item = doc.createElement('li');item.textContent = '本周无可核验的轮转主播名单';list.appendChild(item);
        } else for (const anchor of state.anchors) {
          const item = doc.createElement('li');item.textContent = `${anchor.name}：${anchor.count} 次`;list.appendChild(item);
        }
        card.appendChild(list);
      }
      grid.appendChild(card);
    }
    board.appendChild(grid);
    updateDetail();
  }
  async function load() {
    const current = ++request;
    try {
      const response = await fetch(endpoint,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true || !payload.data) throw new Error('复盘来源不可读');
      if (current !== request) return;
      model = normalizeCoachReview(payload.data);
      render();
    } catch {
      if (current !== request) return;
      model = null;
      render('复盘来源读取失败或当前账号无权访问；所有计次保留待核验。');
    }
  }
  render();
  void load();
  global.setInterval(() => void load(),5*60*1000);
  doc.addEventListener('visibilitychange',() => {if (!doc.hidden) void load();});
}

if (typeof module === 'object' && module.exports) module.exports = {normalizeCoachReview,coachReviewLabel,coachReviewEndpoint};
startCoachReviewUI();
})(globalThis);
