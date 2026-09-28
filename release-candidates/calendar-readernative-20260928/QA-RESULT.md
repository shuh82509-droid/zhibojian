# Calendar refresh / private native-source candidate QA

Result observed 2026-09-28, Shanghai. This is source-only candidate QA, not a production release or formal business acceptance. No app/server runtime file, official grant/store, source sheet, production ledger, notification, or real workflow node was changed by this QA.

## Frozen result

The rebuilt candidate actually passed **415/415** locally and on isolated Linux; fail, skipped, cancelled and todo were all zero. The six frozen suites are 99 + 94 + 34 + 63 + 66 + 59. The original 16-section scope check and a separate entire-file current-baseline proof also passed; neither scope check is counted as an additional functional test. Linux TAP contains exactly 415 unique consecutive `ok` IDs and both runner/launcher exited zero. Earlier candidate totals are not reused.

`SOURCE-PINS.json` SHA256: `2c4dc0990f1563d1936f11c99d9e5eb3c8550fd2fcd997489a5ba4f07e53325b`. Its 16 source/reference/test/entry files plus the manifest itself were checked as 17 exact pins on Linux before any module execution. Base reader remains `173e639e`, private native reader `61bb609a`, collector `ef2bf280`; complete hashes are in the manifest. Original test assertions and crash worker were not weakened.

The formal reader raw SHA is `75067a7fd85d827d43d6f439a6c5a81f156f1358a64defec13a75d45b68be630`, not the old `a2dc5930` raw SHA. The new proof pins both complete files, requires fatal UTF-8/byte round-trip, rejects NUL/bare CR, and compares the whole Buffer after exactly 195 CRLF replacements and one appended EOF LF. No code, whitespace, comment or Unicode difference is ignored. The original scope check still independently pins its old reference. The formal mixed-line-ending reference has a path-specific Git `-text` attribute; other candidate text stays LF for reproducible SHA after checkout.

## Actual Linux execution

At **23:20:09–23:20:21 Shanghai**, fresh pre/post identity, image, startup time, running/health, Gateway config, unique formal aliases, four Calendar source hashes (including actual reader75067) and 13 approved non-secret flags were strictly equal. Gateway has no configured healthcheck and was required to be `none`, never called healthy. Hub, Calendar and Dispatch each matched the expected running `healthy` identity. These checks are not a full production cutover CAS or an atomic source/event snapshot.

The existing linux/amd64 image `c9f28e58` was used only as a Node test runner: explicit `/usr/bin/env -i` entrypoint, disabled image healthcheck, no default server, no pull/build, no network or ports, non-root UID/GID10001, read-only rootfs, capabilities dropped, no-new-privileges, pids96, memory384MiB, CPU0.75. Only the explicit source directory was mounted read-only at `/qa`; synthetic temp files used a bounded 64MiB tmpfs. No formal data volume/socket/config/env/grant was mounted or passed. Child/worker env is a runtime/module/SHA whitelist, not ambient app env.

Image Config.Env non-empty credential-key count was zero and declared image volumes were absent. This is **not an image-filesystem secret scan**. The QA entry imports only frozen candidate/test files and uses synthetic fetches; no real OAuth refresh, authorization or business API was consumed. Linux tests do not prove formal-volume power-loss durability or recovery of a real ambiguous grant.

Full local TAP SHA: `f38e9b99a67c84893066f16b9a2e7be4615ab3d745273e125ea161d047019a2d`. Full Linux TAP SHA: `b9a6ffe1e84ef63b8c365ed64b89a5b17737144c4fc0ec430ab4886522c78d0c`. Raw TAP/diagnostic logs stay in the local evidence directory, not the source Git archive. The hardened local recipe SHA is `e1d56e3db9c1a5f83b4f2ef94f1ebd7dcb3366a4284574f81f3451d620f87f4e`.

The earlier isolated directory was preserved: first attempt exited70 at a missing Gateway Health field; second exited73 at the old raw-reader pin. Both stopped before any test runner. The Health access alone was corrected; the reader mismatch was separately read back and independently proven to be line endings. A new candidate/manifest/current-pin recipe was then built and tested. Neither failed attempt is relabeled as a pass.

## Scope and remaining limits

The refresh candidate durably records a non-secret intent before a one-use refresh request and blocks unknown results across reader instances, keeps store identity/scopes/expiry strict, and verifies encrypted grant readback. It does not add an automatic unlock, retry or recovery endpoint. Extreme persistent anchor IO failure after cleanup remains a stated limitation; an initial authorization-code exchange durable-intent/recovery protocol is not delivered here.

The private native adapter is default-off and fixed-GET, with bounded byte-stream/fatal UTF-8 handling and explicit cancellation/release of active and late bodies. Trusted string-only synthetic adapters do not prove pre-buffer byte or transport decoding limits. The collector rejects duplicate JSON keys/lossy numbers/ambiguous pagination rather than inventing stable evidence; some legitimate fractional numeric fields consequently remain pending. It retains cancelled/multi-person/recurring/out-of-window records and does not infer owner, updated time or deleted flags. Complete pagination is not a cross-page atomic snapshot, authorized person binding, reminder permit or source readiness for sending.

No HTTP/server/engine integration, C1/C2/D/E final source/actor binding, OA signing, coach authorization, schedule writeback, formal notifications or business completion is enabled by this archive. Production switching still requires fresh formal source/recipient CAS, dormant same-volume RW isolation, a fresh complete stopped-writer backup plus restore check, latest-data-preserving rollback, and real OA/old-notification-link visual acceptance. Unknown/late notifications are not resent or backfilled. Only real owners, hosts and assistants may complete the five workflow stages.

The source Git archive contains exactly 20 whitelisted files. Both raw reference files are exempted from text normalization/diff/merge; all implementation/test text is fixed LF. Exact working/index blob SHA equality for all 20 files was checked, including raw formal75067. An actual staged checkout into a new empty directory with `core.autocrlf=true` preserved all 20 blob hashes and independently ran the full 415 tests plus both scope checks successfully. Initial whitespace complaints on the immutable raw references were not fixed by editing source bytes or weakening tests.

The source Git archive is separate from deployment; `productionApproved:false` remains unchanged. The overall 4.9.1–4.9.4 and genuine five-stage acceptance task remains unfinished.
