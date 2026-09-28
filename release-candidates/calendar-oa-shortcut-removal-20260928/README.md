# Exact-current source candidate: remove automatic private assessment override

**Source archive only. NO-GO for production; do not start server.js.** This folder does not replace repository-root runtime or the running Calendar. It is not a complete 4.9.1 implementation, a deployable hard-OFF image, valid OAuth authorization or a real business acceptance receipt.

Same WIS task, 2026-09-28. Actual source baseline was Calendar `3e42689cb3536ab8e541eb5e12d3a02579f65cb76bd00e0fb5aabc5e85ab94d4`, image `sha256:c9f28e58dbc60568307386769f9dc815267c36038fee33a89708feeb19a1af01`; executor rechecked actual owner/healthy/source and scheduler/reminders OFF at 18:22:42 Shanghai. This is historical evidence, not a future CAS or publication permission.

The whole server snapshot is unchanged except two explicit replacements in `addStructuredAssessments`: remove private-source load/apply/ready-return and remove the status dependency on that deleted local. The original OA structured helper remains unchanged. Tests verify the complete byte boundary. Pinned source/tests are marked `-text` to preserve exact bytes, including the current engine's mixed line endings; Git normalization must not change their hashes.

| File | SHA256 |
| --- | --- |
| server.original.js | `4d1942968455c1f2ad4ed5f0a359802b3036677495cc90b441405c6efb0bf1ef` |
| server.js | `f7545c1eacbee95ae021d897e0fde4b160c182365562f39a1871cedd9f759abe` |
| lifecycle-engine.mjs | `5880b010e1a780dea100ab8b3447fb8603d534901df998ce8abbfa9ade4e9cf0` |
| oa-double-confirm.test.mjs | `1e2f488e169056eecbad0ae1550c1a66ea2c9d1b4f6a31d75123806f918e65ed` |
| OA-INDEPENDENT-REVIEW.test.mjs | `0b87c58ac429ae2f5dfb604482196b21afd69d37d906a593d6e93184c7c9cd76` |

Offline regression:

```text
node --check release-candidates/calendar-oa-shortcut-removal-20260928/server.js
node --test release-candidates/calendar-oa-shortcut-removal-20260928/oa-double-confirm.test.mjs release-candidates/calendar-oa-shortcut-removal-20260928/OA-INDEPENDENT-REVIEW.test.mjs
```

Tests extract only selected functions into a VM (or import the pure engine), never import/start server.js, listeners, timers, actual journal/readers or OAuth. All people, signs, scores and journals are fictional fixtures. Executor independently ran Linux40/40; reviewer local63/63; root final local40/40 and independent Linux63/63, all zero failures/skips. Linux had no network, read-only/non-root/cap-drop/no-new-privileges/resource limits, only a read-only synthetic QA bind plus /tmp tmpfs, no formal volumes/credentials/aliases. The actual immutable image was only a Node test runner, not a new candidate image.

**These counts include explicit known-unresolved fixtures; they do not mean all behavior is safe.** The original empty/missing/bad OA journal or incomplete-source fallback may preserve arbitrary prepopulated `assessmentPassed:true`. Private module initialization and other private endpoints remain. Other known P1 identity/parser/calendar/reminder/dual-sign readback/write-CAS/durability and cross-cycle gaps are not fixed. For normal pending inputs only, a private-ready score cannot override no/single/conflicting OA evidence; valid unique OA pass/pass and fail/fail behavior is unchanged.

`REVIEW.md` and `ROOT-REVIEW.md` separate independent source/function-level evidence from production/human acceptance. This archive contains code, synthetic tests and reviews only: no runtime journals, tokens, encrypted grants, production message contents, logs, .env, account secrets or source-data export. Existing document/Base tokens in the code are resource identifiers, not bearer credentials.

Any future publication needs fresh actual CAS, approved source/identity/message gates, dormant same-volume RW isolation, fresh stopped-writer backup and restore, latest-data-preserving rollback, genuine OA/old-link checks and real-role acceptance. Existing production automatic recruitment reminders remain OFF. Do not run historical deployment scripts or infer current grants from this archive. Git delivery and production publication are separate outcomes.
