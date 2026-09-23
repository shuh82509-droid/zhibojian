const globalMaterialSearch = document.querySelector('#globalMaterialSearch');
const materialSearchResults = document.querySelector('#materialSearchResults');
const materialIndex = [
  ['沟通稿', '沟通稿 AI 生成器知识包', '飞书知识包 · 历史沟通稿聚合文档', 'https://jqx28l0j4lx.feishu.cn/wiki/Yo3rwPyCxiqdR6kARjtcphHYn4c'],
  ['沟通稿', '3.0 版水光肽面膜', '水润面膜 · 日常平播', 'https://jqx28l0j4lx.feishu.cn/wiki/Jejow2SyBiEeHXkm2WGcGTXwnkc?fromScene=spaceOverview'],
  ['沟通稿', '3.0 版水光肽面膜－沟通稿（最新）', '水润面膜 · 日常平播', 'https://jqx28l0j4lx.feishu.cn/wiki/UNLZwRlbQimNzOkHktecMNvunyd'],
  ['沟通稿', '水润试播稿件', '水润面膜 · 日常平播', 'https://docs.qq.com/doc/DU1VYUUtNWUZLR2hH?nlc=1'],
  ['沟通稿', '20260713 视频号眼膜沟通稿（同播）', '晶润眼膜 · 抖音渠道', 'https://jqx28l0j4lx.feishu.cn/wiki/Ia3JwQgkmiSO9DkFyeocI5K1nnd'],
  ['沟通稿', '【99 眼膜＋眼霜】沟通稿', '晶润眼膜 · 抖音渠道', 'https://jqx28l0j4lx.feishu.cn/wiki/ZNmIwQbZpi1WJzk9HnGcM8san6g?from=from_copylink'],
  ['沟通稿', '眼膜沟通稿', '晶润眼膜 · 抖音渠道', 'https://jqx28l0j4lx.feishu.cn/wiki/OITIwRkGziByCbkoIy3cmFmYnQf'],
  ['沟通稿', '晶润紧致眼膜沟通稿－种草版 0924', '晶润眼膜 · 抖音渠道', 'https://jqx28l0j4lx.feishu.cn/wiki/NJDXwHVmbiQf4Kk6lNLcVO7FnWK?from=from_copylink'],
  ['沟通稿', '晶润紧致眼膜沟通稿 优化版 1', '晶润眼膜 · 抖音渠道', 'https://jqx28l0j4lx.feishu.cn/wiki/T5VLwALz1iLgSUk2UhXce19RnKd'],
  ['沟通稿', '视频号眼膜 618 沟通稿', '晶润眼膜 · 视频号渠道', 'https://jqx28l0j4lx.feishu.cn/wiki/IhdwwBxFjiz0GFkNYiQctvh1nkc'],
  ['沟通稿', '视频号眼膜沟通稿（同谷雨框架）', '晶润眼膜 · 视频号渠道', 'https://jqx28l0j4lx.feishu.cn/wiki/JuCqw0plriEUEik8yeeciGu7nBe?from=from_copylink'],
  ['主播妆造', '8 月主播妆造视觉规范', '主播 直播间 验收 标准', 'material-makeup.html'],
  ['主播妆造', '官旗自然清透妆', '官旗 妆造 参考图', 'material-makeup.html'],
  ['视觉素材', '夏季护肤主视觉', '产品图 PNG 护肤', 'material-visuals.html'],
  ['视觉素材', '品牌精选直播背景', '背景板 PSD 品牌精选', 'material-visuals.html'],
  ['竞对分析', '直播中心竞对分析归档', '知识树 业务共识 历史复盘 个人知识树', 'material-competitors.html'],
  ['直播手卡', '直播手卡工作台', '卖点 优惠机制 话术 注意事项 禁用语 审核 版本', 'material-cue-cards.html'],
  ['违禁词资料', '违禁词资料库', '敏感词 合规提醒 飞书 Wiki Docx 本地资料', 'material-prohibited.html']
];
const escapeMaterialSearch = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
function renderGlobalMaterialSearch() {
  const query = globalMaterialSearch.value.trim().toLowerCase();
  if (!query) { materialSearchResults.innerHTML = ''; materialSearchResults.hidden = true; return; }
  const hits = materialIndex.filter(([group, title, description]) => `${group} ${title} ${description}`.toLowerCase().includes(query)).slice(0, 8);
  materialSearchResults.hidden = false;
  materialSearchResults.innerHTML = hits.length ? hits.map(([group, title, description, href]) => `<a href="${href}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}><span>${escapeMaterialSearch(group)}</span><b>${escapeMaterialSearch(title)}</b><small>${escapeMaterialSearch(description)}</small><i>打开 →</i></a>`).join('') : '<p>未找到相关内容，可尝试更换关键词。</p>';
}
globalMaterialSearch?.addEventListener('input', renderGlobalMaterialSearch);
globalMaterialSearch?.addEventListener('keydown', (event) => { if (event.key === 'Escape') { globalMaterialSearch.value = ''; renderGlobalMaterialSearch(); globalMaterialSearch.blur(); } });
