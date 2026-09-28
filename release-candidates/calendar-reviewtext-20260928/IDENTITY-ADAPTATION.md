# Group B identity regression adaptation to V1 content contract

Status: new copies only; 81/81 passed on Windows Node with the explicitly selected frozen candidate. Linux execution is left to the root agent's combined candidate QA; these tests contain no Windows path default.

## Files and frozen inputs

New directory: `audit491-identity-v1-20260928-2042`.

- `initial-identity-root.test.mjs`: 25 tests; SHA256 `e69b601880ce45a98c7b670ba9b73bdeb1a42f7688cc38a91fdbc6ae5f247db9`.
- `IDENTITY-INDEPENDENT.test.mjs`: 56 tests; SHA256 `d81e899a6814f489d14ea6a6bc0eb774dacd05058d9526b2ea602a0080897dcd`.
- `TEST-RESULT.txt`: final fresh local 81-test output and matching hash readback.

Explicit selected engine: `calendar-reviewtext-exact-20260928/candidate-2042/lifecycle-engine.mjs`.
Engine SHA256: `fa30f7895774f856527d5e07025edeffb927978a9d2b46146049811648ed06d3`.
Sibling module SHA256: `edb7ceabc33cb8758ea0a0072cd2d08ae53700ca8f629b42a878d6994f9c5a5e`.

Frozen old files are unchanged:
- Old root test SHA256: `acbdbd9ff1ba1c1a0dc2339fe42e90f8cad8a950bdfc37202802ec8114cab053`.
- Old independent test SHA256: `5076d4fc9f3cfc630826bdd53f449451f76129e71baac90a3db150c59ab59891`.

No engine, server, module, OA179, production, Git, document or network mutation was made by this subtask.

## Why adaptation is required

The old fixtures had no V1 full-raw-content projection or verified chat/update metadata. They are not valid positive production sources under `feishu-textonly-v1`. Treating their old pass totals as current positive coverage would be vacuous: the new contract deliberately holds missing source evidence pending.

All new complete source fixtures call the actual `projectRecruitmentMessageContent` from the explicitly selected engine's sibling module. They carry synthetic `om_` / `oc_` / `ou_` IDs, UTC created/updated timestamps, equal text/reviewText, raw/projected fingerprints, original length and complete slot coverage. No fabricated V1 hash fields are hand-authored.

Observed bad type, truncation, media and mismatched text cases remain explicitly corrupted projections; they must not become eligible. Different valid body copies are reprojected with the actual V1 projector before parsing, so same-ID conflict tests cannot pass merely because an obsolete fingerprint was left behind.

## Preserved safety cases

All old 81 test positions remain; none was deleted. The adaptations preserve and in places strengthen:

- Unique complete OK/No initial review with actual single source ID, original reviewer semantics and no identity ambiguity.
- Repeated exact pages and reordered semantic reaction aliases do not manufacture duplicates.
- Same-ID different text, disappearance/empty body, timestamps, dates, reviewer reaction states, other candidate name, chat, sender, update time, resources, truncation and type drift remain pending in both input orders.
- Same-name different IDs, one ID with two names, repeated name in one source, incomplete IDs/dates and incomplete extra records cannot revive an initial result.
- A pending/No initial review cannot be overridden by later pass/fail text or offer.
- Ambiguity in one name does not destroy another unique candidate's initial OK identity: the unaffected candidate keeps its unique source, actual initial reaction and non-pending submission identity.
- Old OA double signature cannot revive parser identity ambiguity.
- Independent genuine onboarding facts survive merge, while a recruitment offer is not itself proof of onboarding.
- Inputs remain immutable.

Positive initial cases assert legitimate initial totals are still numeric and correct when full source coverage is valid. Negative identity cases assert blank bound source, null initial review, preserved source alternatives, pending submission/review status, known clue totals and observed distinct message-ID counts. This is not an all-negative suite where every fixture becomes unverified.

## Intentional expectation changes

1. Interview text is no longer an automatic business pass/fail. Strict complete single-review post fixtures retain `textOutcome`, `text_ready`, review source ID and one qualified clue, but candidate stage stays at verified initial review and `evaluationEvidence.passed` stays null. Both business group counts are null.
2. The original incomplete plain-text interview syntax is explicitly retained as a negative subcase inside the two existing interview tests. It remains pending, with no text outcome or business transition.
3. Offer date remains a reported, source-backed clue in `offerEvidence`, with `offer_binding_unverified`; it cannot invent interview success, actual onboarding or an authoritative start date.
4. Incomplete/ambiguous submission coverage makes overall initial/candidate/submitted counts null, not a measured zero. Known `initialPassedClueCount`, `initialFailedClueCount`, `candidateClueCount`, `initialPendingCount` and observed message ID counts remain separately checked.
5. A recalled same-name source is preserved as an unresolved alternative rather than silently removed. The old recalled-ID + live-ID case now reports two observed IDs, two alternatives and pending identity.
6. Retained media in repeated exact copies still gives one observed ID/one alternative, but its source cannot meet text-only V1 completeness and remains pending.

These are deliberate fail-closed changes, not a claim that old 260 checks automatically apply to the new content contract.

## Independent byte/scope check

The 25-test file's first guard checks:
- Engine base SHA256 `54271b172fdf96b903fab2187bc717244422ac02184da45ccb926cf068d95954`.
- Exact bytes outside the approved `recruitmentSubmissionIdentity -> offerEvent` and `parseRecruitmentMessages -> calendarTitleNamesPerson` ranges, with only the exact declared content-module import removed for comparison.
- Original group B reviewer-reaction block SHA256 `3304d9ccc96987c20b8ce4275a8d281e1c509346d867a0bd5aa6193853cde5a1`.

The obsolete server SHA guard is not used to pretend the new group A server is unchanged; current server scope belongs to the root/native candidate guards. The B tests never import a server or state.

## Run contract

Set `WIS_IDENTITY_REVIEW_ENGINE` to the absolute selected engine path and optionally freeze `WIS_IDENTITY_REVIEW_SHA` to the engine hash above, then:

```text
node --test initial-identity-root.test.mjs IDENTITY-INDEPENDENT.test.mjs
```

Both files import the engine via `pathToFileURL(candidatePath).href` and the projector via `new URL('./recruitment-content.mjs', candidateUrl)`. No source path is inferred from a Windows workspace.

Result: 81 tests, 81 pass, 0 fail/skipped/cancelled/todo. These are offline synthetic regression results, not production release, source authorization, a 17:00 reminder send or a real business closed-loop acceptance. Group C formal-event/reviewer/full-fingerprint binding remains intentionally pending.
