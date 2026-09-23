import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import {
  chinaDateFor,
  isLifecycleRefreshDue,
  mergeRecruitmentCandidates,
  normalizeAnchorReport,
  parseLatestCoachSummary,
  parseEmploymentMessages, parseRecruitmentMessages, buildInterviewReminderPreview, extractAnchorEvaluation, verifiedAnchorEvidence, feishuDocumentLink
} from './lifecycle-engine.mjs';
import { frameHeadersForHub } from './frame-policy.mjs';
import { createCalendarUserReader } from './calendar-user-reader.mjs';
import { createCalendarAuthHandler } from './calendar-auth-http.mjs';

const port = Number(process.env.PORT || 3000);
const recoveryReadOnly = process.env.RECOVERY_READ_ONLY === '1';
const recoveryMessage = '维护恢复中，仅供查看。已核验的原表资料按备份日期展示；历史手卡、上传素材与人工草稿尚待恢复，保存与写回已暂停。';
const publicDir = join(process.cwd(), 'public');
const basePath = (process.env.BASE_PATH || '/fd-027340/live-center-workbench').replace(/\/$/, '');
// Enable embedding only behind the hub's same-origin route. The existing
// standalone deployment keeps its explicit anti-framing policy by default.
const hubSameOriginEmbed = process.env.HUB_SAME_ORIGIN_EMBED === 'true';
const frameHeaders = frameHeadersForHub(hubSameOriginEmbed);
const appId = process.env.FEISHU_APP_ID || '';
const appSecret = process.env.FEISHU_APP_SECRET || '';
const notificationBotAppId = 'cli_aa9c744d6ffa1cc4';
const notificationBotIdentityMatches = () => appId === notificationBotAppId;
const centralAuthorityBase = String(process.env.CENTRAL_AUTHORITY_BASE || 'https://app.fandow.top/fd-026222/wis-video-center/api').replace(/\/+$/u, '');
const centralAuthorityFallbackBase = String(process.env.CENTRAL_AUTHORITY_FALLBACK_BASE || '').replace(/\/+$/u, '');
const requiredModule = 'live-room-management';
const marketingHubUrl = process.env.MARKETING_HUB_URL || 'https://app.fandow.top/fd-026222/wis-marketing-hub/';
const minimaxApiKey = process.env.MINIMAX_API_KEY || '';
const minimaxBaseUrl = (process.env.MINIMAX_BASE_URL || 'https://cloud.fandow.com/gpt/openclaw-jump/v1').replace(/\/$/, '');
const minimaxModel = process.env.MINIMAX_MODEL || 'MiniMax-M2.7-highspeed';
const minimaxTimeoutMs = Math.max(30, Math.min(1800, Number(process.env.MINIMAX_TIMEOUT_SECONDS || 1800))) * 1000;
const jumpLlmUrl = process.env.JUMP_LLM_URL || 'https://cloud.fandow.com/gpt/interface/chat/completions';
const jumpLlmToken = process.env.JUMP_LLM_TOKEN || '';
const jumpLlmApplication = process.env.JUMP_LLM_APPLICATION || 'pingying_zhongshu';
const jumpLlmProvider = process.env.JUMP_LLM_PROVIDER || 'deepseek';
const jumpLlmModel = process.env.JUMP_LLM_MODEL || 'deepseek-v4-pro';
const jumpLlmFallbackModel = process.env.JUMP_LLM_FALLBACK_MODEL || 'deepseek-v4-flash';
const jumpVisionModel = process.env.JUMP_LLM_VISION_MODEL || 'deepseek-v4-flash-vision-exp';
const intelligenceRefreshMinutes = Math.max(5, Math.min(120, Number(process.env.INTELLIGENCE_REFRESH_MINUTES || 15)));
const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
const morningDir = join(dataDir, 'morning');
const lifecycleDir = join(dataDir, 'lifecycle');
const materialCardPath = join(dataDir, 'material-cards.json');
const materialAssetPath = join(dataDir, 'material-assets.json');
const materialAssetDir = join(dataDir, 'material-uploads');
const materialLinkPath = join(dataDir, 'material-links.json');
const calendarOverridePath = join(dataDir, 'live-calendar-overrides.json');
const communicationDraftPath = join(dataDir, 'communication-drafts.json');
const anchorDevelopmentPath = join(dataDir, 'anchor-development.json');
const lifecycleRefreshTimes = [...new Set(String(process.env.LIFECYCLE_REFRESH_TIMES || '09:30,18:00')
  .split(',').map(value => value.trim()).filter(value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)))].sort();
if (!lifecycleRefreshTimes.length) lifecycleRefreshTimes.push('09:30', '18:00');
const lifecycleSchedulerEnabled = !recoveryReadOnly && process.env.LIFECYCLE_SCHEDULER_ENABLED !== '0';
const mime = { '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.mp4':'video/mp4','.pdf':'application/pdf' };
const feishuReady = () => Boolean(appId && appSecret);
const visualThemeFolders = Object.freeze(['大促主题', '品牌色平销', '特殊内容场']);
const feishuChats = Object.freeze({
  recruitment: { name: 'WIS新人主播审核对接群', chatId: 'oc_b66a4cb78495045fce0caed731d7870e' },
  coaching: { name: 'WIS直播战队', chatId: 'oc_3f92ef62d6160399ee823e74def199e6' },
  morning: { name: '风平浪静每一天', chatId: 'oc_e95b6981d8491910c7291626743ed149' },
  learning: { name: 'WIS直播学习', chatId: 'oc_a5640cee560bb4078ded95fc2278c329' }
});
const feishuDocs = Object.freeze({
  morning_wangou: { name: '王鸥美肤直播间日报', token: 'K2s2wUVC5i1ZYjku6UucFxxjnVg', sourceUrl: 'https://jqx28l0j4lx.feishu.cn/wiki/K2s2wUVC5i1ZYjku6UucFxxjnVg' },
  morning_selected: { name: '品牌精选直播间日报', token: 'VNZOwok0biAQItkYVkDcQAggnDe', sourceUrl: 'https://jqx28l0j4lx.feishu.cn/wiki/VNZOwok0biAQItkYVkDcQAggnDe' },
  morning_preferred: { name: '优选直播间日报', token: 'BmU6wQf28iVrhPk8ZEzcFeqTnQh', sourceUrl: 'https://jqx28l0j4lx.feishu.cn/wiki/BmU6wQf28iVrhPk8ZEzcFeqTnQh' },
  coach: { name: '教练日报', token: 'M3Plw8NUPic7lakKEOGc43uvnHc', sourceUrl: 'https://jqx28l0j4lx.feishu.cn/wiki/M3Plw8NUPic7lakKEOGc43uvnHc' }
});
// These are the Feishu documents linked from the material centre.  Keeping this
// allow-list on the server makes the scheduled intelligence pass comprehensive
// without exposing Coco credentials or accepting arbitrary document URLs.
const materialFeishuDocUrls = Object.freeze([
  'https://jqx28l0j4lx.feishu.cn/docx/PKDkde7aAoYMlrx9yMMcwqOunSd',
  'https://jqx28l0j4lx.feishu.cn/docx/Q7pUdajw5oant3xglC3cvi0Ln9f',
  'https://jqx28l0j4lx.feishu.cn/docx/QSF0ducRCopJW4xvmuacqRcqnHc',
  'https://jqx28l0j4lx.feishu.cn/docx/U9jLd3DHZoszupxb8DbcPrYfnwb',
  'https://jqx28l0j4lx.feishu.cn/wiki/ALsQwaieWiClLxkTyOTcVUUNncN',
  'https://jqx28l0j4lx.feishu.cn/wiki/AutWwFvomi6e0Wk4K4Bcsa8Fnab',
  'https://jqx28l0j4lx.feishu.cn/wiki/CAKBwMjIXirLmTk3pS6cLJH7nhf',
  'https://jqx28l0j4lx.feishu.cn/wiki/DGnfwK27hi8xoDkRApDcyH2Znzc',
  'https://jqx28l0j4lx.feishu.cn/wiki/EDjBwAMrWicliKkCviDcVdwinOo',
  'https://jqx28l0j4lx.feishu.cn/wiki/F6Powz6rNiL8pnkVJmucoMrwnGb',
  'https://jqx28l0j4lx.feishu.cn/wiki/H21mweZ0SiGI8jkT5jKcygYzn6f',
  'https://jqx28l0j4lx.feishu.cn/wiki/Ia3JwQgkmiSO9DkFyeocI5K1nnd',
  'https://jqx28l0j4lx.feishu.cn/wiki/IhdwwBxFjiz0GFkNYiQctvh1nkc',
  'https://jqx28l0j4lx.feishu.cn/wiki/Ive2wnQy8isYyokHxuAcN7A5nRb',
  'https://jqx28l0j4lx.feishu.cn/wiki/Ixp3wYhguiid1wksVy0cPJzjnZg',
  'https://jqx28l0j4lx.feishu.cn/wiki/J0hewCx8Pi3kSAkqtUmcPcA2nOg',
  'https://jqx28l0j4lx.feishu.cn/wiki/Jejow2SyBiEeHXkm2WGcGTXwnkc',
  'https://jqx28l0j4lx.feishu.cn/wiki/JuCqw0plriEUEik8yeeciGu7nBe',
  'https://jqx28l0j4lx.feishu.cn/wiki/MsaVwO8vSig4ewkqPALcBINgncd',
  'https://jqx28l0j4lx.feishu.cn/wiki/NJDXwHVmbiQf4Kk6lNLcVO7FnWK',
  'https://jqx28l0j4lx.feishu.cn/wiki/OHXDwC9lniF4ckk8tiQcJowhnFd',
  'https://jqx28l0j4lx.feishu.cn/wiki/OITIwRkGziByCbkoIy3cmFmYnQf',
  'https://jqx28l0j4lx.feishu.cn/wiki/P0rcwonQNi9lDlkKfJScZdmhnSO',
  'https://jqx28l0j4lx.feishu.cn/wiki/P2PbwM5SLixMPNkJqfucsIWunKf',
  'https://jqx28l0j4lx.feishu.cn/wiki/PGl3w0y35iNhwcklyqwciL2DnMg',
  'https://jqx28l0j4lx.feishu.cn/wiki/PiU5wQbJMiOrZpkrWrCcfccwnoe',
  'https://jqx28l0j4lx.feishu.cn/wiki/Qz6mwkFjoialx7kNYXAcYGnDnSJ',
  'https://jqx28l0j4lx.feishu.cn/wiki/RByMwu1feiuC33kbiSqc0rbmnlf',
  'https://jqx28l0j4lx.feishu.cn/wiki/SRklwIYRVimFKjkfSQKcfZJknuf',
  'https://jqx28l0j4lx.feishu.cn/wiki/T5VLwALz1iLgSUk2UhXce19RnKd',
  'https://jqx28l0j4lx.feishu.cn/wiki/UNLZwRlbQimNzOkHktecMNvunyd',
  'https://jqx28l0j4lx.feishu.cn/wiki/VJQvwZiVgi8KXskbyfycIEg4nfg',
  'https://jqx28l0j4lx.feishu.cn/wiki/W7g8wUbFEifrC0k0qw8c3AY0nye',
  'https://jqx28l0j4lx.feishu.cn/wiki/XoX3wTpeQiTV8jkCncnciWzunwM',
  'https://jqx28l0j4lx.feishu.cn/wiki/Yo3rwPyCxiqdR6kARjtcphHYn4c',
  'https://jqx28l0j4lx.feishu.cn/wiki/ZbKKw3IQyiptGHk9rHickXsPnoe',
  'https://jqx28l0j4lx.feishu.cn/wiki/ZNmIwQbZpi1WJzk9HnGcM8san6g',
  // Visual standards and the live-centre knowledge tree are both module sources,
  // not standalone "sync" cards in the UI.
  'https://jqx28l0j4lx.feishu.cn/wiki/WWAuwezvxiw1NHkBJqAcqpx2nof'
]);
const communicationStages = Object.freeze(['暖场与痛点', '卖点与背书', '机制与售后', '第一轮逼单', '第二轮承接', '使用方法与换角度', '循环收口']);
const communicationProductBase = Object.freeze({
  baseToken:'RylnbGUF4aPi6is8LGqciehcn3g',
  tableId:'tblbLFaVrU5vCaej'
});
const communicationPersonas = Object.freeze(['成分理性型', '闺蜜种草型', '专业顾问型', '问答解惑型', '直球促单型']);
const communicationBroadcastModes = Object.freeze(['单播', '双播']);
const communicationPlatforms = Object.freeze(['抖音', '视频号']);
const recruitmentReviewerOpenId = process.env.RECRUITMENT_REVIEWER_OPEN_ID || 'ou_308a92748ac8b66de306a99b2010d755';
const recruitmentCalendarId = String(process.env.RECRUITMENT_CALENDAR_ID || '').trim();
const recruitmentCalendarReader = createCalendarUserReader({appId,appSecret,calendarId:recruitmentCalendarId,
  expectedOpenId:process.env.RECRUITMENT_CALENDAR_READER_OPEN_ID || '',
  redirectUri:process.env.RECRUITMENT_CALENDAR_OAUTH_REDIRECT_URI || '',
  storePath:process.env.RECRUITMENT_CALENDAR_OAUTH_STORE_PATH || '',
  encryptionKey:process.env.RECRUITMENT_CALENDAR_OAUTH_KEY || ''});
