import test from 'node:test';
import assert from 'node:assert/strict';
import { frameHeadersForHub } from './frame-policy.mjs';

test('standalone live room remains unembeddable by default', () => {
  assert.deepEqual(frameHeadersForHub(false), {
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
  });
});

test('new hub only permits embedding from the same origin', () => {
  assert.deepEqual(frameHeadersForHub(true), {
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self'",
  });
});
