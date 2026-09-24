'use strict';

// Loaded only by planning-baseline.test.js child processes; never by the app.
const originalFetch = globalThis.fetch;
const totalToken = 'Wj4zs3oDfhGUfetlTXicxblmnHe';
const roomToken = 'EuYqssm4WhNwAvtyybKcDdk1ned';
const rows = [
  ['姓名', '9月24日', '9月25日', '9月26日', '9月27日'],
  ['潘小慧', 'L（05:30-14:30）', '休息', 'L（05:30-14:30）', ''],
  ['丁阳虹', '休息', 'AC1（07:30-16:30）', 'J2（14:30-23:00）', ''],
  ['王思佳', 'R（06:30-15:30）', 'R（06:30-15:30）', '休息', ''],
  ['李安妮', '休息', 'X（10:00-19:00）', 'X（10:00-19:00）', ''],
];
const roomRows = {
  NYB2iu: [['9月25日\n星期五', 'wis官旗', '时间', '05:30-08:00'], ['', '', '主播', '潘小慧'], ['', '', '', '05:30-10:00'], ['', '', '', '尹珩瑞']],
  MVpDv0: [['9月25日\n星期五', '丁阳虹', 'AC1（07:30-16:30）', '05:30-08:00'], ['', '陈璐', '休息', '丁阳虹']],
  LRAvIU: [['9月25日\n星期五', '李安妮', 'X（10:00-19:00）', '05:30-08:00'], ['', '黄芷曈', '休息', '李安妮']],
  PhlV42: [['9月25日\n星期五', '王思佳', 'R（06:30-15:30）', '05:30-08:00'], ['', '刁心然', '休息', '王思佳']],
};
const json = (value, status = 200) => new Response(JSON.stringify(value), {status,headers:{'content-type':'application/json'}});

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://open.feishu.cn') return originalFetch(input, init);
  const pathname = decodeURIComponent(url.pathname);
  const revision = Number(process.env.TEST_FEISHU_REVISION || 499);
  if (pathname.endsWith('/auth/v3/tenant_access_token/internal')) return json({code:0,tenant_access_token:'fixture-token',expire:7200});
  if (pathname.includes('/wiki/v2/spaces/get_node')) return json({code:403,msg:'fixture: previous month unavailable'},403);
  if (pathname.includes(`/sheets/v3/spreadsheets/${totalToken}/sheets/query`)) return json({code:0,data:{sheets:[{sheet_id:'0jFdXf',title:'排班表',grid_properties:{row_count:5,column_count:5}}]}});
  if (pathname.includes(`/sheets/v2/spreadsheets/${totalToken}/values/`)) return json({code:0,data:{revision,valueRange:{range:'0jFdXf!A1:E5',values:rows}}});
  if (pathname.includes(`/sheets/v3/spreadsheets/${roomToken}/sheets/query`)) return json({code:0,data:{revision:499,sheets:[]}});
  if (pathname.includes(`/sheets/v2/spreadsheets/${roomToken}/values/`)) {
    const sheetId = pathname.split('/values/')[1].split('!')[0];
    return json({code:0,data:{revision:499,valueRange:{range:`${sheetId}!A1:Q4`,values:roomRows[sheetId] || []}}});
  }
  return json({code:404,msg:'unexpected fixture request'},404);
};
