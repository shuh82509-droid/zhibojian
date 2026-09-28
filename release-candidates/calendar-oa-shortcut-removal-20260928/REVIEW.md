# Independent narrow OA-branch review

2026-09-28, same-task reviewer `sender_final_gate_review`.

## Decision

**The narrow removal of automatic private-chat override passes independent review. No new P1/P2 defect was found in this exact diff. Production remains NO-GO.** This is not a full fail-closed OA/recruitment implementation: existing prepopulated-input fallbacks, the other known P1 items and old dual-confirmation readback/write gates are not fixed by this change.

No server was imported or started, no production container/data was changed, no real journal was read, no Feishu API or OAuth grant was invoked, and no Git action was performed by this reviewer. Only extracted functions, fictional identities/journals and synthetic VM tests were executed.

## Exact reviewed bytes

| File | SHA256 |
| --- | --- |
| server.original.js | `4d1942968455c1f2ad4ed5f0a359802b3036677495cc90b441405c6efb0bf1ef` |
| server.js | `f7545c1eacbee95ae021d897e0fde4b160c182365562f39a1871cedd9f759abe` |
| lifecycle-engine.mjs | `5880b010e1a780dea100ab8b3447fb8603d534901df998ce8abbfa9ade4e9cf0` |

The candidate is based on the parent-supplied current Calendar baseline `3e42689c/c9f28e58`; these identifiers are baseline context, **not independently refreshed production evidence in this review**.

The whole candidate server is byte-equal to the original after exactly two replacements:

1. At server line 1705, delete `privateAssessmentSource.load()`, `applyPrivateAssessments(...)` and the truthy private-result early return. Replace them with the narrow explanatory comment, `No automatic private-chat evaluation; structured confirmation is independently checked below.`
2. At line 1724, replace the now-unavailable `privateSource.reason` in the no-current-OA-records status with a literal “指定私聊未读取” status.

The engine is unchanged. Private imports/initialization (server lines 30, 230) and the independent `/api/lifecycle/private-assessments` endpoint (line 2435) remain in the exact-current server; this patch does not remove, authorize, validate or prove non-consumption across those other routes. It prevents the removed load/override **inside `addStructuredAssessments` only**. No global OAuth/private-route safety claim is made.

## Static conclusions and compatibility

- Server lines 1706–1711: normal invocation now reads the existing OA journal and computes the original unchanged structured summary, rather than returning a ready private-chat evaluation first.
- Lines 1713–1720: original OA candidate update semantics remain. Given pending (`assessmentPassed:null`) inputs, one signer remains awaiting, opposite or duplicate conclusions remain conflict/null, and a unique matching two-signer pass/pass or fail/fail retains its original submitted/hired labeling and evidence.
- Lines 1723–1726: incomplete recruitment source coverage still suppresses the structured summary and candidate application. No-current-records status no longer dereferences a removed private-source local.
- Engine lines 766–814 are unchanged: cycle+submission matching, cohort/source uniqueness, two configured signer requirement, duplicate signer conflict and pass/fail agreement are the same functions as before. This review does not strengthen their journal authenticity, storage, historic readback or write-authorization contract.

## Independently executed evidence

Using local `H:\node.exe --test`, the latest frozen source hash above passed:

- **23/23 independent tests** in `OA-INDEPENDENT-REVIEW.test.mjs`.
- **40/40 implementation tests** in `oa-double-confirm.test.mjs`, independently rerun by this reviewer.
- Combined result: **63 passed, 0 failed, 0 skipped**.

The independent tests extract only `readRecruitmentAssessmentJournal` and `addStructuredAssessments` into a VM. They use the unchanged actual structured helper exports from the pure engine module. The server entrypoint, imports, listener, timers, real journal and actual OAuth/private readers never run.

Evidence includes:

1. Whole-file hashes and strict two-replacement byte equality.
2. A synthetic reproduction using the original exact function: ready private one-party score returns pass before any OA journal read. The new function instead reads the OA fixture once; private-load, private-apply and the fixture's OAuth-attempt counters stay zero.
3. Empty OA, single pass or fail, opposite conclusions, duplicate signer, wrong cycle/source/name, unknown actor, actor-name mismatch and non-OA journal evidence cannot become a pass from a private-ready score.
4. Unique matching OA pass/pass and fail/fail, for both submitted and hired stages, are deep-equal to the original OA path when no ready private override exists. The new path also succeeds with a private loader configured to throw if it were called, proving no private loader invocation in this extracted function.
5. Incomplete recruitment messages, journal failure and shared submission across two candidates do not acquire a private-pass fallback. The normal pending-input cases remain null and do not mutate input fixtures.

A first independent 23-test run passed the provisional `d142e89e...` bytes. During the subsequent combined run, the implementation agent narrowed a comment to avoid a broad completion claim. Both hash-pin tests correctly failed on the new `f7545c1e...` hash while behavioral tests passed. The diff was reread, the reviewer's own pin was updated only after confirming that comment-only refinement, and the final full 63-test run passed. The old provisional hash is not the reviewed final source.

## Known unresolved fallback: explicitly NOT fixed

The independent dirty-input tests prove the retained behavior at lines 1708 and 1713–1714: unreadable OA, empty/no-match OA or incomplete source coverage may return an existing input `assessmentPassed:true` unchanged, with `summary:null`. This is inherited original fallback semantics, **not proof of current double confirmation and not a newly fixed safety property**. The implementation suite separately records empty/missing/bad/incomplete cases as `KNOWN UNRESOLVED`.

The parent notes the normal supplemental candidate path sets the assessment field to null while preserving a separate reported field. That helps the normal input route but does not make arbitrary prepopulated input safe, and it does not erase the retained fallback demonstrated here.

## Release boundary

The other known 15 P1 items and dual-confirmation old readback insufficiencies remain outside this narrow patch. Current production CAS, exact gateway/container/writer/volume/source/identity evidence, fresh backups and latest-data rollback, real OA page/old-link acceptance, proper assessment write/readback authorization, reminder enablement gates and human business evidence have not been supplied by these synthetic tests. A passed VM suite or candidate source is not an image release, Git delivery, production switch, real notification, valid OAuth grant or human business completion. Keep the existing production NO-GO until the approved full release conditions are independently met.
