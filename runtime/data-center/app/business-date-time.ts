/** Preserve naive business-local dates; render actual instants in Shanghai. */
export function businessDateTime(value: string): string {
  if (!value) return "—";
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/u.test(value)) return "待核验";
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/iu.test(value)) return value.slice(0, 16).replace("T", " ");
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "待核验";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}
