'use strict';
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
function unavailable(detail) { return Object.assign(new Error('原表只读备份不可用：'+detail),{status:503,code:'source_snapshot_unavailable'}); }
function createSnapshotReader(file, expectedSha256) {
  let cached;
  async function load() {
    if (!cached) cached = (async()=>{
      if (!file || !/^[a-f0-9]{64}$/i.test(expectedSha256||'')) throw unavailable('缺少明确路径或 SHA-256');
      let bytes;try{bytes=await fs.readFile(file);}catch{throw unavailable('文件待恢复');}
      if(crypto.createHash('sha256').update(bytes).digest('hex')!==expectedSha256.toLowerCase()) throw unavailable('校验值不匹配');
      let parsed;try{parsed=JSON.parse(bytes);}catch{throw unavailable('文件格式损坏');}
      if(parsed?.schemaVersion!==1||parsed.mode!=='verified_backup'||parsed.readOnly!==true||parsed.historyRecovered!==false||!parsed.workbooks||Array.isArray(parsed.workbooks)||!Object.keys(parsed.workbooks).length)throw unavailable('来源结构不正确');
      for(const [token,w] of Object.entries(parsed.workbooks)) {
        const official = w?.source?.mode === 'official_user_snapshot';
        if(w?.source?.spreadsheetToken!==token||(!official && w.source.mode!=='verified_backup')||!w.source.readAt||!w.source.sourceModifiedAt||!(official ? /^[a-f0-9]{64}$/i.test(w.source.rawBundleSha256) && w.source.identity==='user' && Array.isArray(w.source.receipts) && w.source.receipts.length>0 && w.source.receipts.every(r=>/^[a-f0-9]{64}$/i.test(r.sha256)&&r.readAt&&r.range&&r.sheetId) : /^[a-f0-9]{64}$/i.test(w.source.xlsxSha256))||!w.sheets||Array.isArray(w.sheets)||!Object.keys(w.sheets).length)throw unavailable('原文件证据不完整');
        for(const s of Object.values(w.sheets))if(!Array.isArray(s.rows)||!s.rows.length||s.rows.some(r=>!Array.isArray(r)||r.some(c=>typeof c!=='string')))throw unavailable('原表行结构不正确');
      }
      return parsed;
    })();
    return cached;
  }
  function column(v){let n=0;for(const c of v)n=n*26+c.charCodeAt(0)-64;return n-1;}
  async function workbook(token){const w=(await load()).workbooks[token];if(!w)throw unavailable('该工作簿未备份');return w;}
  return {
    load,
    async summary(){const s=await load();return {mode:s.mode,readOnly:true,historyRecovered:false,createdAt:s.createdAt,sha256:expectedSha256,sources:Object.values(s.workbooks).map(w=>({...w.source,sheets:Object.entries(w.sheets).map(([sheetId,s])=>({sheetId,title:s.title,rowCount:s.rowCount,columnCount:s.columnCount}))})),limitations:s.limitations};},
    async resolveWiki(wiki,override=''){if(override){await workbook(override);return override;}const item=Object.entries((await load()).workbooks).find(([,w])=>w.source.wikiToken===wiki);if(!item)throw unavailable('该 Wiki 未映射');return item[0];},
    async resolveSheet(token,preferred=''){const w=await workbook(token);if(preferred){if(!w.sheets[preferred])throw unavailable('该子表未备份');return preferred;}const ids=Object.keys(w.sheets);if(ids.length!==1)throw unavailable('子表选择不明确');return ids[0];},
    async range(token,range){
      const w=await workbook(token);const m=/^([A-Za-z0-9]+)!([A-Z]+)(\d*):([A-Z]+)(\d*)$/.exec(range);
      if(!m)throw unavailable('范围格式不支持');const sheet=w.sheets[m[1]];if(!sheet)throw unavailable('该子表未备份');
      const r0=m[3]?Number(m[3])-1:0,r1=m[5]?Number(m[5]):sheet.rows.length,c0=column(m[2]),c1=column(m[4])+1;
      if(r0<0||r1<=r0||c1<=c0||r0>=sheet.rows.length||c0>=sheet.columnCount)throw unavailable('请求范围不在备份中');
      return {rows:sheet.rows.slice(r0,Math.min(r1,sheet.rows.length)).map(r=>r.slice(c0,Math.min(c1,sheet.columnCount))),revision:w.source.revision,source:{...w.source,sheetId:m[1],range,readOnly:true,permissionStatus:'只读来源备份 · 非实时',clippedToExportBounds:r1>sheet.rows.length||c1>sheet.columnCount}};
    }
  };
}
module.exports={createSnapshotReader};
