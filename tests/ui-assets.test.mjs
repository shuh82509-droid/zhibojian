import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)]
    .filter(match => !/\bsrc\s*=/iu.test(match[0]))
    .map(match => match[1]);
}

test('both lifecycle pages have syntactically valid inline scripts', async () => {
  for (const relative of ['exports\\recruitment-pool\\recruitment-dashboard.html','exports\\anchor-archives\\recruitment-dashboard.html','exports\\material-center\\material-cue-cards.html','exports\\material-center\\material-competitors.html','exports\\material-center\\material-prohibited.html']) {
    const html = await readFile(join(root, relative), 'utf8');
    for (const source of inlineScripts(html)) assert.doesNotThrow(() => new Function(source), `${relative} has invalid inline JavaScript`);
  }
});

test('anchor ranking uses monthly GMV and material centre exposes competitor and cue-card modules', async () => {
  const [anchors, materials, cueCards, prohibited] = await Promise.all([
    readFile(join(root, 'exports\\anchor-archives\\recruitment-dashboard.html'), 'utf8'),
    readFile(join(root, 'exports\\material-center\\material-center.html'), 'utf8'),
    readFile(join(root, 'exports\\material-center\\material-cue-cards.html'), 'utf8'),
    readFile(join(root, 'exports\\material-center\\material-prohibited.html'), 'utf8'),
  ]);
  for (const text of ['主播当月 GMV 排名','monthlyGmv','monthlyRankInfo','相邻排名差距','近 5 日主播评价','近 3 日个人录音']) assert.ok(anchors.includes(text), `anchor page missing ${text}`);
  assert.ok(!anchors.includes('<h2>主播评分排名</h2>'));
  for (const text of ['竞对分析','直播手卡','违禁词资料','material-competitors.html','material-cue-cards.html','material-prohibited.html']) assert.ok(materials.includes(text), `material centre missing ${text}`);
  assert.ok(materials.includes('material-cue-cards.html?embed=1&amp;v=20260903a'), 'cue-card frame must carry a cache-busting version');
  for (const text of ['/api/material-cards','/api/material-assets','直播间','品类','标题','coverFile','type="file"','multiple','cue-folder-grid','版本记录','titleInput',"newCard=document.querySelector('#newCard')","saveCard=document.querySelector('#saveCard')"]) assert.ok(cueCards.includes(text), `cue cards missing ${text}`);
  assert.doesNotMatch(cueCards, />流程状态<select/u);
  assert.ok(!cueCards.includes('违禁词资料库'), 'cue-card page must not mix in the prohibited-word archive');
  for (const text of ['违禁词资料','/api/material-assets','/api/material-links','prohibited-word',"kind:'prohibited'",'飞书 Wiki / 飞书 Docx']) assert.ok(prohibited.includes(text), `prohibited archive missing ${text}`);
});

test('material archives accept local assets and Wiki or Docx links for all three archives', async () => {
  const [server, scripts, competitors] = await Promise.all([
    readFile(join(root, 'server.js'), 'utf8'),
    readFile(join(root, 'exports\\material-center\\material-scripts.html'), 'utf8'),
    readFile(join(root, 'exports\\material-center\\material-competitors.html'), 'utf8'),
  ]);
  for (const text of ['/api/material-assets','material-uploads','cue-card','prohibited-word']) assert.ok(server.includes(text), `material asset API missing ${text}`);
  for (const text of ['/api/material-links','kind','communication','competitor','prohibited','wiki|docx','sourceType']) assert.ok(server.includes(text), `material link API missing ${text}`);
  for (const text of ['各产品稿件归档','上传稿件','飞书 Wiki 或飞书 Docx','scriptUploadUrl']) assert.ok(scripts.includes(text), `communication archive missing ${text}`);
  assert.match(scripts, /\.script-upload-form\[hidden\]\{display:none\}/u);
  for (const text of ['新增竞对分析','飞书 Wiki 或飞书 Docx','material-links']) assert.ok(competitors.includes(text), `competitor archive missing ${text}`);
  assert.match(competitors, /\.competitor-form\[hidden\]\{display:none\}/u);
});

