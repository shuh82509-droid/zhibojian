// Dispatch sheets use a Beijing business day starting at 05:30.
// Convert schedule hours to absolute instants before matching a live session.
export function dispatchShift(role: 'anchor' | 'assistant', date: string, value: unknown) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(value) || value.length < 3 || !String(value[2] ?? '').trim()) return null;
  const base = Date.parse(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(base) || new Date(base + 8 * 3600000).toISOString().slice(0, 10) !== date) return null;
  const minute = (v: unknown) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v));
    if (!m || +m[1] > 24 || +m[2] > 59 || (+m[1] === 24 && +m[2] !== 0)) return NaN;
    return +m[1] * 60 + +m[2];
  };
  let start = minute(value[0]), end = minute(value[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return null;
  if (start < 330) start += 1440;
  if (end <= 330) end += 1440;
  if (end <= start) end += 1440;
  return { role, name: String(value[2]).trim(), startAt: new Date(base + start * 60000).toISOString(), endAt: new Date(base + end * 60000).toISOString() };
}
