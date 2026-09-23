const { parseScheduleSheets } = require('./schedule-api-server');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const sheets = JSON.parse(input);
  const parsed = parseScheduleSheets(sheets, '2026-08-18');
  const summary = {
    inputSummary: Object.fromEntries(Object.entries(sheets).map(([code, rows]) => [code, {
      rows: Array.isArray(rows) ? rows.length : -1,
      firstCell: Array.isArray(rows) ? rows[0]?.[0] : null,
    }])),
    rooms: parsed.rooms.map((room) => ({
      code: room.code,
      name: room.name,
      anchors: room.anchors,
      assistants: room.assistants,
    })),
    roster: parsed.roster,
    sourceStatus: parsed.sourceStatus,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (parsed.rooms.some((room) => room.anchors.length === 0)) process.exitCode = 2;
  if (parsed.roster.length === 0) process.exitCode = 3;
});