const calendarAuth = createCalendarAuthHandler({reader:recruitmentCalendarReader,basePath,readOnly:recoveryReadOnly,json});
const communicationProductSources = Object.freeze({
  '水润面膜': [
    'https://jqx28l0j4lx.feishu.cn/wiki/Jejow2SyBiEeHXkm2WGcGTXwnkc',
    'https://jqx28l0j4lx.feishu.cn/wiki/UNLZwRlbQimNzOkHktecMNvunyd'
  ],
  '晶润眼膜': [
    'https://jqx28l0j4lx.feishu.cn/wiki/Ia3JwQgkmiSO9DkFyeocI5K1nnd',
    'https://jqx28l0j4lx.feishu.cn/wiki/ZNmIwQbZpi1WJzk9HnGcM8san6g',
    'https://jqx28l0j4lx.feishu.cn/wiki/OITIwRkGziByCbkoIy3cmFmYnQf',
    'https://jqx28l0j4lx.feishu.cn/wiki/NJDXwHVmbiQf4Kk6lNLcVO7FnWK'
  ],
  '乳糖酸面膜': [
    'https://jqx28l0j4lx.feishu.cn/wiki/DGnfwK27hi8xoDkRApDcyH2Znzc',
    'https://jqx28l0j4lx.feishu.cn/wiki/F6Powz6rNiL8pnkVJmucoMrwnGb',
    'https://jqx28l0j4lx.feishu.cn/wiki/SRklwIYRVimFKjkfSQKcfZJknuf'
  ],
  '微针面膜': [
    'https://jqx28l0j4lx.feishu.cn/wiki/PiU5wQbJMiOrZpkrWrCcfccwnoe',
    'https://jqx28l0j4lx.feishu.cn/wiki/ALsQwaieWiClLxkTyOTcVUUNncN',
    'https://jqx28l0j4lx.feishu.cn/wiki/H21mweZ0SiGI8jkT5jKcygYzn6f'
  ],
  '深海次抛': [
    'https://jqx28l0j4lx.feishu.cn/wiki/AutWwFvomi6e0Wk4K4Bcsa8Fnab',
    'https://jqx28l0j4lx.feishu.cn/wiki/CAKBwMjIXirLmTk3pS6cLJH7nhf'
  ],
  '燕窝面膜': ['https://jqx28l0j4lx.feishu.cn/wiki/XoX3wTpeQiTV8jkCncnciWzunwM']
});
const moduleChatSources = Object.freeze({
  official_visual: 'WIS官旗-隐形水润面膜',
  selected_visual: 'WIS品牌精选直播间-晶润眼膜',
  preferred_visual: 'WIS优选-深海次抛/微针',
  wangou_visual: 'WIS鸥姐美肤甄选直播间设计',
  learning: 'WIS直播学习'
});
let tenantToken = { value: '', expiresAt: 0 };
const feishuCache = new Map();
const discoveredFeishuDocs = new Map();
const intelligenceState = { value: null, fingerprint: '', generatedAt: null, running: null, lastError: null };
const morningState = { value: null, date: '', generatedAt: null, running: null, lastError: null, lastAttemptDate: '' };
const moduleState = { value: null, fingerprint: '', generatedAt: null, running: null, lastError: null };
const lifecycleState = { running: null, lastAutomaticSlot: '', lastAttemptAt: null, lastError: null };
class FeishuError extends Error { constructor(message, status = 502, details = '') { super(message); this.status = status; this.details = details; } }
function json(res, status, payload) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(payload)); }
async function getTenantToken() {
  if (!feishuReady()) throw new FeishuError('服务器尚未配置 Coco 应用凭据。', 503, 'missing_feishu_credentials');
  if (tenantToken.value && tenantToken.expiresAt > Date.now() + 5 * 60 * 1000) return tenantToken.value;
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/', {
    method: 'POST', headers: {'Content-Type':'application/json; charset=utf-8'}, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({app_id: appId, app_secret: appSecret})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) throw new FeishuError(payload.msg || '无法获取飞书应用访问凭证。', 502, `feishu_${payload.code || response.status}`);
  tenantToken = { value: payload.tenant_access_token, expiresAt: Date.now() + Math.max(300, Number(payload.expire || 7200)) * 1000 };
  return tenantToken.value;
}
async function feishuGet(path) {
  const token = await getTenantToken();
  const response = await fetch(`https://open.feishu.cn/open-apis${path}`, { headers: {Authorization:`Bearer ${token}`}, signal: AbortSignal.timeout(12000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) throw new FeishuError(payload.msg || '飞书接口请求失败。', response.status === 403 ? 403 : 502, `feishu_${payload.code || response.status}`);
  return payload.data || {};
}
async function feishuPost(path, body) {
  const token = await getTenantToken();
  const response = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json; charset=utf-8'},
    signal:AbortSignal.timeout(12000),
    body:JSON.stringify(body || {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) throw new FeishuError(payload.msg || '飞书接口请求失败。', response.status === 403 ? 403 : 502, `feishu_${payload.code || response.status}`);
  return payload.data || {};
}
async function getMessageReactions(messageIds) {
  const byMessage = new Map();
  for (let index = 0; index < messageIds.length; index += 20) {
    const ids = messageIds.slice(index, index + 20).filter(Boolean);
    if (!ids.length) continue;
    const data = await feishuPost('/im/v1/messages/reactions/batch_query?user_id_type=open_id', {
      queries:ids.map(message_id => ({message_id})), page_size_per_message:10
    });
    const counts = new Map((data.success_msg_reaction_counts || []).map(item => [item.message_id, (item.reaction_count || []).map(row => ({reactionType:row.reaction_type,count:Number(row.count || 0)}))]));
    const details = new Map((data.success_msg_reaction_details || []).map(item => [item.message_id, (item.message_reaction_items || []).map(row => ({emojiType:row.emoji_type,actionTime:row.action_time,operatorId:row.operator?.operator_id || row.operator?.open_id || row.operator?.id || ''}))]));
    ids.forEach(id => byMessage.set(id, {counts:counts.get(id) || [],details:details.get(id) || []}));
  }
  return byMessage;
}
async function cached(key, ttl, loader) {
  const hit = feishuCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await loader();
  feishuCache.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}
function parseMessageContent(raw) { try { return JSON.parse(raw || '{}'); } catch { return { text: String(raw || '') }; } }
function messageText(value) {
  const parts = [];
  const visit = item => {
    if (typeof item === 'string') return;
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== 'object') return;
    if (typeof item.text === 'string') parts.push(item.text);
    if (typeof item.title === 'string') parts.push(item.title);
    Object.entries(item).forEach(([key, child]) => { if (!['text','title','image_key','file_key'].includes(key)) visit(child); });
  };
  visit(value);
  return [...new Set(parts.map(part => part.trim()).filter(Boolean))].join('\n').slice(0, 8000);
}
function messageResources(value) {
  const resources = [];
  const visit = item => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== 'object') return;
    if (typeof item.image_key === 'string') resources.push({type:'image',key:item.image_key});
    if (typeof item.file_key === 'string') resources.push({type:'file',key:item.file_key,name:typeof item.file_name === 'string' ? item.file_name : ''});
    Object.values(item).forEach(visit);
  };
  visit(value);
  return resources.slice(0, 20);
}
async function getChatMessages(sourceKey, limit = 20, timeRange = {}) {
  const source = feishuChats[sourceKey];
  if (!source) throw new FeishuError('未知的群聊数据源。', 404, 'unknown_chat_source');
  const requested = Math.min(500, Math.max(1, Number(limit) || 20));
  const startTime = Math.max(0, Number(timeRange.startTime || timeRange.start_time) || 0);
  const endTime = Math.max(0, Number(timeRange.endTime || timeRange.end_time) || 0);
  return cached(`chat:${sourceKey}:${requested}:${startTime}:${endTime}`, 60 * 1000, async () => {
    const items = [];
    let pageToken = '';
    for (let page = 0; page < Math.ceil(requested / 50); page += 1) {
      const params = new URLSearchParams({container_id_type:'chat',container_id:source.chatId,sort_type:'ByCreateTimeDesc',page_size:String(Math.min(50, requested - items.length))});
      if (startTime) params.set('start_time', String(Math.floor(startTime)));
      if (endTime) params.set('end_time', String(Math.floor(endTime)));
      if (pageToken) params.set('page_token', pageToken);
      const data = await feishuGet(`/im/v1/messages?${params}`);
      items.push(...(data.items || []));
      pageToken = data.page_token || '';
      if (!data.has_more || !pageToken || items.length >= requested) break;
    }
    let reactions = new Map(); let reactionStatus = sourceKey === 'recruitment' ? '待读取' : '不适用'; let reactionFailure = '';
    if (sourceKey === 'recruitment') {
      try { reactions = await getMessageReactions(items.slice(0, requested).map(item => item.message_id)); reactionStatus = '已核验'; }
      catch (error) { reactionStatus = '待授权'; reactionFailure = String(error?.message || '表情读取失败'); }
    }
    const messages = items.slice(0, requested).map(item => {
      const content = parseMessageContent(item.body?.content);
      return {
        messageId: item.message_id,
        chatId: item.chat_id,
        type: item.msg_type,
        text: messageText(content),
        sender: { id: item.sender?.id || '', name: item.sender?.sender_name || item.sender?.name || '' },
        createdAt: item.create_time ? new Date(Number(item.create_time)).toISOString() : null,
        updatedAt: item.update_time ? new Date(Number(item.update_time)).toISOString() : null,
        resources: messageResources(content),
        reactions: reactions.get(item.message_id),
        position: String(item.message_position || ''),
        appLink: item.message_position ? `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(item.chat_id || source.chatId)}&position=${encodeURIComponent(item.message_position)}` : ''
      };
    });
    return { key: sourceKey, name: source.name, chatId: source.chatId, messages, fetchedAt: new Date().toISOString(), reactionStatus, reactionFailure };
  });
}
async function findChatByName(name) {
  return cached(`chat-name:${name}`, 15 * 60 * 1000, async () => {
    let pageToken = '';
    for (let page = 0; page < 4; page += 1) {
      const params = new URLSearchParams({page_size:'100'});
      if (pageToken) params.set('page_token', pageToken);
      const data = await feishuGet(`/im/v1/chats?${params}`);
      const match = (data.items || []).find(item => item?.name === name);
      if (match?.chat_id) return {name, chatId:match.chat_id};
      pageToken = data.page_token || '';
      if (!data.has_more || !pageToken) break;
    }
    throw new FeishuError(`Coco 无法在已授权会话中找到群聊：${name}`, 404, 'chat_not_found');
  });
}
function normalizeChatMessage(item) {
  const content = parseMessageContent(item.body?.content);
  return {
    messageId: item.message_id,
    chatId: item.chat_id,
    type: item.msg_type,
    text: messageText(content),
    sender: { id: item.sender?.id || '', name: item.sender?.sender_name || item.sender?.name || '' },
    createdAt: item.create_time ? new Date(Number(item.create_time)).toISOString() : null,
    updatedAt: item.update_time ? new Date(Number(item.update_time)).toISOString() : null,
    resources: messageResources(content),
    position: String(item.message_position || ''),
    appLink: item.message_position ? `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(item.chat_id || '')}&position=${encodeURIComponent(item.message_position)}` : ''
  };
}
async function getNamedChatMessages(sourceKey, limit = 30) {
  const name = moduleChatSources[sourceKey];
  if (!name) throw new FeishuError('未知的模块群聊数据源。', 404, 'unknown_module_chat');
  const pageSize = Math.min(50, Math.max(1, Number(limit) || 30));
  return cached(`named-chat:${sourceKey}:${pageSize}`, 90 * 1000, async () => {
    const chat = await findChatByName(name);
    const params = new URLSearchParams({container_id_type:'chat',container_id:chat.chatId,sort_type:'ByCreateTimeDesc',page_size:String(pageSize)});
    const data = await feishuGet(`/im/v1/messages?${params}`);
    return {key:sourceKey,name,chatId:chat.chatId,messages:(data.items || []).map(normalizeChatMessage),fetchedAt:new Date().toISOString()};
  });
}
async function getDocument(sourceKey) {
  const source = feishuDocs[sourceKey];
  if (!source) throw new FeishuError('未知的文档数据源。', 404, 'unknown_doc_source');
  return cached(`doc:${sourceKey}`, 5 * 60 * 1000, async () => {
    const node = (await feishuGet(`/wiki/v2/spaces/get_node?token=${encodeURIComponent(source.token)}`)).node || {};
    if (node.obj_type !== 'docx' || !node.obj_token) throw new FeishuError(`暂不支持该文档类型：${node.obj_type || 'unknown'}`, 422, 'unsupported_doc_type');
    const raw = await feishuGet(`/docx/v1/documents/${encodeURIComponent(node.obj_token)}/raw_content`);
    return { key: sourceKey, name: source.name, title: node.title || source.name, sourceUrl: source.sourceUrl, revisionId: raw.revision_id || null, content: String(raw.content || '').slice(0, 200000), fetchedAt: new Date().toISOString() };
  });
}
function sourceUrl(rawValue) {
  let value;
  try { value = new URL(String(rawValue || '')); } catch { throw new FeishuError('Invalid Feishu source URL.', 400, 'invalid_source_url'); }
  if (value.protocol !== 'https:') throw new FeishuError('Only HTTPS Feishu resources are allowed.', 400, 'invalid_source_protocol');
  const allowed = new Set(['jqx28l0j4lx.feishu.cn', 'internal-api-drive-stream.feishu.cn', 'internal-api-lark-file.feishu.cn']);
  if (!allowed.has(value.hostname)) throw new FeishuError('Feishu source host is not allowed.', 403, 'source_host_denied');
  return value;
}
async function getDocumentByUrl(rawValue) {
  const value = sourceUrl(rawValue);
  const wiki = value.pathname.match(/^\/wiki\/([A-Za-z0-9_-]+)/);
  const docx = value.pathname.match(/^\/docx\/([A-Za-z0-9_-]+)/);
  let token = '';
  let title = 'Feishu document';
  if (wiki) {
    const node = (await feishuGet(`/wiki/v2/spaces/get_node?token=${encodeURIComponent(wiki[1])}`)).node || {};
    if (node.obj_type !== 'docx' || !node.obj_token) throw new FeishuError(`Unsupported Feishu document type: ${node.obj_type || 'unknown'}`, 422, 'unsupported_doc_type');
    token = node.obj_token;
    title = node.title || title;
  } else if (docx) {
    token = docx[1];
  } else {
    throw new FeishuError('Only Feishu wiki and docx links are supported.', 400, 'unsupported_document_url');
  }
  const raw = await feishuGet(`/docx/v1/documents/${encodeURIComponent(token)}/raw_content`);
  const document = { title, content: String(raw.content || '').slice(0, 500000), sourceUrl: value.toString() };
  discoveredFeishuDocs.set(document.sourceUrl, document);
  return document;
}
const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
async function documentViewer(res, rawValue) {
  const document = await cached(`doc-url:${rawValue}`, 5 * 60 * 1000, () => getDocumentByUrl(rawValue));
  const content = htmlEscape(document.content);
  const title = htmlEscape(document.title);
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f5f6f2;color:#17372c;font:15px/1.8 Inter,"PingFang SC","Microsoft YaHei",sans-serif}.bar{position:sticky;top:0;background:#123f32;color:#fff;padding:14px 24px;font-weight:700}.doc{max-width:1040px;margin:22px auto;padding:34px 42px;background:#fff;border:1px solid #dfe5df;border-radius:16px;box-shadow:0 8px 28px #17372c12}.doc h1{margin-top:0}.content{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:700px){.doc{margin:0;padding:22px;border-radius:0}}</style></head><body><div class="bar">LIVE HUB · Coco 文档读取</div><main class="doc"><h1>${title}</h1><div class="content">${content}</div></main></body></html>`;
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'});
  res.end(body);
}
async function proxyFeishuResource(req, res, rawValue) {
  const value = sourceUrl(rawValue);
  let apiPath = '';
  if (value.hostname === 'internal-api-drive-stream.feishu.cn') {
    const match = value.pathname.match(/\/cover\/([A-Za-z0-9_-]+)/);
    if (!match) throw new FeishuError('Unsupported Feishu Drive image URL.', 400, 'unsupported_drive_url');
    apiPath = `/drive/v1/medias/${encodeURIComponent(match[1])}/download`;
  } else if (value.hostname === 'internal-api-lark-file.feishu.cn') {
    const match = value.pathname.match(/\/download\/messages\/([A-Za-z0-9_-]+)\/keys\/([A-Za-z0-9_-]+)/);
    if (!match) throw new FeishuError('Unsupported Feishu message resource URL.', 400, 'unsupported_message_resource_url');
    apiPath = `/im/v1/messages/${encodeURIComponent(match[1])}/resources/${encodeURIComponent(match[2])}?type=file`;
  } else {
    throw new FeishuError('The URL is not a downloadable Feishu resource.', 400, 'unsupported_resource_url');
  }
  const token = await getTenantToken();
  const headers = {Authorization:`Bearer ${token}`};
  if (req.headers.range) headers.Range = req.headers.range;
  const response = await fetch(`https://open.feishu.cn/open-apis${apiPath}`, {headers, signal:AbortSignal.timeout(30000)});
  if (!response.ok || !response.body) {
    const details = await response.text().catch(() => '');
    throw new FeishuError('Coco could not download the Feishu resource.', response.status === 403 ? 403 : 502, details.slice(0, 300));
  }
  const outputHeaders = {'Content-Type':response.headers.get('content-type') || 'application/octet-stream','Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'};
  for (const name of ['content-length','content-range','accept-ranges']) { const header = response.headers.get(name); if (header) outputHeaders[name] = header; }
  res.writeHead(response.status, outputHeaders);
  Readable.fromWeb(response.body).pipe(res);
}
async function proxyFeishuMessageResource(req, res, messageId, resourceKey, resourceType) {
  if (!/^om_[A-Za-z0-9_-]{8,256}$/.test(messageId || '') || !/^[A-Za-z0-9_-]{8,256}$/.test(resourceKey || '') || !['image','file'].includes(resourceType)) {
    throw new FeishuError('Invalid Feishu message resource reference.', 400, 'invalid_message_resource');
  }
  const token = await getTenantToken();
  const headers = {Authorization:`Bearer ${token}`};
  if (req.headers.range) headers.Range = req.headers.range;
  const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(resourceKey)}?type=${resourceType}`, {headers, signal:AbortSignal.timeout(30000)});
  if (!response.ok || !response.body) throw new FeishuError('Coco could not download the Feishu message resource.', response.status === 403 ? 403 : 502, `resource_${response.status}`);
  const outputHeaders = {'Content-Type':response.headers.get('content-type') || 'application/octet-stream','Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'};
  for (const name of ['content-length','content-range','accept-ranges']) { const header = response.headers.get(name); if (header) outputHeaders[name] = header; }
  res.writeHead(response.status, outputHeaders);
  Readable.fromWeb(response.body).pipe(res);
}
async function feishuApi(req, res, url, routePath) {
  try {
    if (routePath === '/api/feishu/status') {
      await getTenantToken();
      return json(res, 200, {ok:true, appId, bot:notificationBotIdentityMatches() ? '品牌营销部中枢' : 'unverified', configured:true, notificationBotIdentityMatches:notificationBotIdentityMatches(), notificationSourceChats:{recruitment:feishuChats.recruitment.name,coaching:feishuChats.coaching.name}, chats:Object.keys(feishuChats), documents:Object.keys(feishuDocs)});
    }
    const chatMatch = routePath.match(/^\/api\/feishu\/chats\/([a-z_]+)\/messages$/);
    if (chatMatch) return json(res, 200, {ok:true, data:await getChatMessages(chatMatch[1], url.searchParams.get('limit'), {
      start_time: url.searchParams.get('start_time'),
      end_time: url.searchParams.get('end_time')
    })});
    const docMatch = routePath.match(/^\/api\/feishu\/documents\/([a-z_]+)$/);
    if (docMatch) return json(res, 200, {ok:true, data:await getDocument(docMatch[1])});
    // Await streamed Feishu routes inside this try/catch. Returning their promise
    // directly would let a rejected upstream request bypass this error boundary.
    if (routePath === '/api/feishu/view') return await documentViewer(res, url.searchParams.get('url'));
    if (routePath === '/api/feishu/resource') return await proxyFeishuResource(req, res, url.searchParams.get('url'));
    if (routePath === '/api/feishu/message-resource') return await proxyFeishuMessageResource(req, res, url.searchParams.get('messageId'), url.searchParams.get('resourceKey'), url.searchParams.get('type') || 'file');
    if (routePath === '/api/feishu/summary') {
      const [recruitment, coaching, morning, wangou] = await Promise.allSettled([
        getChatMessages('recruitment', 15), getChatMessages('coaching', 15), getChatMessages('morning', 15), getDocument('morning_wangou')
      ]);
      const value = result => result.status === 'fulfilled' ? result.value : {error:result.reason?.message || '读取失败',details:result.reason?.details || ''};
      return json(res, 200, {ok:true,data:{chats:{recruitment:value(recruitment),coaching:value(coaching),morning:value(morning)},documents:{morning_wangou:value(wangou)},fetchedAt:new Date().toISOString()}});
    }
    return json(res, 404, {ok:false,error:'API route not found'});
  } catch (error) {
    console.error('feishu api failed', error.details || error.message);
    return json(res, error.status || 500, {ok:false,error:error.message || '服务器读取飞书失败。',code:error.details || 'internal_error'});
  }
}
const jumpLlmReady = () => Boolean(jumpLlmUrl && jumpLlmToken && jumpLlmApplication && jumpLlmProvider && jumpLlmModel);
const minimaxReady = () => jumpLlmReady() || Boolean(minimaxApiKey);
const activeAnalysisModel = () => jumpLlmReady() ? jumpLlmModel : minimaxModel;
const communicationAnalysisModel = () => jumpLlmReady() ? jumpLlmFallbackModel : minimaxModel;
const truncateForModel = (value, limit) => String(value || '').replace(/\u0000/g, '').slice(0, limit);
async function collectInBatches(items, batchSize, loader) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = await Promise.allSettled(items.slice(index, index + batchSize).map(loader));
    results.push(...batch);
  }
  return results;
}
function parseModelJson(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('MiniMax did not return a JSON object.');
  return JSON.parse(text.slice(start, end + 1));
}
function completionContent(body, rawResponse) {
  const direct = body?.choices?.[0]?.message?.content || body?.choices?.[0]?.text || body?.output_text;
  if (direct) return direct;
  const chunks = [];
  for (const line of String(rawResponse || '').split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const value = line.slice(5).trim();
    if (!value || value === '[DONE]') continue;
    try { const chunk = JSON.parse(value); const text = chunk?.choices?.[0]?.delta?.content || chunk?.choices?.[0]?.text; if (text) chunks.push(text); } catch { /* Ignore non-JSON SSE keepalive lines. */ }
  }
  return chunks.join('');
}
async function callMiniMaxJson(instruction, payload, maxTokens = 8192, options = {}) {
  if (!minimaxReady()) throw new FeishuError('MiniMax server configuration is missing.', 503, 'missing_minimax_credentials');
  const messages = [{ role: 'system', content: instruction }, { role: 'user', content: JSON.stringify(payload) }];
  const providers = [];
  if (jumpLlmReady()) {
    const orderedModels = options.fast
      ? [jumpLlmFallbackModel, jumpLlmModel]
      : [jumpLlmModel, jumpLlmFallbackModel];
    for (const model of [...new Set(orderedModels.filter(Boolean))]) providers.push({kind:'jump',model,label:model === jumpLlmModel ? 'jump' : 'jump_fallback'});
  }
  if (minimaxApiKey) providers.push({kind:'minimax',model:minimaxModel,label:'minimax'});
  let lastError = null;
  for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
    const provider = providers[providerIndex];
    const usingJump = provider.kind === 'jump';
    const hasFallback = providerIndex < providers.length - 1;
    try {
      const response = await fetch(usingJump ? jumpLlmUrl : `${minimaxBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: usingJump ? jumpLlmToken : `Bearer ${minimaxApiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(minimaxTimeoutMs),
        body: JSON.stringify(usingJump ? {
          application: jumpLlmApplication,
          event: 'text',
          provider: jumpLlmProvider,
          requests_data: { model: provider.model, messages, temperature: 0.1, max_tokens: maxTokens, stream: false, response_format:{type:'json_object'}, ...(options.fast ? {extra_body:{thinking:{type:'disabled'}}} : {}) },
        } : { model: provider.model, messages, temperature: 0.1, max_tokens: maxTokens, stream: false, response_format:{type:'json_object'} })
      });
      const rawResponse = await response.text();
      let body;
      try { body = JSON.parse(rawResponse); } catch { body = { raw: rawResponse }; }
      if (!response.ok) {
        const error = new FeishuError('AI analysis request failed.', 502, `${provider.label}_${response.status}`);
        if (hasFallback && (response.status === 429 || response.status >= 500)) { lastError = error; continue; }
        throw error;
      }
      const content = completionContent(body, rawResponse) || body?.raw;
      try { return parseModelJson(content); }
      catch {
        const message = body?.choices?.[0]?.message || {};
        const finish = String(body?.choices?.[0]?.finish_reason || 'unknown').replace(/[^a-z0-9_-]/giu, '').slice(0, 32) || 'unknown';
        throw new FeishuError('AI 未返回完整的结构化结果，请重试。', 502, `model_output_${provider.label}_${finish}_content_${String(message.content || '').length}_reasoning_${String(message.reasoning_content || '').length}`);
      }
    } catch (error) {
      if (hasFallback && (String(error?.details || '').match(/^jump(?:_fallback)?_(?:429|5\d\d)$/u) || error?.name === 'TimeoutError')) { lastError = error; continue; }
      throw error;
    }
  }
  throw lastError || new FeishuError('AI analysis request failed.', 502, 'no_available_model_provider');
}
function normalizeIntelligence(payload, coverage) {
  const array = value => Array.isArray(value) ? value.slice(0, 30) : [];
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    overview: truncateForModel(payload?.overview || payload?.summary || '暂无可用摘要。', 2400),
    urgent: array(payload?.urgent || payload?.risks).map(object),
    actionItems: array(payload?.actionItems || payload?.actions || payload?.todos).map(object),
    schedule: array(payload?.schedule || payload?.scheduling).map(object),
    recruitment: array(payload?.recruitment).map(object),
    content: array(payload?.content || payload?.materials).map(object),
    coverage,
    generatedAt: new Date().toISOString(),
    model: activeAnalysisModel()
  };
}
function compactIntelligenceSources(sources) {
  return sources.map(source => source.kind === 'chat' ? {
    ...source,
    messages:(source.messages || []).slice(0, 8).map(message => ({
      ...message,
      text:truncateForModel(message.text, 500)
    }))
  } : {
    ...source,
    content:truncateForModel(source.content, 600)
  });
}
async function collectIntelligenceSources() {
  const chatResults = await Promise.allSettled(Object.keys(feishuChats).map(key => getChatMessages(key, 50)));
  const fixedDocs = await Promise.allSettled(Object.keys(feishuDocs).map(key => getDocument(key)));
  const materialDocs = await collectInBatches(materialFeishuDocUrls, 5, source => cached(`intelligence:doc-url:${source}`, 15 * 60 * 1000, () => getDocumentByUrl(source)));
  const chatSources = chatResults.filter(result => result.status === 'fulfilled').map(result => ({
    kind: 'chat', name: result.value.name, sourceId: result.value.chatId, fetchedAt: result.value.fetchedAt,
    messages: result.value.messages.map(message => ({ sender: message.sender?.name || message.sender?.id || '群成员', createdAt: message.createdAt, text: truncateForModel(message.text, 1200) }))
  }));
  const documents = [...fixedDocs, ...materialDocs].filter(result => result.status === 'fulfilled').map(result => ({
    kind: 'document', title: result.value.title || result.value.name || '飞书文档', sourceUrl: result.value.sourceUrl,
    fetchedAt: result.value.fetchedAt || new Date().toISOString(), content: truncateForModel(result.value.content, 6000)
  }));
  for (const document of discoveredFeishuDocs.values()) {
    if (!documents.some(item => item.sourceUrl === document.sourceUrl)) documents.push({ kind: 'document', title: document.title, sourceUrl: document.sourceUrl, fetchedAt: new Date().toISOString(), content: truncateForModel(document.content, 6000) });
  }
  const failures = [...chatResults, ...fixedDocs, ...materialDocs].filter(result => result.status === 'rejected').map(result => truncateForModel(result.reason?.message || '读取失败', 240));
  return { sources: [...chatSources, ...documents], coverage: { chats: chatSources.length, documents: documents.length, failures, fetchedAt: new Date().toISOString() } };
}
async function generateIntelligence(force = false) {
  if (!minimaxReady()) throw new FeishuError('MiniMax server configuration is missing.', 503, 'missing_minimax_credentials');
  const maxAge = intelligenceRefreshMinutes * 60 * 1000;
  if (!force && intelligenceState.value && intelligenceState.generatedAt && Date.now() - Date.parse(intelligenceState.generatedAt) < maxAge) return intelligenceState.value;
  if (intelligenceState.running) return intelligenceState.running;
  intelligenceState.running = (async () => {
    const collected = await collectIntelligenceSources();
    const fingerprint = createHash('sha256').update(JSON.stringify(collected.sources)).digest('hex');
    if (!force && intelligenceState.value && intelligenceState.fingerprint === fingerprint) return intelligenceState.value;
    const instruction = `你是直播中心工作台的运营情报分析师。根据下方由企业飞书群聊和文档读取的资料，输出严格合法的 JSON，不要 Markdown、不要解释。字段必须是 overview(string), urgent(array), actionItems(array), schedule(array), recruitment(array), content(array)。数组每项都应尽量包含 title、priority/owner/due（若资料没有则空字符串）、evidence、source、recommendedAction。只报告资料明确支持的事实；无法判断要标记“待确认”。按优先级排序，中文输出。`;
    const value = normalizeIntelligence(await callMiniMaxJson(instruction, {
      generatedAt: collected.coverage.fetchedAt,
      sources: compactIntelligenceSources(collected.sources)
    }, 2500), collected.coverage);
    intelligenceState.value = value;
    intelligenceState.fingerprint = fingerprint;
    intelligenceState.generatedAt = value.generatedAt;
    intelligenceState.lastError = null;
    return value;
  })();
  try { return await intelligenceState.running; }
  catch (error) { intelligenceState.lastError = { message: error.message || 'MiniMax analysis failed', at: new Date().toISOString() }; throw error; }
  finally { intelligenceState.running = null; }
}
async function intelligenceApi(req, res, url, routePath) {
  try {
    if (routePath === '/api/intelligence/status') return json(res, 200, { ok: true, configured: minimaxReady(), model: activeAnalysisModel(), refreshMinutes: intelligenceRefreshMinutes, generatedAt: intelligenceState.generatedAt, running: Boolean(intelligenceState.running), lastError: intelligenceState.lastError, coverage: intelligenceState.value?.coverage || null });
    if (routePath === '/api/intelligence/briefing') return json(res, 200, { ok: true, data: await generateIntelligence(url.searchParams.get('refresh') === '1') });
    return json(res, 404, { ok: false, error: 'Intelligence API route not found' });
  } catch (error) {
    console.error('intelligence api failed', error.details || error.message);
    return json(res, error.status || 500, { ok: false, error: error.message || 'AI 情报处理失败。', code: error.details || 'intelligence_error' });
  }
}
function moduleResourceUrl(messageId, resource) {
  const params = new URLSearchParams({messageId:String(messageId || ''),resourceKey:String(resource?.key || ''),type:resource?.type === 'image' ? 'image' : 'file'});
  return `${basePath}/api/feishu/message-resource?${params}`;
}
function publicModuleChat(chat) {
  return {
    key: chat.key,
    name: chat.name,
    fetchedAt: chat.fetchedAt,
    messages: chat.messages.map(message => ({
      messageId: message.messageId,
      text: truncateForModel(message.text, 3200),
      sender: message.sender?.name || message.sender?.id || '群成员',
      createdAt: message.createdAt,
      resources: (message.resources || []).map(resource => ({...resource,url:moduleResourceUrl(message.messageId, resource)}))
    }))
  };
}
function normalizeModulePlacement(payload, sourceIds) {
  const items = Array.isArray(payload?.placements) ? payload.placements : [];
  return items.slice(0, 80).map(item => ({
    module: ['recruitment','anchors','materials','collaboration'].includes(item?.module) ? item.module : 'collaboration',
    section: truncateForModel(item?.section || '', 80),
    title: truncateForModel(item?.title || item?.summary || '', 240),
    evidence: truncateForModel(item?.evidence || '', 1000),
    priority: truncateForModel(item?.priority || '常规', 24),
    sourceId: sourceIds.has(String(item?.sourceId || '')) ? String(item.sourceId) : ''
  })).filter(item => item.title && item.sourceId);
}
async function generateModuleData(force = false) {
  const maxAge = intelligenceRefreshMinutes * 60 * 1000;
  if (!force && moduleState.value && moduleState.generatedAt && Date.now() - Date.parse(moduleState.generatedAt) < maxAge) return moduleState.value;
  if (moduleState.running) return moduleState.running;
  moduleState.running = (async () => {
    const namedKeys = Object.keys(moduleChatSources).filter(key => key !== 'learning');
    const recruitmentEndTime = Math.ceil(Date.now() / 1000);
    const recruitmentStartTime = recruitmentEndTime - 16 * 24 * 60 * 60;
    const learningStartTime = recruitmentEndTime - 3 * 24 * 60 * 60;
    const [recruitment, coaching, learning, ...namedResults] = await Promise.allSettled([
      getChatMessages('recruitment', 500, {startTime:recruitmentStartTime,endTime:recruitmentEndTime}),
      getChatMessages('coaching', 50),
      getChatMessages('learning', 200, {startTime:learningStartTime,endTime:recruitmentEndTime}),
      ...namedKeys.map(key => getNamedChatMessages(key, 50))
    ]);
    const sourceResults = [recruitment, coaching, learning, ...namedResults];
    const chats = sourceResults.filter(result => result.status === 'fulfilled').map(result => publicModuleChat(result.value));
    const materialDocs = await Promise.allSettled([
      getDocumentByUrl('https://jqx28l0j4lx.feishu.cn/wiki/ZbKKw3IQyiptGHk9rHickXsPnoe'),
      getDocumentByUrl('https://jqx28l0j4lx.feishu.cn/wiki/WWAuwezvxiw1NHkBJqAcqpx2nof')
    ]);
    const documents = materialDocs.filter(result => result.status === 'fulfilled').map(result => ({
      sourceId: `doc:${result.value.sourceUrl}`,
      title: result.value.title,
      sourceUrl: result.value.sourceUrl,
      content: truncateForModel(result.value.content, 30000)
    }));
    const failures = [...sourceResults, ...materialDocs].filter(result => result.status === 'rejected').map(result => truncateForModel(result.reason?.message || '读取失败', 240));
    const sourceIds = new Set([
      ...chats.flatMap(chat => chat.messages.map(message => message.messageId)),
      ...documents.map(document => document.sourceId)
    ]);
    const compactSources = chats.map(chat => ({
      sourceId: chat.key,
      name: chat.name,
      messages: chat.messages.map(message => ({sourceId:message.messageId,createdAt:message.createdAt,sender:message.sender,text:truncateForModel(message.text, 1400),hasImage:message.resources.some(resource => resource.type === 'image'),hasFile:message.resources.some(resource => resource.type === 'file')}))
    }));
    const fingerprint = createHash('sha256').update(JSON.stringify({compactSources,documents})).digest('hex');
    if (!force && moduleState.value && moduleState.fingerprint === fingerprint) return moduleState.value;
    let placements = [];
    if (!recoveryReadOnly && minimaxReady()) {
      const instruction = `你是直播中心工作台的信息分发器。仅根据已授权飞书群聊和文档，输出严格 JSON：{placements:[{module,section,title,evidence,priority,sourceId}]}。module 只能是 recruitment、anchors、materials、collaboration。将候选人、面试、简历和录屏放 recruitment；主播表现、转化、排班放 anchors；妆造、背景、手卡、竞对、学习素材放 materials；违规、异常、待处理风险放 collaboration。只输出有明确证据的信息；不得创建“飞书同步”“AI洞察”栏目，不得臆造数值、人员或链接。sourceId 必须是给定消息或文档的 sourceId。`;
      try { placements = normalizeModulePlacement(await callMiniMaxJson(instruction, {chats:compactSources,documents}, 8192), sourceIds); }
      catch (error) { console.error('module placement analysis failed', error.details || error.message); }
    }
    const value = { generatedAt:new Date().toISOString(), refreshMinutes:intelligenceRefreshMinutes, chats, documents:documents.map(({sourceId,title,sourceUrl}) => ({sourceId,title,sourceUrl})), placements, coverage:{chats:chats.length,documents:documents.length,failures}, ...(recoveryReadOnly ? {aiGeneration:{status:'paused_recovery',message:'维护恢复中，AI 摘要已暂停；已授权的原始来源仍可读取。'}} : {}) };
    moduleState.value = value; moduleState.fingerprint = fingerprint; moduleState.generatedAt = value.generatedAt; moduleState.lastError = null;
    return value;
  })();
  try { return await moduleState.running; }
  catch (error) { moduleState.lastError = {message:error.message || 'module data generation failed',at:new Date().toISOString()}; throw error; }
  finally { moduleState.running = null; }
}
async function moduleDataApi(req, res, url, routePath) {
  try {
    if (routePath === '/api/modules/status') return json(res, 200, {ok:true,generatedAt:moduleState.generatedAt,running:Boolean(moduleState.running),lastError:moduleState.lastError,refreshMinutes:intelligenceRefreshMinutes,coverage:moduleState.value?.coverage || null});
    if (routePath === '/api/modules/live-data') return json(res, 200, {ok:true,data:await generateModuleData(url.searchParams.get('refresh') === '1')});
    return json(res, 404, {ok:false,error:'Module data API route not found'});
  } catch (error) {
    console.error('module data api failed', error.details || error.message);
    return json(res, error.status || 500, {ok:false,error:error.message || '模块数据处理失败。',code:error.details || 'module_data_error'});
  }
}
function chinaDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const pick = type => parts.find(item => item.type === type)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
function chinaMinutes(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const pick = type => Number(parts.find(item => item.type === type)?.value || 0);
  return pick('hour') * 60 + pick('minute');
}
async function readMorningReport(date) {
  try { return JSON.parse(await readFile(join(morningDir, `${date}.json`), 'utf8')); } catch { return null; }
}
async function saveMorningReport(report) {
  await mkdir(morningDir, { recursive: true });
  const target = join(morningDir, `${report.date}.json`);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(report), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
}
function morningArray(value) { return Array.isArray(value) ? value : []; }
function normalizeMorningReport(payload, date, coverage) {
  const validRoomNames = ['官旗', '品牌精选', '优选', '王鸥美肤'];
  const rooms = morningArray(payload?.rooms).map(item => {
    const people = morningArray(item?.people).slice(0, 12).map(person => Array.isArray(person) ? person : [person?.name || '待确认', person?.score ?? '—', person?.resource || '待确认', Number.isFinite(person?.delta) ? person.delta : null, person?.evaluation || person?.evidence || '待确认']);
    return { name: String(item?.name || '待确认'), owner: String(item?.owner || '待确认'), people, reason: String(item?.reason || item?.summary || '待确认') };
  });
  for (const name of validRoomNames) if (!rooms.some(room => room.name === name)) rooms.push({ name, owner: '待确认', people: [], reason: '07:00—09:10 已检查当前授权资料，暂未获得可核验日报；不会使用旧数据替代。' });
  const actions = morningArray(payload?.actions).slice(0, 12).map(item => Array.isArray(item) ? item : [item?.title || item?.task || '待确认事项', item?.evidence || item?.detail || '', item?.priority || '跟进']);
  const agenda = morningArray(payload?.agenda).slice(0, 20).map(item => Array.isArray(item) ? item : [item?.start || '全天', item?.title || item?.name || '待确认日程', item?.end || '']);
  const bubbles = morningArray(payload?.bubbles).slice(0, 8).map(item => Array.isArray(item) ? item : [item?.room || item?.title || '直播间', item?.status || '视觉无变化', item?.detail || item?.evidence || '无异常直播间']);
  const names = morningArray(payload?.gmvNames).map(String).slice(0, 30);
  const gmv = morningArray(payload?.gmv).map(Number).filter(Number.isFinite).slice(0, names.length);
  return { date, review: String(payload?.review || `复盘 ${date}`), checked: String(payload?.checked || '09:10补查'), sourceWindow: '07:00—09:10 · 09:10 GMV补查', roomOrder: validRoomNames, gmvNames: gmv.length === names.length ? names : [], gmv: gmv.length === names.length ? gmv : [], deltas: morningArray(payload?.deltas).slice(0, names.length), snapshot: String(payload?.snapshot || ''), rooms, visuals: [], bubbles, agenda, actions, generatedAt: new Date().toISOString(), sourceCoverage: coverage, model: activeAnalysisModel() };
}
async function generateMorningReport(date = chinaDate(), force = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new FeishuError('Invalid morning report date.', 400, 'invalid_morning_date');
  if (!force) {
    const stored = await readMorningReport(date);
    if (stored) return stored;
  }
  if (morningState.running) return morningState.running;
  morningState.running = (async () => {
    const [chatResult, ...docResults] = await Promise.allSettled([getChatMessages('coaching', 100), ...Object.keys(feishuDocs).map(key => getDocument(key))]);
    // The ranking documents can be very long. Sending four full documents plus
    // the entire morning chat to Jump AI caused gateway 504s, which made the
    // lifecycle timestamp advance while the ranking itself stayed unchanged.
    // The documents are newest-first, so a bounded latest slice retains the
    // current ranking evidence and keeps the scheduled refresh deterministic.
    const messages = chatResult.status === 'fulfilled' ? chatResult.value.messages
      .filter(message => message.createdAt && chinaDate(new Date(message.createdAt)) === date && chinaMinutes(message.createdAt) >= 420 && chinaMinutes(message.createdAt) <= 550)
      .slice(0, 12)
      .map(message => ({ sender: message.sender?.name || '群成员', createdAt: message.createdAt, text: truncateForModel(message.text, 400) })) : [];
    const documents = docResults.filter(result => result.status === 'fulfilled').map(result => ({
      title: result.value.title || result.value.name,
      content: truncateForModel(result.value.content, 2500),
      sourceUrl: result.value.sourceUrl
    }));
    const failures = [chatResult, ...docResults].filter(result => result.status === 'rejected').map(result => result.reason?.message || '读取失败');
    const coverage = { chatMessages: messages.length, documents: documents.length, failures, fetchedAt: new Date().toISOString() };
    const instruction = `你是直播中心早报编辑。仅根据给出的、已授权的飞书资料生成 ${date} 的早报数据，严格输出 JSON，不要 Markdown。字段：review, checked, gmvNames(string数组), gmv(number数组，单位万元), deltas(number或null数组), rooms([{name,owner,reason,people:[{name,score,resource,delta,evaluation}]}]), agenda([{start,title,end}]), actions([{title,evidence,priority}]), bubbles([{room,status,detail}])。直播间固定排序：官旗、品牌精选、优选、王鸥美肤。没有明确数据必须写“待确认”或“视觉无变化／无异常直播间”，不得补造 GMV、评分、日程、资源位或图片。早报群有效消息窗口为北京时间 07:00—09:10，并注明 09:10 GMV补查。`;
    const report = normalizeMorningReport(await callMiniMaxJson(instruction, { date, sourceWindow: 'Asia/Shanghai 07:00-09:10; 09:10 GMV recheck', groupMessages: messages, documents }, 3072), date, coverage);
    await saveMorningReport(report);
    morningState.value = report; morningState.date = date; morningState.generatedAt = report.generatedAt; morningState.lastError = null;
    return report;
  })();
  try { return await morningState.running; }
  catch (error) { morningState.lastError = { message: error.message || 'Morning generation failed', at: new Date().toISOString() }; throw error; }
  finally { morningState.running = null; }
}
async function morningApi(req, res, url, routePath) {
  try {
    if (routePath === '/api/morning/status') return json(res, 200, { ok: true, generatedAt: morningState.generatedAt, date: morningState.date, running: Boolean(morningState.running), lastError: morningState.lastError, refreshRule: 'Asia/Shanghai 07:00-09:10, with 09:10 GMV recheck' });
    if (routePath === '/api/morning/report') { const date = url.searchParams.get('date') || chinaDate(); const force = url.searchParams.get('refresh') === '1'; return json(res, 200, { ok: true, data: await generateMorningReport(date, force) }); }
    return json(res, 404, { ok: false, error: 'Morning API route not found' });
  } catch (error) { console.error('morning api failed', error.details || error.message); return json(res, error.status || 500, { ok: false, error: error.message || '早报生成失败。', code: error.details || 'morning_error' }); }
}
const lifecycleModules = Object.freeze(['recruitment', 'anchors']);
const lifecycleSnapshotPath = module => join(lifecycleDir, `${module}.json`);
const lifecycleLogPath = join(lifecycleDir, 'refresh-log.json');
const anchorPhotoDir = join(lifecycleDir, 'anchor-photos');
const bundledAnchorProfilePath = join(publicDir, 'modules', 'anchors', 'assets', 'anchor-profiles.json');
const recoveryProtectedStores = new Set([materialCardPath, materialAssetPath, materialLinkPath, calendarOverridePath, communicationDraftPath, anchorDevelopmentPath]);
function validRecoveryStore(path, value) {
  const record = item => Boolean(item) && typeof item === 'object' && !Array.isArray(item);
  if (!record(value)) return false;
  if (path === anchorDevelopmentPath) return record(value.profiles);
  const arrayField = new Map([[materialCardPath,'cards'],[materialAssetPath,'assets'],[materialLinkPath,'links'],[calendarOverridePath,'items'],[communicationDraftPath,'drafts']]).get(path);
  if (!arrayField || !Array.isArray(value[arrayField])) return false;
  return ['deletedCards','folders'].every(key => !Object.hasOwn(value,key) || Array.isArray(value[key]));
}
function historyRecoveryError() {
  return new FeishuError('历史业务数据尚待恢复，暂时无法读取。请勿重新录入或重复上传原有资料。', 503, 'history_recovery_pending');
}
function recoveryPayload() {
  return {readOnly:true, historyStatus:'pending_recovery', message:recoveryMessage};
}
function withRecoveryBanner(content) {
  if (!recoveryReadOnly) return content;
  const banner = `<style id="live-hub-recovery-style">html[data-live-hub-recovery-banner]{--live-hub-recovery-height:64px}html[data-live-hub-recovery-banner] body{padding-top:var(--live-hub-recovery-height)!important}html[data-live-hub-recovery-banner] .app{height:calc(100dvh - var(--live-hub-recovery-height))!important}html[data-live-hub-recovery-banner] .app-shell{min-height:calc(100dvh - var(--live-hub-recovery-height))!important}html[data-live-hub-recovery-banner] .app-shell>.sidebar{top:var(--live-hub-recovery-height)!important;height:calc(100dvh - var(--live-hub-recovery-height))!important;overflow-y:auto}#live-hub-recovery-notice{position:fixed;inset:0 0 auto;z-index:2147483647;min-height:64px;display:flex;align-items:center;justify-content:center;padding:10px 18px;box-sizing:border-box;background:#fff2cc;border-bottom:2px solid #c79226;color:#64450b;font:600 14px/1.5 system-ui,sans-serif;text-align:center}#live-hub-recovery-notice[hidden]{display:none!important}</style><aside id="live-hub-recovery-notice" role="status" hidden>${recoveryMessage}</aside><script>if(window.top===window.self){const root=document.documentElement;const notice=document.getElementById('live-hub-recovery-notice');root.setAttribute('data-live-hub-recovery-banner','true');notice.hidden=false;const measure=()=>root.style.setProperty('--live-hub-recovery-height',Math.ceil(notice.getBoundingClientRect().height)+'px');measure();if(typeof ResizeObserver!=='undefined')new ResizeObserver(measure).observe(notice);window.addEventListener('resize',measure)}</script>`;
  let recoveredContent = String(content).replace(/<body([^>]*)>/iu, '<body$1>'+banner);
  if (process.env.RECOVERY_ANCHOR_SNAPSHOT && recoveredContent.includes('function applyAnchorSnapshot(')) {
    const originalBoot = 'renderAll();loadBundledProfiles();loadAnchorTrends();loadLifecycle();setInterval(loadLifecycle,5*60*1000);';
    if (!recoveredContent.includes(originalBoot)) throw historyRecoveryError();
    recoveredContent = recoveredContent.replace(originalBoot, '');
    recoveredContent = recoveredContent.replace(/<\/body>/iu, `<script src="${basePath}/recovery-anchor-view.js"></script></body>`);
  }
  return recoveredContent;
}
const anchorProfileBase = Object.freeze({
  baseToken:'R5ntb369Tap1sisGt5dcPsIpnnf',
  tableId:'tblDHQ06n9PBtToW',
  viewId:'vewKuBxJAm'
});
async function readJsonFile(path, fallback = null) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (recoveryReadOnly && recoveryProtectedStores.has(path) && !validRecoveryStore(path,value)) throw historyRecoveryError();
    return value;
  }
  catch {
    if (recoveryReadOnly && recoveryProtectedStores.has(path)) throw historyRecoveryError();
    return fallback;
  }
}
async function writeJsonAtomic(path, value) {
  if (recoveryReadOnly) throw new FeishuError(recoveryMessage, 423, 'recovery_read_only');
  await mkdir(lifecycleDir, {recursive:true});
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), {encoding:'utf8',mode:0o600});
  await rename(temporary, path);
}

