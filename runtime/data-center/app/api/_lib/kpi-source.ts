type Sheet = { sheet_id?: unknown; title?: unknown; [key: string]: unknown };

export function headerMonth(rows: unknown[][]): string | null {
  const header = (rows[0] || []).map(value => String(value ?? '')).join(' ').normalize('NFKC');
  const months = [...header.matchAll(/(20\d{2})\s*年\s*(\d{1,2})\s*月/g)]
    .map(match => `${match[1]}-${match[2].padStart(2, '0')}`);
  const unique = [...new Set(months)];
  return unique.length === 1 && Number(unique[0].slice(-2)) >= 1 && Number(unique[0].slice(-2)) <= 12 ? unique[0] : null;
}

// Tab names may remain unchanged when the business copies a prior month's sheet.
// The business heading must establish the month; never use position or recency.
export async function selectKpiSheet(sheets: Sheet[], month: string, readHeader: (id: string) => Promise<unknown[][]>): Promise<Sheet> {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('目标业务月份无效');
  if (!sheets.length || sheets.length > 36) throw new Error('目标工作表范围需要核验');
  const matches: Sheet[] = [];
  for (let start = 0; start < sheets.length; start += 4) {
    const batch = await Promise.all(sheets.slice(start, start + 4).map(async sheet => {
      const id = String(sheet.sheet_id ?? '');
      if (!id) throw new Error('目标工作表缺少来源标识');
      const businessMonth = headerMonth(await readHeader(id));
      return businessMonth === month ? sheet : null;
    }));
    matches.push(...batch.filter((sheet): sheet is Sheet => sheet !== null));
  }
  if (matches.length !== 1) throw new Error(matches.length ? `${month} 存在多个目标来源，请确认后再计算` : `KPI目标汇总未找到表内月份为 ${month} 的目标`);
  return matches[0];
}

export function targetCompletion(actual: number | null, target: number | null, basis: string): number | null {
  if (actual === null || !Number.isFinite(actual) || !target || !Number.isFinite(target) || target <= 0) return null;
  if (!['gmv_minus_refund', 'daily_channel_net'].includes(basis)) return null;
  return Number((actual / target * 100).toFixed(1));
}