test('cue-card archive stays full width until editing and prohibited links live on their own page', async () => {
  const [html, fixes] = await Promise.all([
    readFile(join(root, 'exports\\material-center\\material-cue-cards.html'), 'utf8'),
    readFile(join(root, 'exports\\material-center\\material-cue-cards-fixes.css'), 'utf8'),
  ]);
  for (const text of ['material-cue-cards-fixes.css','editor-open']) assert.ok(html.includes(text), `cue archive missing ${text}`);
  for (const text of ['prohibitedLinkUrl','saveProhibitedLink',"kind:'prohibited'"]) assert.ok(!html.includes(text), `cue archive still mixes prohibited feature ${text}`);
  assert.match(fixes, /\.cue-layout\s*\{\s*display:\s*block/u); assert.match(fixes, /\.cue-layout\.editor-open/u);
});

test('all 22 ranked anchors have an explicit real-avatar or pending-avatar mapping', async () => {
  const context = {window:{}};
  vm.createContext(context);
  vm.runInContext(await readFile(join(root, 'exports\\anchor-archives\\assets\\anchor-data.js'), 'utf8'), context);
  const names = Object.values(context.window.ANCHOR_ARCHIVE.rooms).flat().map(item => item.name);
  const html = await readFile(join(root, 'exports\\anchor-archives\\recruitment-dashboard.html'), 'utf8');
  assert.equal(names.length, 22);
  for (const name of names) assert.match(html, new RegExp(`'${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*:\\s*\\[`), `missing avatar mapping: ${name}`);
  assert.match(html, /MISSING_AVATAR=new Set\(\['朱海鹏','刘睿'\]\)/u);
  assert.ok((await stat(join(root, 'exports\\anchor-archives\\assets\\anchor-avatar-sprite.png'))).size > 100000);
});

test('live ranking snapshots keep the authoritative 22-person roster without stale aliases', async () => {
  const html = await readFile(join(root, 'exports\\anchor-archives\\recruitment-dashboard.html'), 'utf8');
  assert.match(html, /const BASE_ROOMS=/u);
  assert.match(html, /activeNames=new Set\(profiles\.length\?profiles\.map/u);
  assert.match(html, /canonicalAnchorName/u);
  assert.match(html, /'黄芷瞳':'黄芷曈'/u);
  assert.match(html, /if\(!activeNames\.has\(name\)\)continue/u);
});

test('daily refresh controls and failure-safe copy exist on both pages', async () => {
  for (const relative of ['exports\\recruitment-pool\\recruitment-dashboard.html','exports\\anchor-archives\\recruitment-dashboard.html']) {
    const html = await readFile(join(root, relative), 'utf8');
    for (const text of ['每天 09:30、18:00','立即更新','更新记录','保留上一次有效']) assert.ok(html.includes(text), `${relative} missing ${text}`);
  }
});

test('recruitment lifecycle updates do not regress interview or hired candidates to initial screening', async () => {
  const html = await readFile(join(root, 'exports\\recruitment-pool\\recruitment-dashboard.html'), 'utf8');
  assert.match(html, /currentAdvancedStage=\['pending_feedback','interview_fail','interview_pass','hired'\]/u);
  assert.match(html, /incomingInitialStage=\['unmapped','initial_pass','initial_fail'\]/u);
  assert.match(html, /招聘月/u);
  assert.match(html, /初审通过.*初审不通过.*待面评.*面试不通过.*面试通过.*已入职/su);
  assert.match(html, /conversionScreened/u);
  assert.match(html, /unmappedCount/u);
  assert.doesNotMatch(html, />69\.0%<|>44\.8%<|>15\.4%</u);
});

test('ranked anchor cards are backed by Base profile photos, hire dates and makeup artists', async () => {
  const profiles = JSON.parse(await readFile(join(root, 'exports\\anchor-archives\\assets\\anchor-profiles.json'), 'utf8')).profiles;
  const context = {window:{}};
  vm.createContext(context);
  vm.runInContext(await readFile(join(root, 'exports\\anchor-archives\\assets\\anchor-data.js'), 'utf8'), context);
  const names = Object.values(context.window.ANCHOR_ARCHIVE.rooms).flat().map(item => item.name);
  for (const name of names) {
    const profile = profiles.find(item => item.name === name);
    assert.ok(profile, `missing Base profile: ${name}`);
    assert.ok(profile.photoFile, `missing Base photo: ${name}`);
    assert.ok(profile.hireDate, `missing hire date: ${name}`);
    assert.ok(profile.makeupArtist, `missing makeup artist: ${name}`);
    assert.ok((await stat(join(root, 'exports\\anchor-archives\\assets\\base-avatars', profile.photoFile))).size > 1000, `invalid Base photo: ${name}`);
  }
});
