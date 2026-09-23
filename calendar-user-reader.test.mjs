import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCalendarUserReader} from './calendar-user-reader.mjs';

const scope = 'calendar:calendar:read calendar:calendar.event:read offline_access';
function setup(dir, fetchImpl, now = () => 1_000_000) {
  return createCalendarUserReader({appId:'cli_test',appSecret:'test_secret',calendarId:'test_calendar',expectedOpenId:'ou_expected',
    redirectUri:'https://example.com/fd-027340/live-center-workbench/api/lifecycle/calendar-auth/callback',
    storePath:join(dir,'calendar-user.enc'),encryptionKey:randomBytes(32).toString('base64'),fetchImpl,now});
}
function response(data, status = 200) { return {ok:status >= 200 && status < 300,status,json:async () => data}; }
test('OAuth binds state to callback, verifies reader and stores only encrypted credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(),'calendar-reader-test-'));
  try {
    const calls = [];
    const reader = setup(dir, async (url, options) => {
      calls.push([url,options]);
      if (url.endsWith('/oauth/v3/token')) return response({code:0,access_token:'sensitive_access',refresh_token:'sensitive_refresh',expires_in:7200,refresh_token_expires_in:604800,scope});
      if (url.endsWith('/user_info')) return response({code:0,data:{open_id:'ou_expected'}});
      return response({code:0,data:{items:[{summary:'正式面试'}]}});
    });
    assert.equal((await reader.status()).authorized,false);
    const attempt = reader.begin();
    const url = new URL(attempt.url);
    assert.equal(url.searchParams.get('scope'),scope);
    assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    await assert.rejects(reader.complete({code:'test_code',state:attempt.state,cookieState:'wrong'}),{code:'calendar_oauth_state_invalid'});
    const valid = reader.begin();
    assert.equal((await reader.complete({code:'test_code',state:valid.state,cookieState:valid.state})).authorized,true);
    assert.equal(calls.length,2);
    const stored = await readFile(join(dir,'calendar-user.enc'),'utf8');
    assert.doesNotMatch(stored,/sensitive_access|sensitive_refresh|ou_expected/u);
    assert.equal((await reader.get('/calendar/v4/calendars/test_calendar/events')).items[0].summary,'正式面试');
    assert.equal(calls.length,3);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('wrong user and missing scope fail closed without saving credentials', async () => {
  for (const [identity, tokenScope, code] of [['ou_other',scope,'calendar_oauth_wrong_user'],['ou_expected','calendar:calendar:read','calendar_scope_missing']]) {
    const dir = await mkdtemp(join(tmpdir(),'calendar-reader-test-'));
    try {
      const reader = setup(dir, async url => url.endsWith('/oauth/v3/token')
        ? response({code:0,access_token:'access',refresh_token:'refresh',expires_in:7200,refresh_token_expires_in:604800,scope:tokenScope})
        : response({code:0,data:{open_id:identity}}));
      const attempt = reader.begin();
      await assert.rejects(reader.complete({code:'test_code',state:attempt.state,cookieState:attempt.state}),{code});
      assert.equal((await reader.status()).authorized,false);
    } finally { await rm(dir,{recursive:true,force:true}); }
  }
});
test('expired access token rotates refresh token once across parallel reads', async () => {
  const dir = await mkdtemp(join(tmpdir(),'calendar-reader-test-'));
  let clock = 1_000_000;
  let refreshes = 0;
  try {
    const reader = setup(dir, async (url, options) => {
      if (url.endsWith('/oauth/v3/token')) {
        const body = JSON.parse(options.body);
        if (body.grant_type === 'refresh_token') {
          refreshes += 1;
          assert.equal(body.refresh_token,'refresh_1');
          return response({code:0,access_token:'access_2',refresh_token:'refresh_2',expires_in:7200,refresh_token_expires_in:604800,scope});
        }
        return response({code:0,access_token:'access_1',refresh_token:'refresh_1',expires_in:7200,refresh_token_expires_in:604800,scope});
      }
      if (url.endsWith('/user_info')) return response({code:0,data:{open_id:'ou_expected'}});
      return response({code:0,data:{items:[]}});
    },() => clock);
    const attempt = reader.begin();
    await reader.complete({code:'test_code',state:attempt.state,cookieState:attempt.state});
    clock += 7_000_000;
    await Promise.all([reader.get('/calendar/v4/calendars/test_calendar/events'),reader.get('/calendar/v4/calendars/test_calendar/events')]);
    assert.equal(refreshes,1);
    assert.equal((await reader.status()).authorized,true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
