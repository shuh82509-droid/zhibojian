import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const outputRelativeDir = join('exports', 'anchor-archives', 'assets', 'base-avatars');
const outputDir = join(root, outputRelativeDir);
const outputJson = join(root, 'exports', 'anchor-archives', 'assets', 'anchor-profiles.json');
const baseToken = 'R5ntb369Tap1sisGt5dcPsIpnnf';
const tableId = 'tblDHQ06n9PBtToW';
const viewId = 'vewKuBxJAm';

function runLark(args) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'lark-cli.cmd' : 'lark-cli';
    const child = spawn(command, args, {shell:process.platform === 'win32',windowsHide:true});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout || `lark-cli exited ${code}`)));
  });
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  if (value && typeof value === 'object') return text(value.name ?? value.text ?? value.value ?? '');
  return String(value ?? '').trim();
}

function date(value) {
  const match = text(value).match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] || '';
}

function parseCliJson(output) {
  const start = output.indexOf('{');
  if (start < 0) throw new Error('lark-cli did not return JSON');
  return JSON.parse(output.slice(start));
}

await mkdir(outputDir, {recursive:true});
const response = parseCliJson(await runLark([
  'base', '+record-list', '--base-token', baseToken, '--table-id', tableId,
  '--view-id', viewId, '--page-size', '200', '--as', 'user', '--format', 'json'
]));
if (!response.ok) throw new Error(response.error?.message || '主播档案多维表读取失败');
const data = response.data || {};
const fields = Array.isArray(data.fields) ? data.fields : [];
const rows = Array.isArray(data.data) ? data.data : [];
const recordIds = Array.isArray(data.record_id_list) ? data.record_id_list : [];
const profiles = [];
const failures = [];

for (let index = 0; index < rows.length; index += 1) {
  const values = rows[index] || [];
  const row = Object.fromEntries(fields.map((field, column) => [field, values[column]]));
  const name = text(row['主播姓名']);
  if (!name || !text(row['主播状态']).includes('在职')) continue;
  const attachment = Array.isArray(row['上播截屏']) ? row['上播截屏'].find(item => item?.file_token) : null;
  let photoFile = '';
  if (attachment?.file_token) {
    const sourceExtension = extname(String(attachment.name || '')).toLowerCase();
    const extension = /^\.(?:png|jpe?g|webp)$/.test(sourceExtension) ? sourceExtension : '.jpg';
    photoFile = `${createHash('sha256').update(`${name}:${attachment.file_token}`).digest('hex').slice(0, 20)}${extension}`;
    const target = join(outputDir, photoFile);
    try { await stat(target); }
    catch {
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await runLark([
            'base', '+record-download-attachment', '--base-token', baseToken, '--table-id', tableId,
            '--record-id', recordIds[index], '--file-token', attachment.file_token,
            '--output', join(outputRelativeDir, photoFile), '--overwrite', '--as', 'user'
          ]);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
      }
      if (lastError) {
        failures.push({name,error:String(lastError.message || lastError).slice(0, 180)});
        photoFile = '';
      }
    }
  }
  profiles.push({
    name,
    room:text(row['所属直播间']),
    makeupArtist:text(row['化妆师']),
    hireDate:date(row['入职日期']),
    recordUpdatedAt:text(row['更新时间']),
    photoFile,
    sourceRecordId:recordIds[index] || ''
  });
}

const generatedAt = new Date().toISOString();
await writeFile(outputJson, `${JSON.stringify({generatedAt,baseToken,tableId,viewId,profiles}, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ok:true,generatedAt,profiles:profiles.length,photos:profiles.filter(item => item.photoFile).length,failures,outputJson}));
