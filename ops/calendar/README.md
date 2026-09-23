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
