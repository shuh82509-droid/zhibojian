(() => {
  const path = location.pathname;
  const moduleKey = path.includes('/modules/recruitment/') ? 'recruitment' : path.includes('/modules/anchors/') ? 'coaching' : path.includes('/modules/morning/') ? 'morning' : '';
  if (!moduleKey) return;

  const css = document.createElement('style');
  css.textContent = `.feishu-live{margin:18px 0;padding:18px 20px;border:1px solid #d9e3dc;border-radius:14px;background:#fff;color:#102c25;font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 6px 22px rgba(18,57,45,.06)}.feishu-live *{box-sizing:border-box}.feishu-live__head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.feishu-live__head h2{font-size:18px;margin:0}.feishu-live__status{font-size:12px;color:#64766f}.feishu-live__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.feishu-live__item{padding:12px;border-radius:10px;background:#f4f7f5;border:1px solid #e4ebe7;min-height:88px}.feishu-live__item b{display:block;margin-bottom:4px}.feishu-live__item time{font-size:12px;color:#708079}.feishu-live__item p{margin:6px 0 0;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.feishu-live__error{color:#a63b2c;background:#fff1ee}.feishu-live__doc{margin-top:10px;padding:12px;border-left:4px solid #176947;background:#f1f8f4}.feishu-live__doc a{color:#176947;font-weight:700}`;
  document.head.appendChild(css);

  const panel = document.createElement('section');
  panel.className = 'feishu-live';
  panel.innerHTML = '<div class="feishu-live__head"><h2>飞书实时同步</h2><span class="feishu-live__status">正在连接 Coco…</span></div><div class="feishu-live__grid"></div><div class="feishu-live__doc" hidden></div>';
  const root = document.querySelector('main') || document.body;
  root.insertBefore(panel, root.firstChild);

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const displayTime = value => value ? new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)) : '';

  async function refresh() {
    const status = panel.querySelector('.feishu-live__status');
    const grid = panel.querySelector('.feishu-live__grid');
    const doc = panel.querySelector('.feishu-live__doc');
    try {
      const endpoint = new URL('../../api/feishu/summary', location.href);
      const response = await fetch(endpoint, {credentials:'same-origin',cache:'no-store'});
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || '读取失败');
      const source = payload.data.chats[moduleKey];
      if (!source || source.error) throw new Error(source?.error || '目标群不可用');
      const messages = (source.messages || []).filter(item => item.text).slice(0, 8);
      grid.innerHTML = messages.length ? messages.map(item => `<article class="feishu-live__item"><b>${escapeHtml(item.sender.name || '群成员')}</b><time>${escapeHtml(displayTime(item.createdAt))}</time><p>${escapeHtml(item.text)}</p></article>`).join('') : '<article class="feishu-live__item">目标群暂时没有可展示的新消息。</article>';
      status.textContent = `${source.name} · ${displayTime(source.fetchedAt)} 更新`;
      if (moduleKey === 'morning') {
        const report = payload.data.documents.morning_wangou;
        if (report && !report.error) {
          const excerpt = String(report.content || '').replace(/\s+/g,' ').slice(0,500);
          doc.hidden = false;
          doc.innerHTML = `<b>${escapeHtml(report.title || report.name)}</b><p>${escapeHtml(excerpt || '文档内容为空')}</p><a href="${escapeHtml(report.sourceUrl)}" target="_blank" rel="noreferrer">打开飞书原文 →</a>`;
        }
      }
    } catch (error) {
      status.textContent = 'Coco 连接异常';
      grid.innerHTML = `<article class="feishu-live__item feishu-live__error"><b>实时数据暂不可用</b><p>${escapeHtml(error.message)}</p></article>`;
    }
  }

  refresh();
  setInterval(refresh, 60 * 1000);
})();
