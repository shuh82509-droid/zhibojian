'use strict';

// Loaded only by the isolated API test process. No request to Feishu or any
// other public host may escape this fixture.
const nativeFetch = global.fetch;
const scenario = process.env.MOCK_REST_SCENARIO || 'valid';
const workbook = 'Wj4zs3oDfhGUfetlTXicxblmnHe';
const sheetId = '0jFdXf';
const rows = Array.from({length:190}, () => Array(34).fill(''));
rows[3].splice(0, 4, 'UID', '部门', '工号', '姓名');
for (let day = 1; day <= 30; day += 1) rows[3][day + 3] = `2026/9/${day}`;
const first = '甲乙丙丁戊己庚辛';
const second = '子丑寅卯辰巳午未申酉';
for (let index = 0; index < 52; index += 1) {
  const row = rows[index + 4];
  row[0] = `fixture-uid-${index + 1}`;
  row[1] = `凡岛-品牌营销部-直播中心-${index % 2 ? '官旗' : '优选'}`;
  row[2] = `fixture-employee-${index + 1}`;
  row[3] = `测${first[Math.floor(index / 10)]}${second[index % 10]}`;
}
if (scenario === 'full-aggregate') {
  const grayCells = new Set([
    'E47','F47','E48','F48','E49','F49','G49','H49','I49','J49',
    'E54','F54','E55','F55','G55','H55','I55','J55','K55','L55','M55','N55','O55','P55','Q55','R55','S55','T55',
    'E56','F56','G56','H56','I56','J56','K56','L56','M56','N56','O56','P56','Q56','R56','S56','T56','U56','V56','W56','X56',
  ]);
  const invalid = new Set(['AG40','AH40','AD48']);
  const available = [];
  function columnName(index) {
    let value = index + 1; let name = '';
    while (value > 0) { value -= 1; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26); }
    return name;
  }
  for (let row = 4; row < 56; row += 1) {
    for (let column = 4; column < 34; column += 1) {
      const cell = `${columnName(column)}${row + 1}`;
      if (grayCells.has(cell)) continue;
      rows[row][column] = 'L(05:30-14:30)';
      if (invalid.has(cell)) rows[row][column] = 'R（06:30-15:31）';
      else available.push([row,column]);
    }
  }
  available.slice(0, 68).forEach(([row,column]) => { rows[row][column] = ''; });
  available.slice(68, 402).forEach(([row,column]) => { rows[row][column] = '休息'; });
} else {
  rows[4][4] = '休息';
  rows[4][5] = 'L(05:30-14:30)';
  rows[46][4] = '休息'; // E47 is gray in the revision-505 audit: never count it.
}
if (scenario === 'duplicate-identity') rows[5][0] = rows[4][0];

function reply(payload, status = 200) {
  return new Response(JSON.stringify(payload), {status, headers:{'Content-Type':'application/json'}});
}

global.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(input, options);
  if (url.origin !== 'https://open.feishu.cn') throw new Error(`External fixture request blocked: ${url.origin}`);
  const route = url.pathname;
  if (route === '/open-apis/auth/v3/tenant_access_token/internal') {
    return reply({code:0,tenant_access_token:'fixture-token',expire:7200});
  }
  if (route === '/open-apis/wiki/v2/spaces/get_node') {
    return reply({code:0,data:{node:{obj_token:scenario === 'wrong-workbook' ? 'wrong-fixture-workbook' : workbook}}});
  }
  if (route === `/open-apis/sheets/v3/spreadsheets/${workbook}/sheets/query`) {
    return reply({code:0,data:{sheets:[{sheet_id:sheetId,title:'排班表',
      grid_properties:{row_count:scenario === 'wrong-dimensions' ? 191 : 190,column_count:34}}]}});
  }
  if (route === `/open-apis/sheets/v2/spreadsheets/${workbook}/values/${encodeURIComponent(`${sheetId}!A1:AH${scenario === 'wrong-dimensions' ? 191 : 190}`)}`) {
    return reply({code:0,data:{revision:scenario === 'revision-drift' ? 506 : 505,
      valueRange:{range:`${sheetId}!A1:AH190`,values:rows}}});
  }
  throw new Error(`Unexpected Feishu fixture route: ${route}`);
};