async function readRequestJson(req, limit = 512 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new FeishuError('请求内容过大。', 413, 'payload_too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new FeishuError('请求 JSON 格式不正确。', 400, 'invalid_json'); }
}

function materialCardStatus(value) {
  return ['draft','review','approved'].includes(value) ? value : 'draft';
}
const materialArray = value => Array.isArray(value) ? value : [];

function normalizeMaterialCard(payload, existing = null, actor = '已授权成员') {
  const now = new Date().toISOString();
  const title = String(payload?.title || existing?.title || '').trim().slice(0, 120);
  if (!title) throw new FeishuError('手卡标题不能为空。', 400, 'missing_title');
  const productsInput = Object.prototype.hasOwnProperty.call(payload || {}, 'products') ? payload?.products : existing?.products;
  const blocksInput = Object.prototype.hasOwnProperty.call(payload || {}, 'blocks') ? payload?.blocks : existing?.blocks;
  const linksInput = Object.prototype.hasOwnProperty.call(payload || {}, 'productLinks') ? payload?.productLinks : existing?.productLinks;
  const products = materialArray(productsInput).map(value => String(value || '').trim()).filter(Boolean).slice(0, 30);
  const blocks = materialArray(blocksInput).map(item => ({
    type: ['selling','offer','script','caution','prohibited'].includes(item?.type) ? item.type : 'script',
    content: String(item?.content || '').trim().slice(0, 8000),
  })).filter(item => item.content).slice(0, 80);
  const previousVersion = Number(existing?.version || 0);
  const version = previousVersion + 1;
  return {
    id: String(existing?.id || payload?.id || `card-${Date.now()}-${Math.random().toString(36).slice(2,8)}`),
    title,
    cover: String(payload?.cover || existing?.cover || '').trim().slice(0, 1000),
    room: String(payload?.room || existing?.room || '通用').trim().slice(0, 40),
    category: String(payload?.category || existing?.category || '未分类').trim().slice(0, 40),
    products,
    tags:[...new Set(materialArray(payload?.tags ?? existing?.tags).map(value => String(value).trim().slice(0,30)).filter(Boolean))].slice(0,20),
    productLinks: materialArray(linksInput).map(value => String(value || '').trim()).filter(value => /^https?:\/\//i.test(value)).slice(0, 30),
    blocks,
    status: materialCardStatus(payload?.status || existing?.status),
    version,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || actor,
    updatedAt: now,
    updatedBy: actor,
    versions: [...materialArray(existing?.versions), ...(existing ? [{ version: previousVersion, title: existing.title, cover:existing.cover, category:existing.category, products:existing.products, tags:existing.tags, blocks:existing.blocks, status: existing.status, updatedAt: existing.updatedAt, updatedBy: existing.updatedBy }] : [])].slice(-20),
  };
}

async function materialCardsApi(req, res, routePath, auth) {
  try {
    const store = await readJsonFile(materialCardPath, { cards: [], deletedCards: [], updatedAt: null });
    const cards = materialArray(store?.cards);
    if (req.method === 'GET' && routePath === '/api/material-cards') return json(res, 200, { ok:true, cards, updatedAt:store?.updatedAt || null, source:'live_hub_storage' });
    const deleteId = routePath.match(/^\/api\/material-cards\/([^/]+)$/u)?.[1];
    if (req.method === 'DELETE' && deleteId) {
      const body = await readRequestJson(req);
      const index = cards.findIndex(item => String(item?.id) === String(deleteId));
      if (index < 0) return json(res, 404, {ok:false,error:'手卡不存在或已删除。'});
      if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== Number(cards[index].version)) return json(res,409,{ok:false,error:'手卡已被其他人更新，请刷新后再删除。'});
      const actor = String(auth?.user?.realName || auth?.user?.name || '已授权成员');
      const deletedAt = new Date().toISOString();
      const archived = {...cards[index],deletedAt,deletedBy:actor};
      await writeJsonAtomic(materialCardPath, {cards:cards.filter((_, cardIndex) => cardIndex !== index),deletedCards:[archived,...materialArray(store?.deletedCards)].slice(0,500),updatedAt:deletedAt});
      return json(res,200,{ok:true,deleted:{id:archived.id,title:archived.title,deletedAt,deletedBy:actor},recoverable:true});
    }
    if (req.method !== 'POST' || routePath !== '/api/material-cards') return json(res, 405, {ok:false,error:'Method not allowed'});
    const body = await readRequestJson(req);
    const actor = String(auth?.user?.realName || auth?.user?.name || '已授权成员');
    const index = cards.findIndex(item => String(item?.id) === String(body?.id || ''));
    const existing = index >= 0 ? cards[index] : null;
    if (existing && body.expectedVersion !== undefined && Number(body.expectedVersion) !== Number(existing.version)) return json(res,409,{ok:false,error:'手卡已被其他人更新，请刷新后重新编辑。'});
    const requestedStatus = materialCardStatus(body?.status || existing?.status);
    if (requestedStatus === 'approved') {
      const permissions = auth?.permissions || {};
      if (!permissions.super_admin && !permissions.operation_admin && !permissions.manage_permissions) return json(res, 403, {ok:false,error:'仅中枢管理员或运营管理员可通过审核。'});
    }
    const card = normalizeMaterialCard({...body,status:requestedStatus}, existing, actor);
    const next = [...cards];
    if (index >= 0) next[index] = card; else next.unshift(card);
    await writeJsonAtomic(materialCardPath, { cards:next, deletedCards:materialArray(store?.deletedCards), updatedAt:card.updatedAt });
    return json(res, 200, {ok:true,card});
  } catch (error) {
    return json(res, Number(error?.status || 500), {ok:false,error:error?.message || '手卡保存失败。',...(recoveryReadOnly && error?.details==='history_recovery_pending'?{code:error.details}:{})});
  }
}

const materialAssetTypes = Object.freeze({
  'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif',
  'application/pdf':'.pdf','text/plain':'.txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx',
});
const visualExtensions = new Set('png jpg jpeg webp gif bmp tif tiff heic svg pdf txt csv psd ai eps doc docx xls xlsx ppt pptx zip rar 7z mp4 mov webm mp3 wav m4a'.split(' ').map(value=>'.'+value));
const previewTypes = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.bmp':'image/bmp','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.pdf':'application/pdf','.txt':'text/plain'};
function materialFolder(value) {
  const folder=String(value||'').replaceAll('\\','/').replace(/\/+$/u,'').trim();
  if(folder.length>240 || folder.startsWith('/') || /[\x00-\x1f:]/u.test(folder) || folder.split('/').some(part=>part==='..'||part==='.')) throw new FeishuError('文件夹路径无效，请使用相对目录。',422,'invalid_folder');
  return folder;
}
async function materialAssetsApi(req, res, routePath, auth) {
  try {
    const store = await readJsonFile(materialAssetPath, {assets:[],folders:[],updatedAt:null});
    const assets = materialArray(store?.assets);
    const folders = [...new Set([...visualThemeFolders, ...materialArray(store?.folders)])];
    if (req.method === 'GET' && routePath === '/api/material-assets') {
      return json(res, 200, {ok:true,assets,folders,updatedAt:store?.updatedAt || null,source:'live_hub_storage'});
    }
    const id = routePath.match(/^\/api\/material-assets\/([a-f0-9]{24})$/u)?.[1];
    if (req.method === 'GET' && id) {
      const asset = assets.find(item => item?.id === id);
      if (!asset || !/^\.[a-z0-9]+$/u.test(asset.extension)) return json(res, 404, {ok:false,error:'素材不存在。'});
      const content = await readFile(join(materialAssetDir, id+asset.extension));
      const safeType=previewTypes[asset.extension];
      const attachment=!safeType || new URL(req.url,'http://localhost').searchParams.get('download')==='1';
      const filename=String(asset.originalName||asset.title||'素材').replace(/[\r\n]/gu,'');
      res.writeHead(200, {'Content-Type':safeType||'application/octet-stream','Content-Length':content.length,'Content-Disposition':(attachment?'attachment':'inline')+"; filename*=UTF-8''"+encodeURIComponent(filename),'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});
      return res.end(content);
    }
    if (req.method !== 'POST' || routePath !== '/api/material-assets') return json(res, 405, {ok:false,error:'Method not allowed'});
    const body = await readRequestJson(req, 70 * 1024 * 1024);
    const kind = ['cue-card','prohibited-word','visual'].includes(body?.kind) ? body.kind : '';
    if (!kind) throw new FeishuError('未知素材类型。', 422, 'invalid_material_kind');
    const folder = kind==='visual' ? materialFolder(body?.folder) : '';
    const now=new Date().toISOString();
    if (kind==='visual' && body?.action==='create_folder') {
      if(!folder) throw new FeishuError('请输入文件夹名称。',422,'missing_folder');
      await writeJsonAtomic(materialAssetPath,{...store,folders:[...new Set([...folders,folder])],updatedAt:now});
      return json(res,200,{ok:true,folder});
    }
    const match = String(body?.dataUrl || '').match(/^data:([^;,]*);base64,([A-Za-z0-9+/=]+)$/u);
    if (!match) throw new FeishuError('请选择本地文件后上传。', 422, 'invalid_material_file');
    const suppliedMime = match[1].toLowerCase();
    const name=String(body?.name||'').split(/[\\/]/u).at(-1).trim().slice(0,180);
    const fileExtension=extname(name).toLowerCase();
    const extension = kind==='visual' ? fileExtension : materialAssetTypes[suppliedMime];
    if (!extension || (kind==='visual' && !visualExtensions.has(extension)) || (kind === 'cue-card' && !['image/png','image/jpeg','image/webp','image/gif'].includes(suppliedMime))) {
      throw new FeishuError(kind==='cue-card'?'直播手卡支持 PNG、JPG、WEBP 或 GIF。':'不支持此文件格式。视觉素材支持图片、设计源文件、文档、音视频及 ZIP / RAR / 7Z。',422,'unsupported_material_file');
    }
    const content = Buffer.from(match[2], 'base64'), limit=kind==='visual'?50:10;
    if (!content.length || content.length > limit * 1024 * 1024) throw new FeishuError('文件为空或超过 '+limit+'MB。',413,'material_file_too_large');
    if (kind==='cue-card') {
      const valid=suppliedMime==='image/png'?content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):suppliedMime==='image/jpeg'?content[0]===255&&content[1]===216:suppliedMime==='image/gif'?/^GIF8[79]a/u.test(content.subarray(0,6).toString()):content.subarray(0,4).toString()==='RIFF'&&content.subarray(8,12).toString()==='WEBP';
      if(!valid)throw new FeishuError('图片内容与格式不符，请重新导出后上传。',422,'invalid_image');
    }
    const idValue = createHash('sha256').update(content).update(kind).update(folder).update(name).digest('hex').slice(0,24);
    const previous=assets.find(item=>item.id===idValue);
    if(previous)return json(res,200,{ok:true,asset:previous,deduplicated:true});
    await mkdir(materialAssetDir, {recursive:true});
    await writeFile(join(materialAssetDir, idValue+extension), content, {mode:0o600});
    const asset = {
      id:idValue,kind,folder,title:String(body?.title || name || '未命名素材').trim().slice(0,120),
      originalName:name,mime:previewTypes[extension]||'application/octet-stream',extension,size:content.length,
      createdAt:now,createdBy:String(auth?.user?.realName || auth?.user?.name || '已授权成员'),url:basePath+'/api/material-assets/'+idValue,
    };
    await writeJsonAtomic(materialAssetPath, {...store,assets:[asset,...assets],folders:[...new Set([...folders,...(folder?[folder]:[])])],updatedAt:now});
    return json(res,200,{ok:true,asset});
  } catch (error) {
    return json(res,Number(error?.status||500),{ok:false,error:error?.message||'素材上传失败。',...(recoveryReadOnly && error?.details==='history_recovery_pending'?{code:error.details}:{})});
  }
}
function normalizeMaterialLink(payload, actor) {
  const kind = ['communication','competitor','prohibited'].includes(payload?.kind) ? payload.kind : '';
  const title = String(payload?.title || '').trim().slice(0,120);
  const category = String(payload?.category || '未分类').trim().slice(0,60);
  let source;
  try { source = new URL(String(payload?.url || '').trim()); } catch { throw new FeishuError('请输入有效的飞书 Wiki 或 Docx 链接。', 422, 'invalid_feishu_document_url'); }
  const sourceMatch = source.pathname.match(/^\/(wiki|docx)\/([A-Za-z0-9_-]+)/u);
  if (!/(?:^|\.)feishu\.cn$/iu.test(source.hostname) || !sourceMatch) {
    throw new FeishuError('仅支持飞书 Wiki 或飞书 Docx 链接。', 422, 'feishu_document_only');
  }
  if (!kind || !title) throw new FeishuError('请选择资料类型并填写标题。', 422, 'missing_material_link_fields');
  const now = new Date().toISOString();
  return {
    id:`link-${createHash('sha256').update(`${kind}|${source.toString()}`).digest('hex').slice(0,18)}`,
    kind,title,category,url:source.toString(),sourceType:sourceMatch[1],createdAt:now,createdBy:actor,
  };
}
async function materialLinksApi(req, res, routePath, auth) {
  try {
    const store = await readJsonFile(materialLinkPath, {links:[],updatedAt:null});
    const links = materialArray(store?.links);
    if (req.method === 'GET' && routePath === '/api/material-links') return json(res, 200, {ok:true,links,updatedAt:store?.updatedAt || null,source:'live_hub_storage'});
    if (req.method !== 'POST' || routePath !== '/api/material-links') return json(res, 405, {ok:false,error:'Method not allowed'});
    const body = await readRequestJson(req);
    const actor = String(auth?.user?.realName || auth?.user?.name || '已授权成员');
    const link = normalizeMaterialLink(body, actor);
    const next = [link,...links.filter(item => item?.id !== link.id)].slice(0,500);
    await writeJsonAtomic(materialLinkPath, {links:next,updatedAt:link.createdAt});
    return json(res, 200, {ok:true,link});
  } catch (error) {
    return json(res, Number(error?.status || 500), {ok:false,error:error?.message || '资料链接保存失败。',...(recoveryReadOnly && error?.details==='history_recovery_pending'?{code:error.details}:{})});
  }
}

function normalizeCalendarOverride(payload, existing, actor) {
  const date = String(payload?.date || existing?.date || '').trim();
  const room = String(payload?.room || existing?.room || '').trim();
  const title = String(payload?.title || '').replace(/\s+/gu, ' ').trim().slice(0, 120);
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(date)) throw new FeishuError('请选择有效日期。', 422, 'invalid_calendar_date');
  if (!['官旗','品牌精选','优选','王鸥美肤','直播中心'].includes(room)) throw new FeishuError('请选择有效直播间。', 422, 'invalid_calendar_room');
  if (!title && payload?.deleted !== true) throw new FeishuError('请填写机制、产品或直播事项。', 422, 'missing_calendar_title');
  const now = new Date().toISOString();
  return {
    id: `${date}|${room}`,
    date,
    room,
    title,
    deleted: payload?.deleted === true,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || actor,
    updatedAt: now,
    updatedBy: actor,
  };
}

async function calendarOverridesApi(req, res, routePath, auth) {
  try {
    const store = await readJsonFile(calendarOverridePath, { items: [], updatedAt: null });
    const items = materialArray(store?.items);
    if (req.method === 'GET' && routePath === '/api/calendar-overrides') {
      return json(res, 200, { ok:true, items, updatedAt:store?.updatedAt || null, source:'live_hub_storage', readOnly:recoveryReadOnly });
    }
    if (req.method !== 'POST' || routePath !== '/api/calendar-overrides') return json(res, 405, {ok:false,error:'Method not allowed'});
    if (auth?.mode !== 'internal' && req.headers['x-requested-with'] !== 'XMLHttpRequest') return json(res, 403, {ok:false,error:'缺少日历保存请求标识。'});
    const body = await readRequestJson(req);
    const actor = String(auth?.user?.realName || auth?.user?.name || '已授权成员');
    const id = `${String(body?.date || '').trim()}|${String(body?.room || '').trim()}`;
    const index = items.findIndex(item => item?.id === id);
    const override = normalizeCalendarOverride(body, index >= 0 ? items[index] : null, actor);
    const next = [...items];
    if (index >= 0) next[index] = override; else next.unshift(override);
    await writeJsonAtomic(calendarOverridePath, { items:next, updatedAt:override.updatedAt });
    return json(res, 200, {ok:true,item:override});
  } catch (error) {
    return json(res, Number(error?.status || 500), {ok:false,error:error?.message || '直播日历保存失败。',...(recoveryReadOnly && error?.details==='history_recovery_pending'?{code:error.details}:{})});
  }
}

function communicationProduct(value) {
  const product = String(value || '').replace(/\s+/gu, ' ').trim().slice(0, 40);
  if (!product) throw new FeishuError('请选择或填写产品。', 422, 'missing_product');
  return product;
}

function communicationSourceUrls(product, values) {
  const catalogSources = arguments.length > 2 && Array.isArray(arguments[2]) ? arguments[2] : [];
  const defaults = [...(communicationProductSources[product] || []), ...catalogSources];
  const extras = materialArray(values).map(value => sourceUrl(value).toString()).filter(value => /\/(?:wiki|docx)\/[A-Za-z0-9_-]+/u.test(value));
  const urls = [...new Set([...defaults, ...extras])].slice(0, 12);
  if (!urls.length) throw new FeishuError('该产品尚未配置可验证的飞书沟通稿来源，请先添加产品资料链接。', 422, 'missing_product_sources');
  return urls;
}

function baseFieldUrls(value) {
  const urls = [];
  const visit = item => {
    if (typeof item === 'string') { for (const match of item.matchAll(/https:\/\/[^\s<>"]+/gu)) urls.push(match[0].replace(/[\])。，,;]+$/u, '')); return; }
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== 'object') return;
    ['link','url'].forEach(key => { if (typeof item[key] === 'string') urls.push(item[key]); });
    Object.values(item).forEach(visit);
  };
  visit(value);
  return [...new Set(urls)].filter(url => /jqx28l0j4lx\.feishu\.cn\/(?:wiki|docx)\/[A-Za-z0-9_-]+/u.test(url));
}

async function fetchCommunicationProductCatalog() {
  return cached('communication-product-catalog', 5 * 60 * 1000, async () => {
    const items = []; let pageToken = '';
    do {
      const params = new URLSearchParams({page_size:'500'}); if (pageToken) params.set('page_token', pageToken);
      const data = await feishuGet(`/bitable/v1/apps/${communicationProductBase.baseToken}/tables/${communicationProductBase.tableId}/records?${params}`);
      items.push(...materialArray(data.items)); pageToken = data.has_more ? String(data.page_token || '') : '';
    } while (pageToken);
    const normalizedItems = items.map(item => {
      const fields = item?.fields && typeof item.fields === 'object' ? item.fields : {};
      const name = baseFieldText(fields['产品名称']).replace(/^[+'"\s]+|[+'"\s]+$/gu, '').trim();
      const sources = [...new Set(['产品技术文档','宣讲资料','国药监局链接','检测报告'].flatMap(field => baseFieldUrls(fields[field])))];
      return {name,recordId:String(item?.record_id || ''),filing:baseFieldText(fields['备案编号']),core:baseFieldText(fields['核心成分/技术']),sources};
    }).filter(item => item.name);
    const unique = new Map();
    for (const item of normalizedItems) {
      const previous = unique.get(item.name);
      unique.set(item.name, previous ? {
        ...previous,
        filing:previous.filing || item.filing,
        core:previous.core || item.core,
        sources:[...new Set([...(previous.sources || []), ...(item.sources || [])])]
      } : item);
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  });
}

async function communicationCatalog() {
  try { return {items:await fetchCommunicationProductCatalog(),status:'已连接',reason:''}; }
  catch (error) {
    return {items:Object.keys(communicationProductSources).map(name => ({name,recordId:'',filing:'',core:'',sources:communicationProductSources[name]})),status:'待授权',reason:String(error?.message || '产品资料库读取失败')};
  }
}

function communicationContext(input) {
  const persona = truncateForModel(input?.persona || '专业顾问型', 80).trim();
  const broadcastMode = communicationBroadcastModes.includes(input?.broadcastMode) ? input.broadcastMode : communicationBroadcastModes[0];
  const platform = communicationPlatforms.includes(input?.platform) ? input.platform : communicationPlatforms[0];
  const mechanism = {
    price:truncateForModel(input?.mechanism?.price, 120).trim(),
    mainQuantity:truncateForModel(input?.mechanism?.mainQuantity, 120).trim(),
    gifts:truncateForModel(input?.mechanism?.gifts, 240).trim()
  };
  return {persona,broadcastMode,platform,mechanism};
}

function compactCommunicationSource(value, limit) {
  const text = String(value || '').replace(/\u0000/gu, '').trim();
  if (!text) return '';
  const pieces = text.split(/(?:\r?\n)+|(?<=[。！？；])/u).map(item => item.trim()).filter(Boolean);
  const important = pieces.filter(item => /产品|面膜|成分|技术|功效|检测|报告|备案|专利|适用|使用|人群|规格|禁忌|注意|宣称|卖点/u.test(item));
  const selected = [...new Set([...pieces.slice(0, 5), ...important])];
  return truncateForModel(selected.join('\n'), limit);
}

function normalizeGeneratedCommunication(payload, input, sources, failures) {
  const selected = communicationStages.filter(stage => !Array.isArray(input?.stages) || input.stages.includes(stage));
  const count = Math.max(1, Math.min(5, Number(input?.count) || 1));
  const rawStages = payload?.stages && typeof payload.stages === 'object' ? payload.stages : {};
  const stages = Object.fromEntries(communicationStages.map(stage => {
    if (!selected.includes(stage)) return [stage, []];
    const value = Array.isArray(rawStages[stage]) ? rawStages[stage] : typeof rawStages[stage] === 'string' ? [rawStages[stage]] : [];
    return [stage, value.map(item => truncateForModel(item, 2400).trim()).filter(Boolean).slice(0, count)];
  }));
  if (selected.some(stage => stages[stage].length !== count)) throw new FeishuError('模型未按所选环节和篇数返回完整内容，请重新生成。', 502, 'incomplete_generation');
  const fullScripts = materialArray(payload?.fullScripts).map(item => truncateForModel(item, 24000).trim()).filter(Boolean).slice(0, count);
  while (fullScripts.length < count) {
    const index = fullScripts.length;
    fullScripts.push(communicationStages.map(stage => stages[stage][index] ? `【${stage}】\n${stages[stage][index]}` : '').filter(Boolean).join('\n\n'));
  }
  if (fullScripts.some(item => !item)) throw new FeishuError('模型未返回完整沟通稿，请重新生成。', 502, 'incomplete_full_script');
  const compliance = materialArray(payload?.compliance).slice(0, count).map(item => ({
    conclusion:truncateForModel(item?.conclusion || '待复核', 120).trim(),
    risks:materialArray(item?.risks).map(value => truncateForModel(value, 500).trim()).filter(Boolean).slice(0, 20),
    pendingConfirmations:materialArray(item?.pendingConfirmations).map(value => truncateForModel(value, 500).trim()).filter(Boolean).slice(0, 20)
  }));
  const context = communicationContext(input);
  return {
    id: `communication-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    product: communicationProduct(input.product), stages,
    scripts:fullScripts.map((fullScript, index) => ({index:index + 1,fullScript,compliance:compliance[index] || {conclusion:'待复核',risks:[],pendingConfirmations:['发布前由业务确认价格、数量与赠品机制。']}})),
    fullScript: fullScripts[0] || '',
    compliance:compliance[0] || null,
    context,
    evidenceNotes: materialArray(payload?.evidenceNotes).map(item => truncateForModel(item, 800).trim()).filter(Boolean).slice(0, 20),
    sources: sources.map(item => ({ title:item.title, sourceUrl:item.sourceUrl, revisionId:item.revisionId || null, fetchedAt:item.fetchedAt })),
    sourceCoverage: { requested: sources.length + failures.length, available: sources.length, failures },
    model: activeAnalysisModel(), generatedAt: new Date().toISOString()
  };
}

function auditGeneratedCommunication(script, input) {
  const text = String(script || '').replace(/\s+/gu, ' ').trim();
  const risks = [];
  const banned = [
    ['细胞', /细胞/gu], ['修复', /修复/gu], ['解决', /解决/gu], ['纯天然', /纯天然/gu],
    ['未备案功效词', /美白|淡斑|祛痘|抗老/gu], ['绝对保证', /百分之百|100%有效|绝对有效|保证有效|永久/giu],
    ['诱导互动', /扣\s*1|扣已拍|评论区告诉/gu], ['虚假稀缺', /最后\d+[单件盒]|仅剩\d+[单件盒]|马上恢复原价|最后\d+分钟/gu],
    ['宽泛售后或物流承诺', /无理由退|不满意就退|全国包邮|当天发货|次日必达/gu],
    ['孕妇绝对适用', /孕妇(都|也)?可用|孕妇放心用/gu], ['时间加功效保证', /\d+[天次周月].{0,10}(见效|有效|改善|解决|消失)/gu],
  ];
  banned.forEach(([label, pattern]) => { if (pattern.test(text)) risks.push(`${label}：命中高风险表达`); });
  const mechanism = communicationContext(input).mechanism;
  if (!mechanism.price && /(?:到手|日常|专柜|活动)?价.{0,5}(?:\d+|元)|[¥￥]\s*\d+/gu.test(text)) risks.push('价格机制未由业务输入，禁止生成具体价格。');
  if (!mechanism.mainQuantity && /(?:库存|限量|只剩|最后).{0,8}\d+[单件盒套]/gu.test(text)) risks.push('库存或数量未由业务输入，禁止生成稀缺数量。');
  if (!mechanism.gifts && /(?:赠品|加赠|赠送).{0,12}\d+[单件盒套支]/gu.test(text)) risks.push('赠品机制未由业务输入，禁止生成具体赠品数量。');
  if (/销量第一|排名第一|全网第一|行业第一/gu.test(text)) risks.push('榜单或第一名宣称必须有可核验证据。');
  if (communicationStages.every(stage => !Array.isArray(input?.stages) || input.stages.includes(stage)) && text.length < 1500) risks.push(`完整稿过短：当前 ${text.length} 字，至少需要 1500 字以覆盖两轮 5—7 分钟直播结构。`);
  return [...new Set(risks)];
}

async function generateCommunication(input) {
  const product = communicationProduct(input?.product);
  const catalog = await communicationCatalog();
  const productRecord = catalog.items.find(item => item.name === product);
  const urls = communicationSourceUrls(product, input?.sourceUrls, productRecord?.sources || []);
  const results = await collectInBatches(urls, 4, getDocumentByUrl);
  const sources = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  const failures = results.filter(result => result.status === 'rejected').map(result => truncateForModel(result.reason?.message || '来源读取失败', 240));
  if (!sources.length) throw new FeishuError('该产品的飞书资料当前均不可读取，已阻断生成。', 502, 'product_sources_unavailable');
  const stages = communicationStages.filter(stage => !Array.isArray(input?.stages) || input.stages.includes(stage));
  if (!stages.length) throw new FeishuError('请至少选择一个沟通稿环节。', 422, 'missing_stages');
  const count = Math.max(1, Math.min(5, Number(input?.count) || 1));
  const sourceBudget = Math.max(200, Math.floor(1800 / Math.max(1, sources.length)));
  const documents = sources.map(item => ({ title:item.title, sourceUrl:item.sourceUrl, revisionId:item.revisionId || null, content:compactCommunicationSource(item.content, sourceBudget) }));
  const compactProductRecord = productRecord ? {
    name:productRecord.name,
    filing:truncateForModel(productRecord.filing, 300),
    core:truncateForModel(productRecord.core, 900),
    sources:materialArray(productRecord.sources).slice(0, 12)
  } : null;
  const context = communicationContext(input);
  const instruction = `生成 WIS 直播沟通稿并做严格合规复核。只能使用给定飞书证据和业务输入，禁止补造功效、成分、数据、奖项、价格、数量、赠品、库存、倒计时或承诺；证据不足写“待业务确认”，不得把待确认内容写进可直接口播句。完整稿按 5—7 分钟两轮循环组织：第一轮依次完成暖场、痛点、卖点、证据背书、价格/售后机制、逼单、链接承接；第二轮先承接下单与未下单用户，再换角度讲痛点/卖点/使用方法/证据、合规的机制提醒并循环收口。双播仅在需要时加入主播/助理动作标签。完整选择全部结构时每篇 1800—3600 个中文字符，各阶段建议 240—520 字。严禁“细胞、修复、解决、纯天然、美白、淡斑、祛痘、抗老”、功效保证、时间加见效、虚假库存/倒计时、宽泛退换/物流、孕妇绝对适用、扣1/扣已拍等诱导互动；“原价”只能在有可核验业务输入时改写为日常价或专柜价；专利、检测报告、排名只可在给定证据明确出现时使用。严格输出 JSON：{stages:{暖场与痛点:string[],卖点与背书:string[],机制与售后:string[],第一轮逼单:string[],第二轮承接:string[],使用方法与换角度:string[],循环收口:string[]},fullScripts:string[],evidenceNotes:string[],compliance:[{conclusion:string,risks:string[],pendingConfirmations:string[]}]}。数组数量必须等于 count，未选环节为空数组；只输出 JSON。`;
  const batches = [];
  let remaining = count;
  while (remaining > 0) { batches.push(1); remaining -= 1; }
  const parts = [];
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batchCount = batches[batchIndex];
    let accepted = null; let lastRisks = [];
    for (let attempt = 0; attempt < 2 && !accepted; attempt += 1) {
      const generated = await callMiniMaxJson(instruction, {
        product, productRecord:compactProductRecord, context, selectedStages:stages, count:batchCount,
        versionOffset:parts.reduce((sum, part) => sum + part.scripts.length, 0),
        userBrief:truncateForModel(input?.brief, 1600), documents,
        correctionRequired:attempt ? lastRisks : []
      }, 8192, {fast:true});
      const normalized = normalizeGeneratedCommunication(generated, { ...input, product, stages, count:batchCount }, sources, failures);
      lastRisks = normalized.scripts.flatMap(item => auditGeneratedCommunication(item.fullScript, { ...input, product, stages }));
      if (!lastRisks.length) accepted = normalized;
    }
    if (!accepted) throw new FeishuError(`生成稿未通过强制合规闸门：${[...new Set(lastRisks)].join('；')}`, 502, 'generated_script_noncompliant');
    parts.push(accepted);
  }
  const mergedStages = Object.fromEntries(communicationStages.map(stage => [stage, parts.flatMap(part => part.stages?.[stage] || []).slice(0, count)]));
  const scripts = parts.flatMap(part => part.scripts || []).slice(0, count).map((item, index) => ({...item,index:index + 1}));
  return {
    id:`communication-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    product, stages:mergedStages, scripts, fullScript:scripts[0]?.fullScript || '', compliance:scripts[0]?.compliance || null,
    context, evidenceNotes:[...new Set(parts.flatMap(part => part.evidenceNotes || []))].slice(0, 30),
    sources:parts[0]?.sources || [], sourceCoverage:parts[0]?.sourceCoverage || {requested:sources.length + failures.length,available:sources.length,failures},
    model:communicationAnalysisModel(), generatedAt:new Date().toISOString()
  };
}

async function saveCommunicationDraft(input, auth) {
  const product = communicationProduct(input?.product);
  const now = new Date().toISOString(); const actor = String(auth?.user?.realName || auth?.user?.name || '已授权成员');
  const stages = Object.fromEntries(communicationStages.map(stage => [stage, materialArray(input?.stages?.[stage]).map(item => truncateForModel(item, 2400).trim()).filter(Boolean).slice(0, 20)]));
  const draft = {
    id: String(input?.id || `communication-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 120),
    product, stages, fullScript:truncateForModel(input?.fullScript || communicationStages.flatMap(stage => stages[stage]).join('\n\n'), 24000).trim(),
    scripts:materialArray(input?.scripts).map(item => ({index:Number(item?.index) || 1,fullScript:truncateForModel(item?.fullScript,24000).trim(),compliance:item?.compliance || null})).filter(item => item.fullScript).slice(0,5),
    context:communicationContext(input?.context || input), compliance:input?.compliance || null,
    sources:materialArray(input?.sources).map(item => ({title:truncateForModel(item?.title, 200),sourceUrl:truncateForModel(item?.sourceUrl, 1000),revisionId:item?.revisionId || null})).filter(item => item.sourceUrl).slice(0, 20),
    model:truncateForModel(input?.model || communicationAnalysisModel(), 120), updatedAt:now, updatedBy:actor
  };
  const store = await readJsonFile(communicationDraftPath, { drafts: [] });
  const drafts = materialArray(store?.drafts); const index = drafts.findIndex(item => item.id === draft.id); const next = [...drafts];
  if (index >= 0) next[index] = { ...drafts[index], ...draft }; else next.unshift(draft);
  await writeJsonAtomic(communicationDraftPath, { drafts:next.slice(0, 100), updatedAt:now });
  return draft;
}

async function scriptGeneratorApi(req, res, routePath, auth) {
  try {
    if (req.method === 'GET' && routePath === '/api/script-generator/config') { const catalog = await communicationCatalog(); return json(res, 200, {ok:true,products:catalog.items.map(item => item.name),productCatalog:catalog.items,productCatalogStatus:catalog.status,productCatalogReason:catalog.reason,personas:communicationPersonas,broadcastModes:communicationBroadcastModes,platforms:communicationPlatforms,stages:communicationStages,model:communicationAnalysisModel(),configured:minimaxReady(),sourcePolicy:'feishu_verified_only'}); }
    if (req.method === 'GET' && routePath === '/api/script-generator/drafts') { const store = await readJsonFile(communicationDraftPath, {drafts:[]}); return json(res, 200, {ok:true,drafts:materialArray(store?.drafts),updatedAt:store?.updatedAt || null}); }
    if (req.method === 'POST' && routePath === '/api/script-generator/generate') return json(res, 200, {ok:true,data:await generateCommunication(await readRequestJson(req))});
    if (req.method === 'POST' && routePath === '/api/script-generator/save') return json(res, 200, {ok:true,draft:await saveCommunicationDraft(await readRequestJson(req), auth)});
    return json(res, 404, {ok:false,error:'Script generator route not found'});
  } catch (error) {
    console.error('script generator api failed', error.details || error.message);
    return json(res, Number(error?.status || 500), {ok:false,error:error?.message || '沟通稿生成失败。',code:error?.details || 'script_generator_error'});
  }
}
const anchorAbilityDimensions = Object.freeze(['话术', '节奏', '演绎', '控场']);
const anchorTrainingStages = Object.freeze(['新人期/基础思维培养', '适应期/基础播感培养', '成长期/进阶专项', '成熟期/自我复盘']);
const anchorCourses = Object.freeze(['沟通稿框架', '镜头表现力', '基础数据讲解', '关键数据解析', '节奏把控力', '话术结构进阶课', '逼单和种草专项课', '心态管理课']);
const anchorAccounts = Object.freeze(['王鸥美肤', '优选', '品牌精选', '官旗']);
const anchorNameAliases = Object.freeze({ '黄芷瞳':'黄芷曈' });
function canonicalAnchorName(value) { const name = String(value || '').replace(/\s+/gu, ' ').trim().slice(0, 40); return anchorNameAliases[name] || name; }
function reconcileAnchorProfiles(profiles) {
  const reconciled = {};
  Object.entries(profiles && typeof profiles === 'object' ? profiles : {}).forEach(([key, value]) => {
    const name = canonicalAnchorName(value?.name || key); const current = reconciled[name];
    if (!current || String(value?.updatedAt || '').localeCompare(String(current.updatedAt || '')) >= 0) reconciled[name] = { ...(current || {}), ...(value || {}), name };
  });
  return reconciled;
}

function normalizeAnchorDevelopment(input, existing, actor) {
  const name = canonicalAnchorName(input?.name || existing?.name || '');
  if (!name) throw new FeishuError('主播姓名不能为空。', 422, 'missing_anchor_name');
  const score = value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? Number(Number(value).toFixed(2)) : null;
  const grade = value => ['A','B','C','D'].includes(String(value || '').toUpperCase()) ? String(value).toUpperCase() : null;
  const existingAbilities = existing?.abilities || existing?.legacyAbilities || {};
  const abilities = Object.fromEntries(anchorAbilityDimensions.map(dimension => [dimension, grade(input?.abilities?.[dimension] ?? existingAbilities[dimension])]));
  const account = anchorAccounts.includes(input?.account) ? input.account : anchorAccounts.includes(existing?.account) ? existing.account : '官旗';
  const trainingStage = anchorTrainingStages.includes(input?.trainingStage) ? input.trainingStage : anchorTrainingStages.includes(existing?.trainingStage) ? existing.trainingStage : anchorTrainingStages[0];
  const joinDate = /^\d{4}-\d{2}-\d{2}$/u.test(String(input?.joinDate || '')) ? input.joinDate : existing?.joinDate || '';
  const courses = [...new Set(materialArray(input?.courses ?? existing?.courses).map(value => String(value || '').trim()).filter(value => anchorCourses.includes(value)))];
  const ratings = materialArray(existing?.ratings).filter(item => item?.scores && Object.values(item.scores).some(value => grade(value)));
  if (input?.rating && /^\d{4}-\d{2}-\d{2}$/u.test(String(input.rating.date || ''))) {
    const ratingScores = Object.fromEntries(anchorAbilityDimensions.map(dimension => [dimension, grade(input.rating.scores?.[dimension] ?? input?.abilities?.[dimension])]).filter(([,value]) => value));
    const values = Object.values(ratingScores); const gradeWeight = {A:4,B:3,C:2,D:1};
    if (values.length === anchorAbilityDimensions.length) {
      const overallGrade = ['D','C','B','A'][Math.max(0, Math.min(3, Math.round(values.reduce((sum,value)=>sum+gradeWeight[value],0)/values.length)-1))];
      const nextRating = {scores:ratingScores,overallGrade,date:String(input.rating.date),comment:truncateForModel(input.rating.comment, 600).trim(),source:'manual',submittedAt:new Date().toISOString(),submittedBy:actor};
      const index = ratings.findIndex(item => item.date === nextRating.date && item.source !== 'ai');
      if (index >= 0) ratings[index] = nextRating; else ratings.push(nextRating);
    }
  }
  ratings.sort((a,b) => String(b.date).localeCompare(String(a.date)));
  const growthRecords = materialArray(existing?.growthRecords);
  materialArray(existing?.ratings).filter(item => Number.isFinite(Number(item?.average))).forEach(item => {
    if (!growthRecords.some(record => record.date === item.date && record.migratedFrom === 'legacy_percent_rating')) growthRecords.push({date:item.date,score:score(item.average),coursePeriod:item.coursePeriod || '历史周期',comment:item.comment || '',source:item.source || 'manual',migratedFrom:'legacy_percent_rating',submittedAt:item.submittedAt,submittedBy:item.submittedBy});
  });
  if (input?.growthRecord && /^\d{4}-\d{2}-\d{2}$/u.test(String(input.growthRecord.date || '')) && score(input.growthRecord.score) != null) {
    const nextGrowth = {date:String(input.growthRecord.date),score:score(input.growthRecord.score),coursePeriod:truncateForModel(input.growthRecord.coursePeriod || '培养周期', 80).trim(),comment:truncateForModel(input.growthRecord.comment, 600).trim(),source:'manual',submittedAt:new Date().toISOString(),submittedBy:actor};
    const index = growthRecords.findIndex(item => item.date === nextGrowth.date && item.coursePeriod === nextGrowth.coursePeriod && item.source !== 'ai');
    if (index >= 0) growthRecords[index] = nextGrowth; else growthRecords.push(nextGrowth);
  }
  growthRecords.sort((a,b) => String(b.date).localeCompare(String(a.date)));
  const now = new Date().toISOString();
  return {
    name, account, joinDate, trainingStage, newcomer:Boolean(input?.newcomer ?? existing?.newcomer),
    title:truncateForModel(input?.title ?? existing?.title ?? '主播', 60).trim() || '主播',
    currentResource:truncateForModel(input?.currentResource ?? existing?.currentResource ?? '', 80).trim(),
    abilities, abilityComment:truncateForModel(input?.abilityComment ?? existing?.abilityComment ?? '', 500).trim(),
    courses, courseProgress:`${courses.length}/${anchorCourses.length}`, ratings:ratings.slice(0, 52), growthRecords:growthRecords.slice(0, 104), latestGrade:ratings[0]?.overallGrade || existing?.latestGrade || null,
    createdAt:existing?.createdAt || now, updatedAt:now, updatedBy:actor
  };
}

async function anchorDevelopmentApi(req, res, routePath, auth) {
  try {
    const store = await readJsonFile(anchorDevelopmentPath, {profiles:{},updatedAt:null});
    const profiles = reconcileAnchorProfiles(store?.profiles || {});
    if (req.method === 'GET' && routePath === '/api/anchor-development') return json(res, 200, {ok:true,profiles,updatedAt:store?.updatedAt || null,dimensions:anchorAbilityDimensions,trainingStages:anchorTrainingStages,courses:anchorCourses,accounts:anchorAccounts,ratingScale:{values:['A','B','C','D'],unit:'等级'},growthScale:{min:0,max:100,unit:'分'},ratingPolicy:'abcd_periodic_and_growth_score'});
    if (req.method !== 'POST' || routePath !== '/api/anchor-development') return json(res, 405, {ok:false,error:'Method not allowed'});
    const body = await readRequestJson(req);
    const name = canonicalAnchorName(body?.name || ''); const actor = String(auth?.user?.realName || auth?.user?.name || '已授权成员');
    const profile = normalizeAnchorDevelopment(body, profiles[name] || null, actor); const next = {...profiles,[profile.name]:profile};
    await writeJsonAtomic(anchorDevelopmentPath, {profiles:next,updatedAt:profile.updatedAt});
    return json(res, 200, {ok:true,profile});
  } catch (error) {
    return json(res, Number(error?.status || 500), {ok:false,error:error?.message || '主播成长档案保存失败。',code:error?.details || 'anchor_development_error'});
  }
}
async function readRecoveryAnchorSnapshot() {
  if (!process.env.RECOVERY_ANCHOR_SNAPSHOT) return null;
  const raw = await readFile(process.env.RECOVERY_ANCHOR_SNAPSHOT);
  const hash = createHash('sha256').update(raw).digest('hex');
  if (!process.env.RECOVERY_ANCHOR_SHA256 || hash !== process.env.RECOVERY_ANCHOR_SHA256) throw historyRecoveryError();
  const snapshot = JSON.parse(raw.toString('utf8'));
  if (snapshot?.recoverySource?.mode !== 'verified_backup' || snapshot?.module !== 'anchors' || !Array.isArray(snapshot?.profiles)) throw historyRecoveryError();
  return snapshot;
}
async function readLifecycleSnapshot(module) {
  if (module === 'anchors' && recoveryReadOnly && process.env.RECOVERY_ANCHOR_SNAPSHOT) return readRecoveryAnchorSnapshot();
  return lifecycleModules.includes(module) ? readJsonFile(lifecycleSnapshotPath(module), null) : null;
}
async function appendLifecycleLog(entry) {
  const log = await readJsonFile(lifecycleLogPath, []);
  const next = [entry, ...(Array.isArray(log) ? log : [])].slice(0, 120);
  await writeJsonAtomic(lifecycleLogPath, next);
}
function lifecycleSourceStatus(sourceDate, targetDate) {
  return sourceDate === targetDate ? 'current' : 'stale';
}
function baseFieldText(value) {
  if (Array.isArray(value)) return value.map(baseFieldText).filter(Boolean).join('、');
  if (value && typeof value === 'object') return baseFieldText(value.name ?? value.text ?? value.value ?? '');
  return String(value ?? '').trim();
}
function baseFieldDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString().slice(0, 10);
  const raw = baseFieldText(value);
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] || '';
}
function anchorPhotoName(name, attachment) {
  const extension = /^\.(?:png|jpe?g|webp)$/i.test(extname(String(attachment?.name || ''))) ? extname(String(attachment.name)).toLowerCase() : '.jpg';
  return `${createHash('sha256').update(`${name}:${attachment?.file_token || ''}`).digest('hex').slice(0, 20)}${extension}`;
}
async function bundledAnchorProfiles() {
  const value = await readJsonFile(bundledAnchorProfilePath, {profiles:[]});
  return {
    profiles:Array.isArray(value?.profiles) ? value.profiles.map(profile => ({...profile,photoSource:profile.photoFile ? 'bundled' : 'none'})) : [],
    source:'bundled_snapshot',
    fetchedAt:value?.generatedAt || null,
    failures:[]
  };
}
async function downloadBaseAttachment(fileToken, targetPath) {
  const response = await fetch(`https://open.feishu.cn/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`, {
    headers:{Authorization:`Bearer ${await getTenantToken()}`}, signal:AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new FeishuError('飞书主播照片下载失败。', response.status === 403 ? 403 : 502, `anchor_photo_${response.status}`);
  const temporary = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, Buffer.from(await response.arrayBuffer()), {mode:0o600});
  await rename(temporary, targetPath);
}
async function fetchAnchorProfiles() {
  const items = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({view_id:anchorProfileBase.viewId,page_size:'200',text_field_as_array:'true'});
    if (pageToken) params.set('page_token', pageToken);
    const data = await feishuGet(`/bitable/v1/apps/${anchorProfileBase.baseToken}/tables/${anchorProfileBase.tableId}/records?${params}`);
    items.push(...(Array.isArray(data.items) ? data.items : []));
    pageToken = data.has_more ? String(data.page_token || '') : '';
  } while (pageToken);
  const bundled = await bundledAnchorProfiles();
  const bundledByName = new Map(bundled.profiles.map(profile => [profile.name, profile]));
  await mkdir(anchorPhotoDir, {recursive:true});
  const profiles = await Promise.all(items.map(async item => {
    const fields = item?.fields && typeof item.fields === 'object' ? item.fields : {};
    const name = baseFieldText(fields['主播姓名']);
    if (!name || !baseFieldText(fields['主播状态']).includes('在职')) return null;
    const attachment = Array.isArray(fields['上播截屏']) ? fields['上播截屏'].find(value => value?.file_token) : null;
    const fallback = bundledByName.get(name) || {};
    let photoFile = fallback.photoFile || '';
    let photoSource = photoFile ? 'bundled' : 'none';
    let photoError = '';
    if (attachment?.file_token) {
      const candidate = anchorPhotoName(name, attachment);
      try {
        const target = join(anchorPhotoDir, candidate);
        try { await stat(target); } catch { await downloadBaseAttachment(attachment.file_token, target); }
        photoFile = candidate;
        photoSource = 'runtime';
      } catch (error) {
        photoError = String(error?.message || '主播照片下载失败');
      }
    }
    return {
      name,
      room:baseFieldText(fields['所属直播间']),
      makeupArtist:baseFieldText(fields['化妆师']),
      hireDate:baseFieldDate(fields['入职日期']),
      recordUpdatedAt:baseFieldText(fields['更新时间']),
      reviewDocumentUrl: feishuDocumentLink(fields['成长文档']),
      photoFile,
      photoSource,
      photoError,
      sourceRecordId:String(item?.record_id || '')
    };
  }));
  return {profiles:profiles.filter(Boolean),source:'feishu_base',fetchedAt:new Date().toISOString(),failures:[]};
}
async function loadAnchorProfiles() {
  try { return await fetchAnchorProfiles(); }
  catch (error) {
    if (/timeout|timed out|fetch failed|超时/i.test(String(error?.message||''))) {
      try { return await fetchAnchorProfiles(); } catch(retryError) { error=retryError; }
    }
    const previous=await readLifecycleSnapshot('anchors');
    let recovered=null, recoveryFailure='';
    try { recovered=await readRecoveryAnchorSnapshot(); }
    catch (recoveryError) { recoveryFailure='已配置主播档案备份未通过完整性校验，未使用该备份。'; }
    const eligible = snapshot => snapshot && Array.isArray(snapshot.profiles) &&
      ['feishu_base','verified_source_backup'].includes(snapshot.profileSource?.source) &&
      Number.isFinite(Date.parse(snapshot.profileSource?.fetchedAt || ''));
    const candidates=[previous,recovered].filter(eligible)
      .sort((a,b)=>Date.parse(b.profileSource.fetchedAt)-Date.parse(a.profileSource.fetchedAt));
    const failure=String(error?.message||'主播档案源暂不可用')+'；未取得本次更新，保留原资料及读取时间。';
    if(candidates.length){
      const selected=candidates[0];
      return {profiles:selected.profiles,source:selected.profileSource.source,
        fetchedAt:selected.profileSource.fetchedAt,
        failures:[failure,...(recoveryFailure?[recoveryFailure]:[])]};
    }
    const bundled = await bundledAnchorProfiles();
    return {...bundled,failures:[failure,...(recoveryFailure?[recoveryFailure]:[])]};
  }
}
async function serveAnchorPhoto(res, name) {
  const snapshot = await readLifecycleSnapshot('anchors');
  let profile = (snapshot?.profiles || []).find(item => item?.name === name);
  if (!profile) profile = (await bundledAnchorProfiles()).profiles.find(item => item?.name === name);
  if (!profile?.photoFile || !/^[a-f0-9]{20}\.(?:png|jpe?g|webp)$/i.test(profile.photoFile)) return json(res, 404, {ok:false,error:'主播照片待补充。'});
  const root = profile.photoSource === 'runtime' ? anchorPhotoDir : join(publicDir, 'modules', 'anchors', 'assets', 'base-avatars');
  const filePath = join(root, profile.photoFile);
  try {
    const content = await readFile(filePath);
    res.writeHead(200, {'Content-Type':mime[extname(filePath).toLowerCase()] || 'image/jpeg','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});
    res.end(content);
  } catch { return json(res, 404, {ok:false,error:'主播照片文件不可用。'}); }
}
async function refreshRecruitmentLifecycle(targetDate) {
  const endTime = Math.ceil(Date.now() / 1000);
  const startTime = endTime - 60 * 24 * 60 * 60;
  const [chatResult, coachResult, employmentResult] = await Promise.allSettled([
    getChatMessages('recruitment', 500, {startTime,endTime}),
    getDocument('coach'),
    getChatMessages('coaching', 500, {startTime,endTime})
  ]);
  if (chatResult.status === 'rejected') throw chatResult.reason;
  const parsed = parseRecruitmentMessages(chatResult.value.messages || [], {reviewerOpenId:recruitmentReviewerOpenId});
  const employment = employmentResult.status === 'fulfilled' ? parseEmploymentMessages(employmentResult.value.messages || [], {reviewerOpenId:recruitmentReviewerOpenId}) : {candidates:[],sourceDate:''};
  const candidates = mergeRecruitmentCandidates(parsed.candidates, employment.candidates);
  const summary = coachResult.status === 'fulfilled' ? parseLatestCoachSummary(coachResult.value.content) : null;
  const sourceDate = [parsed.sourceDate, summary?.date, employment.sourceDate].filter(Boolean).sort().at(-1) || '';
  const funnel = {...parsed.funnel,
    hiredCount:candidates.filter(item => item.inSubmissionCohort && item.stage === 'hired').length,
    assessmentPassedCount:candidates.filter(item => item.inSubmissionCohort && item.assessmentPassed).length,
  };
  const snapshot = {
    schemaVersion: 1,
    module: 'recruitment',
    targetDate,
    generatedAt: new Date().toISOString(),
    sourceDate,
    status: lifecycleSourceStatus(sourceDate, targetDate),
    candidates,
    cohortNames: parsed.cohortNames,
    funnel,
    dailyCounts: parsed.dailyCounts,
    dailyNames: parsed.dailyNames,
    interviewEvents: parsed.interviewEvents,
    submittedCount: parsed.submittedCount,
    summary,
    coverage: {
      chatMessages: chatResult.value.messages?.length || 0,
      reactionStatus:chatResult.value.reactionStatus || '待核验',
      reactionFailure:chatResult.value.reactionFailure || '',
      coachDocument: coachResult.status === 'fulfilled',
      employmentStatus:employmentResult.status === 'fulfilled' ? '已读取' : '待授权',
      employmentMessages:employmentResult.status === 'fulfilled' ? employmentResult.value.messages?.length || 0 : null,
      failures: [
        ...(coachResult.status === 'rejected' ? [String(coachResult.reason?.message || '教练日报读取失败')] : []),
        ...(employmentResult.status === 'rejected' ? [String(employmentResult.reason?.message || 'WIS直播战队日报读取失败')] : []),
      ]
    }
  };
  await writeJsonAtomic(lifecycleSnapshotPath('recruitment'), snapshot);
  return snapshot;
}
function recruitmentCycleRange(month) {
  const value = String(month || '');
  if (!/^20\d{2}-\d{2}$/u.test(value)) throw Object.assign(new Error('招聘月份格式应为 YYYY-MM。'), {status:400});
  const [year, monthNumber] = value.split('-').map(Number);
  if (monthNumber < 1 || monthNumber > 12) throw Object.assign(new Error('招聘月份无效。'), {status:400});
  const startMonth = monthNumber === 1 ? 12 : monthNumber - 1;
  const startYear = monthNumber === 1 ? year - 1 : year;
  const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-25`;
  const endDate = `${year}-${String(monthNumber).padStart(2, '0')}-25`;
  return {
    month:value,
    startDate,
    endDate,
    startTime:Math.floor(new Date(`${startDate}T00:00:00+08:00`).getTime() / 1000),
    endTime:Math.floor(new Date(`${endDate}T23:59:59+08:00`).getTime() / 1000)
  };
}
async function readRecruitmentCalendar(cycle) {
  if (!recruitmentCalendarId) return {events:{},status:'待配置：正式面试日历来源尚未配置，群聊记录不冒充正式日历。'};
  const authorization=await recruitmentCalendarReader.status();
  if(!authorization.authorized)return {events:{},status:`待授权：${authorization.reason}；无需在日历共享人中查找机器人。`};
  const query = new URLSearchParams({start_time:String(cycle.startTime),end_time:String(cycle.endTime),page_size:'1000'});
  const items=[],seenPages=new Set();
  for(let page=0;page<20;page++){
    const data=await recruitmentCalendarReader.get(`/calendar/v4/calendars/${encodeURIComponent(recruitmentCalendarId)}/events?${query}`);
    items.push(...materialArray(data.items));
    if(!data.has_more)break;
    if(page===19||!data.page_token||seenPages.has(data.page_token))throw new Error('正式面试日历未能完整翻页，已停止统计，不能以截断结果展示人数。');
    seenPages.add(data.page_token);query.set('page_token',data.page_token);
  }
  const events = {};
  items.forEach(item => {
    if(item?.status==='cancelled'||!/(面试|初试|复试|试播)/u.test(item?.summary||''))return;
    const timestamp = Number(item?.start_time?.timestamp || 0);
    const date = item?.start_time?.date || (timestamp ? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp * 1000)) : '');
    if (!/^20\d{2}-\d{2}-\d{2}$/u.test(String(date))) return;
    const time = timestamp ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(timestamp * 1000)) : '';
    const summary = truncateForModel(item?.summary || '面试安排', 80).trim();
    (events[date] ||= []).push({name:`${summary}${time ? ` · ${time}` : ''}`,status:'calendar',eventId:String(item?.event_id || '')});
  });
  return {events,status:`已连接：正式面试日历已读取 ${Object.values(events).flat().length} 条详情事件。`};
}
async function recruitmentCycleSnapshot(month) {
  const cycle = recruitmentCycleRange(month);
  const [chatResult, employmentResult, calendarResult] = await Promise.allSettled([
    getChatMessages('recruitment', 500, cycle),
    getChatMessages('coaching', 500, cycle),
    readRecruitmentCalendar(cycle),
  ]);
  if (chatResult.status === 'rejected') throw chatResult.reason;
  const chat = chatResult.value;
  const parsed = parseRecruitmentMessages(chat.messages || [], {reviewerOpenId:recruitmentReviewerOpenId});
  const employment = employmentResult.status === 'fulfilled' ? parseEmploymentMessages(employmentResult.value.messages || [], {reviewerOpenId:recruitmentReviewerOpenId}) : {candidates:[],sourceDate:''};
  const candidates = mergeRecruitmentCandidates(parsed.candidates, employment.candidates);
  const funnel = {...parsed.funnel,
    hiredCount:candidates.filter(item => item.inSubmissionCohort && item.stage === 'hired').length,
    assessmentPassedCount:candidates.filter(item => item.inSubmissionCohort && item.assessmentPassed).length,
  };
  const calendar = calendarResult.status === 'fulfilled' ? calendarResult.value : {events:{},status:`待核验：正式面试日历读取失败（${truncateForModel(calendarResult.reason?.message || '权限不足', 120)}）；请由舒豪在中枢“正式面试日历授权”入口核验个人只读授权，不需要共享给机器人。`};
  const interviewEvents = structuredClone(parsed.interviewEvents || {});
  Object.entries(calendar.events || {}).forEach(([date, items]) => { interviewEvents[date] = [...(interviewEvents[date] || []), ...items]; });
  return {
    schemaVersion:3,
    module:'recruitment',
    generatedAt:new Date().toISOString(),
    sourceDate:[parsed.sourceDate, employment.sourceDate].filter(Boolean).sort().at(-1) || '',
    status:chat.reactionStatus === '已核验' && employmentResult.status === 'fulfilled' ? 'current' : 'partial',
    calendarStatus:calendar.status,
    assessmentStatus:employmentResult.status === 'fulfilled' ? '已读取：WIS直播战队日报中的可核验考核结论' : '待授权：WIS直播战队日报尚不可读取',
    cycle,
    candidates,
    cohortNames:parsed.cohortNames,
    funnel,
    dailyCounts:parsed.dailyCounts,
    dailyNames:parsed.dailyNames,
    interviewEvents,
    submittedCount:parsed.submittedCount,
    unmappedCount:candidates.filter(item => item.stage === 'unmapped').length,
    coverage:{chatMessages:chat.messages?.length || 0,capped:(chat.messages?.length || 0) >= 500,reactionStatus:chat.reactionStatus || '待核验',reactionFailure:chat.reactionFailure || '',employmentStatus:employmentResult.status === 'fulfilled' ? '已读取' : '待授权',employmentMessages:employmentResult.status === 'fulfilled' ? employmentResult.value.messages?.length || 0 : null,employmentFailure:employmentResult.status === 'rejected' ? String(employmentResult.reason?.message || 'WIS直播战队日报读取失败') : ''}
  };
}
function documentBlockText(block) {
  const texts = [];
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if (typeof value.content === 'string') texts.push(value.content);
    for (const [key, child] of Object.entries(value)) {
      if (!['token','block_id','parent_id'].includes(key)) visit(child);
    }
  };
  visit(block);
  return texts.join('').replace(/\s+/g, ' ').trim();
}
function sourceDateFromText(value) {
  const match = String(value || '').match(/(?:(20\d{2})[.\-/年])?(\d{1,2})[.\-/月](\d{1,2})日/u);
  if (!match) return '';
  const year = Number(match[1] || chinaDate().slice(0, 4));
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 || month > 12 || day < 1 || day > 31 ||
    parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day
  ) return '';
  const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return /^20\d{2}-\d{2}-\d{2}$/.test(candidate) ? candidate : '';
}
function latestDocumentSection(content) {
  const lines = String(content || '').split(/\r?\n/u);
  const start = lines.findIndex(line => sourceDateFromText(line));
  if (start < 0) return {sourceDate:'',content:''};
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (sourceDateFromText(lines[index])) { end = index; break; }
  }
  return {sourceDate:sourceDateFromText(lines[start]),content:lines.slice(start, end).join('\n')};
}
function evaluationForAnchor(section, name) {
  const line = String(section || '').split(/\r?\n/u).map(value => value.trim()).find(value => value.startsWith(name));
  return truncateForModel(line || '排名截图已核验，当日文字评价待补充。', 360);
}
async function documentRankingEvidence(sourceKey) {
  const source = feishuDocs[sourceKey];
  if (!source) throw new FeishuError('未配置主播排名文档。', 404, 'unknown_ranking_document');
  return cached(`ranking-evidence:${sourceKey}`, 5 * 60 * 1000, async () => {
    const document = await getDocument(sourceKey);
    const node = (await feishuGet(`/wiki/v2/spaces/get_node?token=${encodeURIComponent(source.token)}`)).node || {};
    if (node.obj_type !== 'docx' || !node.obj_token) throw new FeishuError('主播排名文档类型不可用。', 422, 'unsupported_ranking_document');
    const data = await feishuGet(`/docx/v1/documents/${encodeURIComponent(node.obj_token)}/blocks?page_size=500`);
    const blocks = Array.isArray(data.items) ? data.items : [];
    const headingIndex = blocks.findIndex(block => sourceDateFromText(documentBlockText(block)));
    if (headingIndex < 0) throw new FeishuError('排名文档未找到最新日期块。', 422, 'ranking_date_missing');
    const sourceDate = sourceDateFromText(documentBlockText(blocks[headingIndex]));
    let imageToken = '';
    for (let index = headingIndex + 1; index < blocks.length; index += 1) {
      if (sourceDateFromText(documentBlockText(blocks[index]))) break;
      if (blocks[index]?.image?.token) { imageToken = String(blocks[index].image.token); break; }
    }
    if (!imageToken) throw new FeishuError('最新日期块未找到排名截图。', 422, 'ranking_image_missing');
    const section = latestDocumentSection(document.content);
    return {sourceDate:sourceDate || section.sourceDate,section:section.content,imageToken,revisionId:document.revisionId || null};
  });
}
async function downloadDocumentImage(fileToken) {
  const response = await fetch(`https://open.feishu.cn/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`, {
    headers:{Authorization:`Bearer ${await getTenantToken()}`}, signal:AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new FeishuError('主播排名截图下载失败。', response.status === 403 ? 403 : 502, `ranking_image_${response.status}`);
  return {buffer:Buffer.from(await response.arrayBuffer()),mime:response.headers.get('content-type') || 'image/png'};
}
async function recognizeRankingImage(room, evidence) {
  if (!jumpLlmReady()) throw new FeishuError('主播排名截图识别服务未配置。', 503, 'ranking_vision_missing');
  const image = await downloadDocumentImage(evidence.imageToken);
  const messages = [{role:'user',content:[
    {type:'text',text:`这是${room}主播排名图。只逐行抄录图中明确可见的排名、姓名、评分、原定资源位和排名变化。输出严格JSON：{"people":[{"rank":1,"name":"","score":null,"resource":"待核验","delta":null}]}。不要解释，不得推断，看不清的字段使用null。`},
    {type:'image_url',image_url:{url:`data:${image.mime};base64,${image.buffer.toString('base64')}`}}
  ]}];
  const response = await fetch(jumpLlmUrl, {
    method:'POST',
    headers:{Authorization:jumpLlmToken,'Content-Type':'application/json'},
    signal:AbortSignal.timeout(90000),
    body:JSON.stringify({
      application:jumpLlmApplication,event:'text',provider:jumpLlmProvider,
      requests_data:{model:jumpVisionModel,messages,temperature:0,max_tokens:3072,stream:false}
    })
  });
  const rawResponse = await response.text();
  let body;
  try { body = JSON.parse(rawResponse); } catch { body = {raw:rawResponse}; }
  if (!response.ok) throw new FeishuError('主播排名截图识别失败。', 502, `ranking_vision_${response.status}`);
  return parseModelJson(completionContent(body, rawResponse) || body?.raw);
}
function rankingDelta(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const raw = String(value ?? '').trim();
  const amount = Number(raw.match(/\d+/u)?.[0]);
  if (!Number.isFinite(amount)) return null;
  return /[↓↘降下]/u.test(raw) ? -amount : /[↑↗升上]/u.test(raw) ? amount : amount;
}
async function generateAnchorRankingReport() {
  const sources = [
    {room:'品牌精选',key:'morning_selected'},
    {room:'优选',key:'morning_preferred'},
    {room:'王鸥美肤',key:'morning_wangou'}
  ];
  const rooms = [];
  const failures = [];
  const roomSourceDates = {};
  for (const source of sources) {
    try {
      const evidence = await documentRankingEvidence(source.key);
      const recognized = await recognizeRankingImage(source.room, evidence);
      const people = (Array.isArray(recognized?.people) ? recognized.people : [])
        .filter(person => person?.name && String(person.name).trim() !== '待确认')
        .sort((left, right) => Number(left.rank || 999) - Number(right.rank || 999))
        .slice(0, 12)
        .map(person => ({
          name:String(person.name).trim(),
          score:Number.isFinite(Number(person.score)) ? Number(person.score) : null,
          resource:String(person.resource || '待核验'),
          delta:rankingDelta(person.delta),
          evaluation:evaluationForAnchor(evidence.section, String(person.name).trim())
        }));
      if (!people.length) throw new Error('排名截图未识别到可核验主播。');
      roomSourceDates[source.room] = evidence.sourceDate;
      rooms.push({name:source.room,owner:'待确认',people,reason:`${evidence.sourceDate || '最新'} 飞书日报排名截图已核验。`});
    } catch (error) {
      failures.push(`${source.room}：${String(error?.message || '排名截图读取失败')}`);
    }
  }
  const dates = Object.values(roomSourceDates).filter(Boolean).sort();
  return {
    date:dates.at(-1) || '',rooms,generatedAt:new Date().toISOString(),
    sourceCoverage:{documents:sources.length,imagesRecognized:rooms.length,roomSourceDates,failures,fetchedAt:new Date().toISOString()},
    model:jumpVisionModel
  };
}

function anchorNameFromText(text, names) {
  const compact = String(text || '').replace(/\s+/gu, '');
  const aliases = new Map([['黄芷曈', '黄芷瞳'], ['黄芷瞳', '黄芷曈']]);
  return [...names].sort((a, b) => b.length - a.length).find(name => compact.includes(String(name).replace(/\s+/gu, '')) || (aliases.get(name) && compact.includes(aliases.get(name)))) || '';
}

function publicEvidenceMessage(message, textOverride = '') {
  return {
    messageId:message.messageId,
    text:truncateForModel(textOverride || message.text, 1000),
    sender:message.sender?.name || message.sender?.id || '群成员',
    createdAt:message.createdAt,
    appLink:message.appLink || '',
    resources:(message.resources || []).map(resource => ({...resource,url:moduleResourceUrl(message.messageId, resource)}))
  };
}

async function collectAnchorEvidence(names, targetDate) {
  const end = Math.floor(Date.now() / 1000); const startFiveDays = end - 5 * 86400; const startThreeDays = end - 3 * 86400;
  const results = await Promise.allSettled([
    getChatMessages('coaching', 500, {startTime:startFiveDays,endTime:end}),
    getChatMessages('learning', 500, {startTime:startThreeDays,endTime:end})
  ]);
  const sources = {
    coaching:results[0].status === 'fulfilled' ? {available:true,name:results[0].value.name,fetchedAt:results[0].value.fetchedAt} : {available:false,name:feishuChats.coaching.name,reason:String(results[0].reason?.message || '群聊不可读')},
    learning:results[1].status === 'fulfilled' ? {available:true,name:results[1].value.name,fetchedAt:results[1].value.fetchedAt} : {available:false,name:feishuChats.learning.name,reason:String(results[1].reason?.message || '群聊不可读')}
  };
  const chats = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  const evidenceByAnchor = Object.fromEntries([...names].map(name => [name, {evaluations:[],recordings:[]} ]));
  for (const chat of chats) {
    const messages = chat.messages || [];
    for (const message of messages) {
      if (chat.key === 'coaching' || chat.name === feishuChats.coaching.name) {
        for (const name of names) {
          const excerpt = extractAnchorEvaluation(message.text, name, [...names]);
          if (excerpt) evidenceByAnchor[name].evaluations.push({...publicEvidenceMessage(message),text:excerpt,source:chat.name});
        }
      }
      if (!(message.resources || []).length) continue;
      const created = new Date(message.createdAt || 0).getTime();
      const companion = messages.find(candidate => candidate.text && Math.abs(new Date(candidate.createdAt || 0).getTime() - created) <= 5 * 60 * 1000 && (candidate.sender?.id || candidate.sender?.name) === (message.sender?.id || message.sender?.name) && anchorNameFromText(candidate.text, names));
      const recordingName = anchorNameFromText(companion?.text || message.text, names);
      if (recordingName) evidenceByAnchor[recordingName].recordings.push({...publicEvidenceMessage(message, companion?.text || ''),source:chat.name});
    }
  }
  for (const value of Object.values(evidenceByAnchor)) {
    value.evaluations = value.evaluations.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 20);
    value.recordings = value.recordings.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 20);
  }
  return {targetDate,windows:{evaluations:'近5日',recordings:'近3日'},sources,evidenceByAnchor,failures:Object.values(sources).filter(source => !source.available).map(source => `${source.name}：${source.reason}`),fetchedAt:new Date().toISOString()};
}
async function refreshAnchorLifecycle(targetDate) {
  const [reportResult, coachResult, profileResult] = await Promise.allSettled([
    generateAnchorRankingReport(),
    getDocument('coach'),
    loadAnchorProfiles()
  ]);
  const previous = await readLifecycleSnapshot('anchors');
  const coachSummary = coachResult.status === 'fulfilled' ? parseLatestCoachSummary(coachResult.value.content) : null;
  const normalized = reportResult.status === 'fulfilled'
    ? normalizeAnchorReport(reportResult.value, coachSummary)
    : {date:'',rooms:{},verifiedRooms:[],sourceCoverage:{failures:[]}};
  const rankingUpdated = normalized.verifiedRooms.length > 0;
  const reportFailure = reportResult.status === 'rejected'
    ? String(reportResult.reason?.message || '主播排名读取失败')
    : rankingUpdated ? '' : '当日授权资料中没有可核验的主播排名，排名继续保留最近有效版本。';
  const sourceDate = rankingUpdated ? normalized.date : (previous?.sourceDate || '');
  const profiles = profileResult.status === 'fulfilled' ? profileResult.value : await bundledAnchorProfiles();
  const evidenceNames = new Set([
    ...(profiles.profiles || []).map(profile => profile.name),
    ...Object.values(rankingUpdated ? normalized.rooms : (previous?.rooms || {})).flat().map(item => item?.name)
  ].filter(Boolean));
  const evidenceResult = await collectAnchorEvidence(evidenceNames, targetDate).catch(error => ({targetDate,windows:{evaluations:'近5日',recordings:'近3日'},sources:{},evidenceByAnchor:{},failures:[String(error?.message || '群聊资料读取失败')],fetchedAt:new Date().toISOString()}));
  const snapshot = {
    schemaVersion: 1,
    module: 'anchors',
    targetDate,
    generatedAt: new Date().toISOString(),
    sourceDate,
    status: rankingUpdated ? lifecycleSourceStatus(sourceDate, targetDate) : 'partial',
    rooms: rankingUpdated ? {...(previous?.rooms || {}),...normalized.rooms} : (previous?.rooms || {}),
    verifiedRooms: rankingUpdated ? normalized.verifiedRooms : (previous?.verifiedRooms || []),
    rankingUpdated,
    summary: coachSummary,
    profiles: profiles.profiles,
    evidenceByAnchor:evidenceResult.evidenceByAnchor,
    evidenceSources:evidenceResult.sources,
    evidenceWindows:evidenceResult.windows,
    profileSource: {source:profiles.source,fetchedAt:profiles.fetchedAt},
    coverage: {
      ...(normalized.sourceCoverage || {}),
      rankingUpdated,
      coachDocument: coachResult.status === 'fulfilled',
      failures: [
        ...((normalized.sourceCoverage?.failures || []).map(String)),
        ...(reportFailure ? [reportFailure] : []),
        ...(coachResult.status === 'rejected' ? [String(coachResult.reason?.message || '教练日报读取失败')] : []),
        ...(profileResult.status === 'rejected' ? [String(profileResult.reason?.message || '主播档案多维表读取失败')] : (profiles.failures || [])),
        ...(evidenceResult.failures || [])
      ]
    }
  };
  await writeJsonAtomic(lifecycleSnapshotPath('anchors'), snapshot);
  return snapshot;
}
async function refreshLifecycleModules(modules = lifecycleModules, trigger = 'manual', automaticSlot = '') {
  if (lifecycleState.running) return lifecycleState.running;
  lifecycleState.running = (async () => {
    const targetDate = chinaDateFor();
    const selected = modules.filter(module => lifecycleModules.includes(module));
    if (!selected.length) throw new FeishuError('未知的生命周期模块。', 400, 'unknown_lifecycle_module');
    feishuCache.clear();
    lifecycleState.lastAttemptAt = new Date().toISOString();
    const results = {};
    for (const module of selected) {
      try {
        const snapshot = module === 'recruitment'
          ? await refreshRecruitmentLifecycle(targetDate)
          : await refreshAnchorLifecycle(targetDate);
        results[module] = {ok:true,data:snapshot};
        await appendLifecycleLog({module,trigger,targetDate,ok:true,status:snapshot.status,sourceDate:snapshot.sourceDate,at:snapshot.generatedAt});
      } catch (error) {
        const previous = await readLifecycleSnapshot(module);
        const message = String(error?.message || '生命周期数据刷新失败');
        results[module] = {ok:false,data:previous,error:message,code:error?.details || 'lifecycle_refresh_error'};
        await appendLifecycleLog({module,trigger,targetDate,ok:false,status:'stale',sourceDate:previous?.sourceDate || '',error:message,at:new Date().toISOString()});
      }
    }
    if (trigger === 'automatic') lifecycleState.lastAutomaticSlot = automaticSlot || `${targetDate}T${lifecycleRefreshTimes[0]}`;
    lifecycleState.lastError = Object.values(results).some(result => !result.ok)
      ? {message:'一个或多个模块刷新失败，已保留上次有效快照。',at:new Date().toISOString()}
      : null;
    return {targetDate,trigger,results};
  })();
  try { return await lifecycleState.running; }
  finally { lifecycleState.running = null; }
}
async function lifecycleStatus() {
  const [recruitment, anchors, log] = await Promise.all([
    readLifecycleSnapshot('recruitment'), readLifecycleSnapshot('anchors'), readJsonFile(lifecycleLogPath, [])
  ]);
  const snapshotStatus = snapshot => snapshot ? {
    generatedAt:snapshot.generatedAt, sourceDate:snapshot.sourceDate, targetDate:snapshot.targetDate,
    status:snapshot.status, coverage:snapshot.coverage, profileSource:snapshot.profileSource || null
  } : null;
  return {
    ok:true,
    running:Boolean(lifecycleState.running),
    refreshRule:`Asia/Shanghai ${lifecycleRefreshTimes.join(',')} daily`,
    refreshTimes:lifecycleRefreshTimes,
    schedulerEnabled:lifecycleSchedulerEnabled,
    lastAttemptAt:lifecycleState.lastAttemptAt,
    lastError:lifecycleState.lastError,
    modules:{recruitment:snapshotStatus(recruitment),anchors:snapshotStatus(anchors)},
    logs:(Array.isArray(log) ? log : []).slice(0, 20)
  };
}
function canRefreshLifecycle(auth) {
  const permissions = auth?.permissions || {};
  return auth?.mode === 'internal' || permissions.super_admin || permissions.operation_admin || permissions.manage_permissions;
}
async function lifecycleApi(req, res, url, routePath, auth) {
  try {
    if (req.method === 'GET' && routePath === '/api/lifecycle/status') return json(res, 200, await lifecycleStatus());
    if (req.method === 'GET' && routePath === '/api/lifecycle/anchor-photo') return serveAnchorPhoto(res, String(url.searchParams.get('name') || '').trim());
    if (req.method === 'GET' && routePath === '/api/lifecycle/recruitment-cycle') {
      return json(res, 200, {ok:true,data:await recruitmentCycleSnapshot(url.searchParams.get('month'))});
    }
    if (req.method === 'GET' && routePath === '/api/lifecycle/interview-reminder-preview') {
      const date = String(url.searchParams.get('date') || '');
      if (!/^20\d{2}-\d{2}-\d{2}$/u.test(date)) return json(res, 400, {ok:false,error:'请提供 YYYY-MM-DD 格式的面试日期。'});
      const [year, month, day] = date.split('-').map(Number);
      const cycleMonth = new Date(Date.UTC(year, month - 1 + (day > 25 ? 1 : 0), 1)).toISOString().slice(0, 7);
      return json(res, 200, {ok:true,preview:buildInterviewReminderPreview(await recruitmentCycleSnapshot(cycleMonth), date)});
    }
    if (req.method === 'GET' && routePath === '/api/lifecycle/snapshot') {
      const module = url.searchParams.get('module') || '';
      if (!lifecycleModules.includes(module)) return json(res, 400, {ok:false,error:'未知的生命周期模块。'});
      const snapshot=await readLifecycleSnapshot(module);
      return json(res, 200, {ok:true,data:module==='anchors'?verifiedAnchorEvidence(snapshot):snapshot});
    }
    if (req.method === 'POST' && routePath === '/api/lifecycle/refresh') {
      if (!canRefreshLifecycle(auth)) return json(res, 403, {ok:false,error:'当前账号没有手动刷新权限。'});
      if (req.headers['x-lifecycle-refresh'] !== 'manual') return json(res, 400, {ok:false,error:'缺少手动刷新请求标识。'});
      const module = url.searchParams.get('module') || 'all';
      const selected = module === 'all' ? lifecycleModules : [module];
      if (!selected.every(item => lifecycleModules.includes(item))) return json(res, 400, {ok:false,error:'未知的生命周期模块。'});
      const alreadyRunning = Boolean(lifecycleState.running);
      void refreshLifecycleModules(selected, 'manual').catch(error => {
        lifecycleState.lastError = {message:String(error?.message || '手动刷新失败'),at:new Date().toISOString()};
        console.error('manual lifecycle refresh failed', error?.details || error?.message || error);
      });
      return json(res, 202, {
        ok:true,
        accepted:true,
        alreadyRunning,
        modules:selected,
        startedAt:lifecycleState.lastAttemptAt || new Date().toISOString(),
        message:alreadyRunning?'已有刷新任务正在执行，页面将继续跟踪结果。':'刷新任务已开始，页面将自动显示进度与结果。'
      });
    }
    return json(res, 404, {ok:false,error:'Lifecycle API route not found'});
  } catch (error) {
    console.error('lifecycle api failed', error.details || error.message);
    return json(res, error.status || 500, {ok:false,error:error.message || '生命周期数据处理失败。',code:error.details || 'lifecycle_error'});
  }
}
function redirect(res, target) { res.writeHead(302, { Location: target, 'Cache-Control':'no-store' }); res.end(); }
function directLocalRequest(req) {
  if (hubSameOriginEmbed) return false;
  const forwarded = req.headers['x-forwarded-for'] || req.headers['x-real-ip'];
  const remote = String(req.socket.remoteAddress || '').replace(/^::ffff:/u, '');
  const privateAddress = remote === '127.0.0.1' || remote === '::1'
    || /^10\./u.test(remote) || /^192\.168\./u.test(remote) || /^172\.(1[6-9]|2\d|3[01])\./u.test(remote);
  return !forwarded && privateAddress;
}
function centralAuthorityHeaders(req) {
  const headers = { Accept: 'application/json' };
  if (req.headers.cookie) headers.Cookie = req.headers.cookie;
  if (req.headers['x-oa-token']) headers['X-OA-Token'] = req.headers['x-oa-token'];
  return headers;
}
const centralAuthCache = new Map();
const centralAuthInFlight = new Map();
function centralAuthCacheKey(req) {
  const credential = `${String(req.headers.cookie || '')}\n${String(req.headers['x-oa-token'] || '')}`;
  return credential.trim() ? createHash('sha256').update(credential).digest('hex') : '';
}
async function fetchCentralAuthority(req) {
  const bases = [...new Set([centralAuthorityBase, centralAuthorityFallbackBase].filter(Boolean))];
  let lastResponse;
  let lastError;
  for (const base of bases) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`${base}/central-auth/me`, {
          headers: centralAuthorityHeaders(req), redirect: 'manual', signal: AbortSignal.timeout(8_000),
        });
        if (response.status < 500) return response;
        lastResponse = response;
      } catch (error) {
        lastError = error;
      }
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError || new Error('central authority unavailable');
}
async function authorizeCentralUncached(req) {
  let upstream;
  try {
    upstream = await fetchCentralAuthority(req);
  } catch {
    return { ok: false, status: 503, detail: '统一权限服务暂时不可用，请稍后刷新。' };
  }
  const payload = await upstream.json().catch(() => ({}));
  if (upstream.status !== 200) {
    const status = upstream.status === 401 || (upstream.status >= 300 && upstream.status < 400)
      ? 401
      : upstream.status === 403 ? 403 : 503;
    return { ok: false, status, detail: payload.detail || (status === 403 ? '当前账号未开通中枢登录权限。' : '统一登录状态已失效。') };
  }
  if (!payload.access?.allowed_modules?.includes(requiredModule)) {
    return { ok: false, status: 403, detail: '当前账号未开通直播间管理权限。' };
  }
  return { ok: true, mode: 'central', user: payload.user || {}, permissions: payload.permissions || {} };
}
async function authorizeCentral(req) {
  if (directLocalRequest(req)) {
    return {
      ok: true, mode: 'internal', user: { name: '服务器本机验收' },
      permissions: { super_admin: true, operation_admin: true, manage_permissions: true },
    };
  }
  const key = centralAuthCacheKey(req);
  const cached = key ? centralAuthCache.get(key) : null;
  if (cached?.expiresAt > Date.now()) return cached.auth;
  if (key && centralAuthInFlight.has(key)) return centralAuthInFlight.get(key);
  const running = (async () => {
    const auth = await authorizeCentralUncached(req);
    if (auth.ok && key) {
      const now = Date.now();
      centralAuthCache.set(key, { auth, expiresAt: now + 30_000, staleUntil: now + 60_000 });
      if (centralAuthCache.size > 500) {
        for (const [cacheKey, value] of centralAuthCache) if (value.staleUntil <= now) centralAuthCache.delete(cacheKey);
      }
      return auth;
    }
    if (auth.status === 503 && cached?.auth && cached.staleUntil > Date.now()) return { ...cached.auth, degraded: true };
    return auth;
  })();
  if (key) centralAuthInFlight.set(key, running);
  try { return await running; }
  finally { if (key && centralAuthInFlight.get(key) === running) centralAuthInFlight.delete(key); }
}
function centralSession(auth) {
  const user = auth.user || {};
  const permissions = auth.permissions || {};
  const name = String(user.realName || user.name || (auth.mode === 'internal' ? '服务器本机验收' : '已授权成员'));
  const role = permissions.super_admin || permissions.manage_permissions
    ? '中枢管理员'
    : permissions.operation_admin ? '运营管理员' : '已授权成员';
  return { user: { name, role }, permissions: {
    super_admin: Boolean(permissions.super_admin),
    operation_admin: Boolean(permissions.operation_admin),
    manage_permissions: Boolean(permissions.manage_permissions),
  }, access: { required_module: requiredModule }, ...(recoveryReadOnly ? {recovery:recoveryPayload()} : {}) };
}
function centralAccessDenied(res, auth) {
  const status = Number(auth.status || 403);
  const title = status === 503 ? '统一权限服务暂时不可用' : '当前账号无权访问直播中心';
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_top"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7f5;color:#18231f;font:15px system-ui,"Noto Sans SC",sans-serif}.card{width:min(440px,calc(100% - 40px));padding:32px;border:1px solid #e1e8e4;border-radius:16px;background:#fff;box-shadow:0 18px 60px rgba(26,69,49,.09)}h1{margin:0 0 12px;font-size:22px}p{color:#69766f;line-height:1.7}a{display:inline-block;margin-top:12px;padding:10px 16px;border-radius:9px;background:#166b4b;color:#fff;text-decoration:none;font-weight:700}</style></head><body><main class="card"><h1>${title}</h1><p>登录状态与界面权限由 WIS 品牌营销中枢统一管理。</p><a href="${marketingHubUrl}" target="_top" rel="noreferrer">返回中枢</a></main></body></html>`;
  res.writeHead(status, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(body);
}
async function serveStatic(res, pathname) {
  let requestPath; try { requestPath = decodeURIComponent(pathname); } catch { requestPath = '/'; }
  if (requestPath === '/') requestPath = '/index.html';
  const filePath = normalize(join(publicDir, requestPath));
  if (!filePath.startsWith(publicDir)) { res.writeHead(403); return res.end(); }
  try { const info=await stat(filePath); const target=info.isDirectory()?join(filePath,'index.html'):filePath; const extension=extname(target).toLowerCase(); const content=await readFile(target); const headers={'Content-Type':mime[extension] || 'application/octet-stream','X-Content-Type-Options':'nosniff'}; if(['.html','.css','.js'].includes(extension))headers['Cache-Control']='no-store';if(requestPath==='/index.html')Object.assign(headers, frameHeaders); res.writeHead(200, headers); res.end(extension==='.html' ? withRecoveryBanner(content) : content); } catch { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Not found'); }
}
async function serveIndex(res, auth) {
  try {
    const session = JSON.stringify(centralSession(auth)).replace(/</gu, '\\u003c').replace(/-->/gu, '--\\u003e');
    const template = await readFile(join(publicDir, 'index.html'), 'utf8');
    const content = withRecoveryBanner(template.replace('__PLATFORM_SESSION__', session));
    res.writeHead(200, {
      'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
      ...frameHeaders,
    });
    res.end(content);
  } catch {
    res.writeHead(500, {'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store'});
    res.end('Unable to load live center.');
  }
}
function proxyCollaboration(req, res, routePath, search = '') {
  const childPath = (routePath.slice('/modules/tasks'.length) || '/') + search;
  const upstream = httpRequest({hostname:'127.0.0.1',port:3001,path:childPath,method:req.method,headers:{...req.headers,host:'127.0.0.1:3001'}}, response => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });
  upstream.on('error', error => {
    console.error('collaboration proxy failed', error.message);
    if (!res.headersSent) json(res, 503, {ok:false,error:'协同中心服务暂不可用。'}); else res.end();
  });
  req.pipe(upstream);
}
const materialWriteQueue = new Map();
async function serializeMaterial(key, operation) {
  const prior=materialWriteQueue.get(key)||Promise.resolve();
  let release; const lock=new Promise(resolve=>{release=resolve});
  const queued=prior.catch(()=>{}).then(()=>lock); materialWriteQueue.set(key,queued);
  await prior.catch(()=>{});
  try{return await operation()}finally{release();if(materialWriteQueue.get(key)===queued)materialWriteQueue.delete(key)}
}
async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') { res.writeHead(200, {'Content-Type':'text/plain'}); return res.end('ok'); }
  const routePath = url.pathname.startsWith(basePath) ? (url.pathname.slice(basePath.length) || '/') : url.pathname;
  if(routePath==='/api/lifecycle/calendar-auth/callback')return calendarAuth(req,res,url,routePath,null);
  if (routePath === '/auth/login' || routePath === '/auth/callback') return redirect(res, marketingHubUrl);
  const auth = await authorizeCentral(req);
  if (!auth.ok) {
    if (routePath.startsWith('/api/')) return json(res, auth.status, { error: auth.detail });
    return centralAccessDenied(res, auth);
  }
  if (recoveryReadOnly) {
    if (!['GET','HEAD'].includes(req.method) || ['/api/morning/report','/api/intelligence/briefing'].includes(routePath)) {
      return json(res, 423, {ok:false,error:recoveryMessage,code:'recovery_read_only',recovery:recoveryPayload()});
    }
    if (routePath === '/api/recovery/status') return json(res, 200, {ok:true,recovery:recoveryPayload()});
    if (routePath === '/api/lifecycle/snapshot') {
      const module = url.searchParams.get('module') || '';
      if (lifecycleModules.includes(module) && !await readLifecycleSnapshot(module)) {
        return json(res, 503, {ok:false,error:'历史档案快照尚待恢复，暂不提供当前人数或排名。',code:'history_recovery_pending',recovery:recoveryPayload()});
      }
    }
  }
  if (req.method === 'GET' && (routePath === '/' || routePath === '/index.html')) return serveIndex(res, auth);
  if (req.method === 'GET' && routePath === '/api/session') return json(res, 200, centralSession(auth));
  if (req.method === 'GET' && routePath.startsWith('/api/feishu/')) return feishuApi(req,res,url,routePath);
  if (req.method === 'GET' && routePath.startsWith('/api/intelligence/')) return intelligenceApi(req,res,url,routePath);
  if (req.method === 'GET' && routePath.startsWith('/api/modules/')) return moduleDataApi(req,res,url,routePath);
  if (req.method === 'GET' && routePath.startsWith('/api/morning/')) return morningApi(req,res,url,routePath);
  if (routePath.startsWith('/api/material-cards')) return serializeMaterial('cards',()=>materialCardsApi(req,res,routePath,auth));
  if (routePath.startsWith('/api/material-assets')) return serializeMaterial('assets',()=>materialAssetsApi(req,res,routePath,auth));
  if (routePath.startsWith('/api/material-links')) return materialLinksApi(req,res,routePath,auth);
  if (routePath.startsWith('/api/calendar-overrides')) return calendarOverridesApi(req,res,routePath,auth);
  if (routePath.startsWith('/api/script-generator/')) return scriptGeneratorApi(req,res,routePath,auth);
  if (routePath.startsWith('/api/anchor-development')) return anchorDevelopmentApi(req,res,routePath,auth);
  if (routePath.startsWith('/api/lifecycle/calendar-auth/')) return calendarAuth(req,res,url,routePath,auth);
  if (routePath.startsWith('/api/lifecycle/')) return lifecycleApi(req,res,url,routePath,auth);
  if (routePath === '/modules/tasks' || routePath.startsWith('/modules/tasks/')) return proxyCollaboration(req,res,routePath,url.search);
  return serveStatic(res,routePath);
}
createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    console.error('request failed', error?.details || error?.message || error);
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    json(res, status, {ok:false,error:error?.message || '服务器请求失败。',code:error?.details || 'internal_error'});
  });
}).listen(port, '0.0.0.0', () => {
  console.log(`Live Hub listening on ${port}`);
  if (!minimaxReady()) {
    console.warn('MiniMax intelligence is disabled: missing server configuration.');
  } else if (!lifecycleSchedulerEnabled) {
    console.log('Candidate runtime: background AI schedules are isolated during release verification.');
  } else {
    console.log(`AI intelligence scheduled every ${intelligenceRefreshMinutes} minutes with ${activeAnalysisModel()}.`);
    // Give the business-critical lifecycle catch-up refresh the AI gateway first
    // after a restart. Intelligence follows once recruitment/anchor snapshots are
    // stable, preventing simultaneous large requests from timing each other out.
    setTimeout(() => generateIntelligence().catch(error => console.error('initial intelligence refresh failed', error.details || error.message)), 120000);
    setInterval(() => generateIntelligence(true).catch(error => console.error('scheduled intelligence refresh failed', error.details || error.message)), intelligenceRefreshMinutes * 60 * 1000).unref();
    const refreshMorningIfDue = () => {
      const now = new Date(); const minutes = chinaMinutes(now); const date = chinaDate(now);
      if (minutes < 420 || minutes > 550) return;
      const bucket = `${date}:${Math.floor(minutes / 15)}`;
      if (morningState.lastAttemptDate === bucket) return;
      morningState.lastAttemptDate = bucket;
      generateMorningReport(date, true).catch(error => console.error('scheduled morning refresh failed', error.details || error.message));
    };
    setTimeout(refreshMorningIfDue, 12000);
    setInterval(refreshMorningIfDue, 5 * 60 * 1000).unref();
  }
  if (lifecycleSchedulerEnabled) {
    const refreshLifecycleIfDue = () => {
      const check = isLifecycleRefreshDue({
        now:new Date(), lastAutomaticSlot:lifecycleState.lastAutomaticSlot, times:lifecycleRefreshTimes
      });
      if (!check.due || lifecycleState.running) return;
      refreshLifecycleModules(lifecycleModules, 'automatic', check.slotKey).catch(error => console.error('scheduled lifecycle refresh failed', error.details || error.message));
    };
    console.log(`Recruitment and anchor lifecycle refresh scheduled daily at ${lifecycleRefreshTimes.join(', ')} Asia/Shanghai.`);
    setTimeout(refreshLifecycleIfDue, 15000);
    setInterval(refreshLifecycleIfDue, 5 * 60 * 1000).unref();
  }
});
