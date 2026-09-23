import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');

test('anchor lifecycle reads the latest Feishu ranking image instead of the full text document', () => {
  assert.match(source, /async function documentRankingEvidence/);
  assert.match(source, /blocks\?page_size=500/);
  assert.match(source, /async function recognizeRankingImage/);
  assert.match(source, /deepseek-v4-flash-vision-exp/);
  const refresh = source.slice(source.indexOf('async function refreshAnchorLifecycle'), source.indexOf('async function refreshLifecycleModules'));
  assert.match(refresh, /generateAnchorRankingReport\(\)/);
  assert.doesNotMatch(refresh, /generateMorningReport\(/);
});

test('partial room refresh preserves the last valid ranking for rooms without a new screenshot', () => {
  assert.match(source, /rooms: rankingUpdated \? \{\.\.\.\(previous\?\.rooms \|\| \{\}\),\.\.\.normalized\.rooms\}/);
  assert.match(source, /sourceCoverage:\{documents:sources\.length,imagesRecognized:rooms\.length,roomSourceDates,failures/);
});
