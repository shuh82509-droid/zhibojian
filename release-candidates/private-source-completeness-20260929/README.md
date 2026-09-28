# Private assessment source-completeness candidate

Source-only, not production deployable. This follows the same approved two-person,
fixed-P2P, four-scope contract. No real OAuth, private messages, sending, thread
expansion, scheduler enablement or business confirmation is included.

Only `readMessages` changed from the pinned 9b74 private-hold candidate in
`../private-chat-hold-20260929/payload`. `qa-entry.mjs` verifies the entire old
14-file dependency and this exact eight-file inventory before running anything.
The full authorization prefix and public-method suffix remain byte-identical;
the existing AES-GCM v2 grant, S256, JSON v2 token endpoints, durable intentions,
non-stealable locks and five public methods are unchanged.

The primary response specification is
[Feishu message list](https://open.feishu.cn/document/server-docs/im-v1/message/list):
`has_more` is boolean, next cursor string, creation time millisecond string,
sender identity is typed, and chat listing does not include all thread replies.
This candidate additionally applies fail-closed assessment-source rules: fixed
two user/open_id identities, nonblank valid message IDs, explicit body/type and
deleted/updated flags, creation time inside the requested seconds, ascending new
records, and no conflicting duplicate ID. Empty terminal cursor is compatible;
opaque cursors retain their exact value, but missing, nonstring, all-whitespace,
control-character, repeated or contradictory terminal cursors are unverified.
Identical overlap is deduplicated irrespective of JSON object key order.

A non-user/system/anonymous message, malformed record, source conflict or thread
root makes only that requested window pending. It does not erase a cached grant,
permanently quarantine an ordinary GET failure, or trigger token/message replay.
No source prefix is returned with `complete:true` after failure. A missing peer
echo is an application source-contract gate, not a field requirement claimed
from the message-list documentation; true P2P source acceptance still needs
independent contract/readback evidence before production activation.

Request bounds use `[startTime*1000,(endTime+1)*1000)` to include the whole final
requested second; this is a conservative application convention, not a claim
about an undocumented server inclusion boundary. The old 120-day predicate
still limits request span, not independently source age. `complete:true` proves
only the validated listed window under this policy, not provider atomic snapshot,
full conversation, a passed evaluation, OA double confirmation or real business.
Returned raw recall flags are preserved; no conclusion is invented.

Run `node qa-entry.mjs` from this directory beside the pinned existing candidate.
For an isolated local copy only, set `WIS_PRIVATE_BASE_PAYLOAD` to that exact
14-file dependency. It is rehashed, never used as a production store.
Regressions use toy fixtures, native temporary FS and injected providers; no real
accounts, credentials, messages or server modules enter this archive. The old
34-case failing counterexample log is retained locally; it is not a successful
business result. Complete logs/counts and Git readback are in the same task's
local delivery record and original master plan. Windows tests and source pinning
are not Linux durability, visual OA, production deployment or final acceptance.

Production release still needs a fresh baseline CAS, source/recipient identity,
old same-volume RW isolation, stopped complete backup/restore/latest-data rollback,
real OA/old-link visual acceptance and independent real business receipts. Old
frozen candidates and their logs are not overwritten or promoted by this archive.
