export type CalendarReadState = { available: boolean; readOnly: boolean; message: string };

// A missing recovery file is not an empty calendar. Keep this independent of
// the overview source so one failed input does not blank the other panels.
export function calendarReadState(status: number, payload: { ok?: boolean; readOnly?: boolean; error?: string }): CalendarReadState {
  if (status < 200 || status >= 300 || payload.ok !== true) {
    return { available: false, readOnly: true, message: payload.error || '人工日历暂不可读取，已保留现有内容，请稍后重试。' };
  }
  return { available: true, readOnly: payload.readOnly === true, message: payload.readOnly ? '当前为只读恢复状态，人工调整暂未开放。' : '' };
}
