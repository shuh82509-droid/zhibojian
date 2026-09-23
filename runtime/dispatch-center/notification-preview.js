const ROOM_CODES = ['guanqi', 'brand_selection', 'youxuan', 'wangou'];
const MAX_SOURCE_AGE_MS = 2 * 60 * 60 * 1000;

function pending(reason, details = []) {
  return {status: 'pending', reason, details, messages: [], readyForSend: false};
}

function tomorrowInChina(now) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(now);
  return new Date(Date.parse(`${today}T00:00:00Z`) + 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
}

function shiftEntry(shift, role, room) {
  if (!Array.isArray(shift) || shift.length < 3) return null;
  const [start, end, name] = shift.map(value => String(value ?? '').trim());
  if (!start || !end || !name || name === '待核验') return null;
  return {
    room: room.name, roomCode: room.code, role, name, start, end,
    text: `【${room.name}直播间开播提醒】\n${name}你好！明天你被安排在 ${start}—${end} 担任${role}，请提前做好开播准备。\n⏰ 请确认能否准时开播，如有问题及时沟通。`,
  };
}

/**
 * Prepare the next-day roster without contacting Feishu. A cached recovery
 * snapshot, stale read, or an incomplete room blocks the whole batch.
 * Recipient open IDs and actual delivery receipts are verified separately.
 */
function buildOpeningPreview(schedule, {date, now = new Date()} = {}) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(date || '')) || schedule?.date !== date) {
    return pending('排班日期不匹配');
  }
  if (date !== tomorrowInChina(now)) return pending('仅能预览北京时间的次日开播提醒');
  if (schedule?.recovery?.readOnly || schedule?.source?.mode === 'verified_backup') {
    return pending('当前是只读备份，不能用于开播提醒');
  }
  const readAt = Date.parse(schedule?.updatedAt || '');
  const age = now.getTime() - readAt;
  if (!Number.isFinite(readAt) || age < -5 * 60 * 1000 || age > MAX_SOURCE_AGE_MS) {
    return pending('班表读取时间待核验或已过期');
  }
  const rooms = Array.isArray(schedule?.rooms) ? schedule.rooms : [];
  const missing = ROOM_CODES.filter(code => !schedule?.sourceStatus?.[code]?.found || !rooms.some(room => room.code === code));
  if (missing.length) return pending('直播间班表不完整', missing);

  const messages = [];
  for (const room of rooms.filter(item => ROOM_CODES.includes(item.code))) {
    for (const [key, role] of [['anchors', '主播'], ['assistants', '助理']]) {
      if (!Array.isArray(room[key])) return pending('班次结构待核验', [room.name, key]);
      for (const shift of room[key]) {
        const message = shiftEntry(shift, role, room);
        if (!message) return pending('班次姓名或时间待核验', [room.name, role]);
        messages.push(message);
      }
    }
  }
  if (!messages.length) return pending('当天没有可核验的开播班次');
  return {
    status: 'preview', date, sourceReadAt: schedule.updatedAt,
    messages, readyForSend: false,
    reason: '仅生成预览；须核对每位收件人的飞书 open_id、品牌营销部中枢机器人身份及发送回执后才能启用',
  };
}

module.exports = {buildOpeningPreview};
