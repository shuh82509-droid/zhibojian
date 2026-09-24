# Calendar read-only device authorization recovery

This operator-only helper uses the official Feishu device authorization flow.
It does not add an HTTP endpoint, expand application permissions, import CLI or
browser tokens, create calendar events, or complete workflow tasks.

Required configuration comes from the existing protected production environment:
`FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `RECRUITMENT_CALENDAR_ID`,
`RECRUITMENT_CALENDAR_READER_OPEN_ID`, `RECRUITMENT_CALENDAR_OAUTH_STORE_PATH`,
and `RECRUITMENT_CALENDAR_OAUTH_KEY`. Do not commit values or copy the encrypted
runtime store into this repository.

1. Run the tests in an isolated environment.
2. An authorized operator runs `node ops/calendar/calendar-device-recovery.mjs issue`.
3. The designated user personally follows the returned official URL and consents.
   Treat the returned authorization URL as temporary sensitive output; never log it.
4. After the user's confirmation, run the same helper with `poll`. Honor its
   retry interval; never blindly retry an uncertain token exchange.
5. Verify the exact user, calendar detail access, minimum scopes and production
   reader before considering authorization complete. Preserve prior encrypted data.

The helper only retains calendar read scopes and offline refresh access. A busy-only
role, wrong identity, unknown scope, malformed lifetime, concurrent owner or changed
credential store fails closed. Credentials are encrypted with AES-GCM and are not
printed. Existing successful device authorization does not prove the separate
browser PKCE callback has passed a new end-to-end acceptance.

Tests:
`node --test calendar-user-reader.test.mjs calendar-auth-http.test.mjs ops/calendar/calendar-device-recovery.test.mjs`

## Four coach-owned review calendars (4.9.3)

`coach-device-recovery.mjs` is a separate operator-only fallback if the coach's
browser PKCE callback fails. It fixes exactly four verified room → coach open ID
→ own primary calendar mappings. It accepts no arbitrary user or calendar ID,
uses a separate AES-GCM file per room under the same absolute `DATA_DIR` as the
running calendar service, and verifies the consenting Feishu account, the exact
active primary calendar owner/ID, and detail-reader-or-better role **before**
saving. It asks only for `calendar:calendar:read`,
`calendar:calendar.event:read`, and `offline_access`; unexpected broader scopes
are narrowed or rejected. It does not read private chats or write calendar
events, and it has no HTTP endpoint.

Run from the **single** production calendar container, with its existing
protected `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, and
`RECRUITMENT_CALENDAR_OAUTH_KEY` environment, and set `DATA_DIR` explicitly to
the absolute production mount. Do not run it in a candidate container, a
second container sharing the mount, or a local copy of someone else's token.
For one room at a time, an authorized operator runs:

```text
node ops/calendar/coach-device-recovery.mjs issue 官旗
node ops/calendar/coach-device-recovery.mjs poll 官旗
```

Other accepted room names are `品牌精选`, `优选`, and `王鸥美肤`. Deliver the
temporary official `verificationUrl` (and QR if needed) **only** to the named
coach; the coach personally opens it and consents as their own account. Never
reuse a link or ask an operator to consent on their behalf. After that coach
reports completion, poll no sooner than `intervalMs`; if the result is pending,
honor `retryAfterMs`. Do not blindly retry an uncertain exchange or remove a
lock. A failed/wrong-user/busy-only/incorrect-primary attempt writes no coach
token, and the 17:30 review reminder remains unavailable for that coach.

An `authorized:true` device receipt alone is **not** business acceptance:
read the same coach's production `calendar-user-reader` status, verify the
exact primary calendar again, and read a bounded `instance_view` through the
production reader before enabling review statistics or reminders. Four human
consents and four real calendar readbacks are required; do not infer 4/4 from
unit tests, the prior interview-calendar device grant, or a successful OAuth
URL issue. Browser PKCE remains enabled and its historical 20049 outcome is
not represented as repaired by this fallback.

Tests:
`node --test ops/calendar/calendar-device-recovery.test.mjs ops/calendar/coach-device-recovery.test.mjs coach-calendar-auth.test.mjs calendar-user-reader.test.mjs`
