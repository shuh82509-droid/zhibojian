# Calendar HTTP durable-hold consumption candidate

Source-only archive, not a deployment or permission to recover OAuth credentials.

This narrow HTTP candidate consumes the durable hold state from the frozen code-exchange reader archived at commit `09768afc74e5e5561193c33afe1d4d6ee1c7a402`. It does not change that reader, the running server, native reader, scheduler or business engine.

The HTTP reference is the exact running Calendar `/app/calendar-auth-http.mjs` observed on 2026-09-29 00:55 Shanghai: SHA256 `0dfdeee60cce1e553127d889d67e35e5cba14da124771a5e078b0b6bea95c9d4`. The candidate is `d8705f422394926bc001351d2f622502cb3df087ac44267c8b974d9b3dbe3d4c`. The scope proof reverses only declared deltas and compares the entire original Buffer; no whitespace-only or edited-section proof substitutes for this check. The four original test bytes and frozen reader bytes remain unchanged.

## Behavior

- Authorized, same-origin start requests check durable recovery status before creating an authorization URL or cookie. A held store returns fixed recovery guidance with `retryAllowed: false`.
- Callback errors, cancellations and expired states cannot advertise refresh/retry when the reader reports a durable hold. State validation still belongs to the reader; this wrapper does not substitute a caller identity or grant.
- Status, start and callback errors are projected onto fixed public booleans and whitelisted guidance. Mutable error messages, diagnostics, filesystem paths, arbitrary status fields, `openId` and refresh-expiry fields are not forwarded.
- A 1500 ms asynchronous status deadline fails closed. It does not interrupt synchronous JavaScript, cancel underlying filesystem work, or provide an atomic start permit. The reader's exclusive checks remain authoritative.
- Administrator, read-only, method, origin/CSRF and secure callback-cookie protections are retained. No recovery/reset/unlock endpoint is added.

## Reproduction

Run Node.js with `node qa-entry.mjs`. The entry verifies the eight payload files and their sizes before importing them, runs the whole-source proof, then runs only the three explicit synthetic suites. It excludes ambient module overrides, Node preload options and grant settings from child processes.

The local frozen source and an isolated Linux/amd64 Node runner both passed 96/96 entries: 4 original + 25 actual-reader/HTTP synthetic integration + 67 independent entries. The independent suite repeats the original four assertions; 96 is not 96 distinct business scenarios. All fail/cancelled/skipped/todo counts are zero. The isolated runner had no network, no formal data volume, no real grant or default server. Selected 22-line before/after metadata CAS was equal at 2026-09-28 17:11:45Z and 17:11:57Z; that is not an atomic production freeze or business acceptance. Fixed logs, production observations and operational recipes remain in the private local release directory, not this source archive.

## Not released

`productionApproved` and `formalCutover` are false. Real OA and old-notification-link visual compatibility, other HTTP consumers (including coach/private-chat wrappers), formal source/recipient gates, dormant same-volume writer isolation, a fresh stopped backup and latest-data rollback remain required before any production switch. The reduced public status fields have not been visually accepted. This archive does not enable recruitment, coach counts, scheduling imports or new notifications. Tests and Git delivery are not real five-stage workflow completion.

Only the nine pinned source/manifest files plus this README, `.gitattributes` and compact `QA-RESULT.json` belong in this archive. No production credentials, data, logs or release commands are included.
