/**
 * Server-only diagnostic: read one cell, write the exact same value, and print
 * only HTTP/code metadata. It never prints credentials or the cell value.
 */
const FEISHU_API = 'https://open.feishu.cn/open-apis';
const spreadsheet = process.env.SCHEDULE_SPREADSHEET_TOKEN || 'EuYqssm4WhNwAvtyybKcDdk1ned';
const requestedRange = process.argv[2];

if (!requestedRange || !process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
  console.error('usage: node diagnose-feishu-write.js <sheetId!A1:A1>');
  process.exit(2);
}

function columnNumberToLetters(columnNumber) {
  let value = columnNumber;
  let letters = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

function locateFirstNonEmptyCell(range, values) {
  const match = /^([^!]+)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/u.exec(range);
  if (!match) throw new Error('invalid A1 range');
  const [, sheetId, startLetters, startRowText] = match;
  const startColumn = [...startLetters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
  const startRow = Number(startRowText);
  for (let rowOffset = 0; rowOffset < values.length; rowOffset += 1) {
    const row = values[rowOffset] || [];
    for (let columnOffset = 0; columnOffset < row.length; columnOffset += 1) {
      const value = row[columnOffset];
      if (String(value ?? '').length > 0) {
        return {
          range: `${sheetId}!${columnNumberToLetters(startColumn + columnOffset)}${startRow + rowOffset}:${columnNumberToLetters(startColumn + columnOffset)}${startRow + rowOffset}`,
          value,
        };
      }
    }
  }
  return null;
}

async function main() {
  const auth = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET }),
  });
  const authPayload = await auth.json();
  if (!authPayload.tenant_access_token) throw new Error(`token failed: ${authPayload.code || auth.status}`);
  const headers = { Authorization: `Bearer ${authPayload.tenant_access_token}` };
  const read = await fetch(
    `${FEISHU_API}/sheets/v2/spreadsheets/${spreadsheet}/values/${encodeURIComponent(requestedRange)}`,
    { headers },
  );
  const readPayload = await read.json();
  const values = readPayload.data?.valueRange?.values || [];
  const located = locateFirstNonEmptyCell(requestedRange, values);
  console.log(`READ_HTTP=${read.status} READ_CODE=${readPayload.code} VALUE_PRESENT=${Boolean(located)}`);
  if (!read.ok || readPayload.code !== 0) process.exit(3);
  if (!located) process.exit(5);

  const write = await fetch(`${FEISHU_API}/sheets/v2/spreadsheets/${spreadsheet}/values`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueRange: { range: located.range, values: [[located.value]] } }),
  });
  const raw = await write.text();
  let writePayload = {};
  try { writePayload = JSON.parse(raw); } catch {}
  const message = String(writePayload.msg || raw || '').replace(/\s+/gu, ' ').slice(0, 240);
  console.log(`WRITE_HTTP=${write.status} WRITE_CODE=${writePayload.code ?? 'none'} WRITE_MSG=${message}`);
  process.exit(write.ok && writePayload.code === 0 ? 0 : 4);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
