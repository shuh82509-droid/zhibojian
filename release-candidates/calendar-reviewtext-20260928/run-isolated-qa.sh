#!/usr/bin/env bash
set -euo pipefail
# Frozen source-only/synthetic QA: not a production deployment or acceptance.
# This entry point never starts the default server and never receives app env.
qa=${1:?explicit isolated QA directory required}
case "$qa" in /home/brand-marketing/fandow-apps/fd-026222/runtime/calendar-reviewtext-20260928.*) ;; *) exit 64 ;; esac
test -d "$qa" && test ! -L "$qa"
cd "$qa"
pins='2590ce6d3f8ded1b8eebcaaa26f7e77fe5b424b56a64ad2334bb81ab50b9ad5f  server.js
4d1942968455c1f2ad4ed5f0a359802b3036677495cc90b441405c6efb0bf1ef  server.original.js
e345f9f11ff3bd14bd6417b011e9bc584dbcb676efd2acc82d162c0257adc39c  server.base.js
fa30f7895774f856527d5e07025edeffb927978a9d2b46146049811648ed06d3  lifecycle-engine.mjs
5880b010e1a780dea100ab8b3447fb8603d534901df998ce8abbfa9ade4e9cf0  lifecycle-engine.original.mjs
54271b172fdf96b903fab2187bc717244422ac02184da45ccb926cf068d95954  lifecycle-engine.base.mjs
edb7ceabc33cb8758ea0a0072cd2d08ae53700ca8f629b42a878d6994f9c5a5e  recruitment-content.mjs
f3e8907158a6dd264ff2833b3815cc13ae1d4e5e46e94541df063b02bb3faf39  oa-fallback.test.mjs
51207c2acf1564f8d2712464ee074f5d8c49d3c55a0203f068fbea69bd491a02  oa-identity-readback.test.mjs
9ce6e04ac89d8ccfb4b6f2781d4a97408c904876e9a59cc458567b42d3eeebe6  FALLBACK-INDEPENDENT-REVIEW.test.mjs
9747694237116059e69380df5612839cf20106afc97ea85673881df15c9efd41  reviewtext-root.test.mjs
55a5fc7a68526a08550cc7cd52edb7a4dd6912e0f6e36bd7037b31b86500f608  projection-review.test.mjs
a5570ca29f50b183298824e7b7336c104c24aca50e9f001ab696649243618b1e  REVIEWTEXT-INDEPENDENT.test.mjs
e69b601880ce45a98c7b670ba9b73bdeb1a42f7688cc38a91fdbc6ae5f247db9  initial-identity-root.test.mjs
d81e899a6814f489d14ea6a6bc0eb774dacd05058d9526b2ea602a0080897dcd  IDENTITY-INDEPENDENT.test.mjs
bd8e6dbd81056caccac4d723c8296ae50499d1a6313242d2b9b1cb425099e15b  SOURCE-PINS.json'
if [[ "$pins" == *'__FINAL_'* ]]; then printf '%s\n' 'final test/manifest pins not frozen; QA blocked' >&2; exit 65; fi
test "$(printf '%s\n' "$pins" | wc -l)" = 16
printf '%s\n' "$pins" | sha256sum --strict -c -

docker_cmd=(docker --host unix:///run/user/1000/docker.sock)
unique_owner() {
  local id ids aliases count=0 owner=''
  ids=$("${docker_cmd[@]}" ps --quiet) || return 70
  for id in $ids; do
    aliases=$("${docker_cmd[@]}" inspect "$id" --format '{{range .NetworkSettings.Networks}}{{range .Aliases}}{{println .}}{{end}}{{end}}') || return 70
    if grep -Fxq 'live-routes-r6' <<< "$aliases"; then count=$((count+1)); owner=$id; fi
  done
  test "$count" = 1 || return 71
  printf '%s\n' "$owner"
}
formal_cas() {
  local owner recheckedOwner identity sources flags
  owner=$(unique_owner) || return 71
  identity=$("${docker_cmd[@]}" inspect "$owner" --format '{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}') || return 70
  [[ "$identity" == *'|sha256:c9f28e58dbc60568307386769f9dc815267c36038fee33a89708feeb19a1af01|'* ]] || return 72
  [[ "$identity" == *'|true|healthy' ]] || return 72
  sources=$("${docker_cmd[@]}" exec "$owner" sha256sum /app/server.js /app/lifecycle-engine.mjs) || return 70
  [[ "$sources" == $'4d1942968455c1f2ad4ed5f0a359802b3036677495cc90b441405c6efb0bf1ef  /app/server.js\n5880b010e1a780dea100ab8b3447fb8603d534901df998ce8abbfa9ade4e9cf0  /app/lifecycle-engine.mjs' ]] || return 73
  # Only these three non-secret switches are rendered; no runtime env dump.
  flags=$("${docker_cmd[@]}" inspect "$owner" --format '{{range .Config.Env}}{{if or (eq (index (split . "=") 0) "LIFECYCLE_REMINDERS_ENABLED") (eq (index (split . "=") 0) "LIFECYCLE_REMINDER_LEADER") (eq (index (split . "=") 0) "LIFECYCLE_SCHEDULER_ENABLED")}}{{println .}}{{end}}{{end}}') || return 70
  flags=$(LC_ALL=C sort <<< "$flags") || return 70
  [[ "$flags" == $'LIFECYCLE_REMINDERS_ENABLED=false\nLIFECYCLE_REMINDER_LEADER=false\nLIFECYCLE_SCHEDULER_ENABLED=0' ]] || return 74
  recheckedOwner=$(unique_owner) || return 75
  test "$recheckedOwner" = "$owner" || return 75
  printf '%s\n%s\n%s\n' "$identity" "$sources" "$flags"
}
before=$(formal_cas) || exit $?
printf 'FORMAL_BEFORE_UTC=%s\n%s\n' "$(date -u +%FT%TZ)" "$before"
runner='sha256:c9f28e58dbc60568307386769f9dc815267c36038fee33a89708feeb19a1af01'
"${docker_cmd[@]}" image inspect "$runner" | python3 -c '
import json,re,sys
items=json.load(sys.stdin)
if len(items)!=1: sys.exit(69)
image=items[0]
danger=0
for entry in image.get("Config",{}).get("Env",[]) or []:
    key,sep,value=entry.partition("=")
    if sep and value and re.search(r"TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE[_-]?KEY|API[_-]?KEY|ACCESS[_-]?KEY",key,re.I): danger+=1
print("RUNNER_PLATFORM="+str(image.get("Os"))+"/"+str(image.get("Architecture")))
print("RUNNER_CREDENTIAL_KEY_PRESENCE_COUNT="+str(danger))
print("RUNNER_DECLARED_VOLUMES_PRESENT="+str(bool(image.get("Config",{}).get("Volumes"))).lower())
if image.get("Id")!="sha256:c9f28e58dbc60568307386769f9dc815267c36038fee33a89708feeb19a1af01" or image.get("Os")!="linux" or image.get("Architecture")!="amd64" or image.get("Config",{}).get("Volumes") or danger: sys.exit(69)
'
status=0
"${docker_cmd[@]}" run --rm --pull never --entrypoint node \
 --network none --read-only --user 10001:10001 --cap-drop ALL \
 --security-opt no-new-privileges --pids-limit 96 --memory 256m --cpus 0.75 \
 --tmpfs /tmp:rw,noexec,nosuid,size=64m \
 --mount "type=bind,source=$qa,target=/qa,readonly" --workdir /qa \
 --env WIS_REVIEWTEXT_MODULE=/qa/recruitment-content.mjs \
 --env WIS_REVIEWTEXT_MODULE_SHA=edb7ceabc33cb8758ea0a0072cd2d08ae53700ca8f629b42a878d6994f9c5a5e \
 --env WIS_REVIEWTEXT_ENGINE=/qa/lifecycle-engine.mjs \
 --env WIS_REVIEWTEXT_ENGINE_SHA=fa30f7895774f856527d5e07025edeffb927978a9d2b46146049811648ed06d3 \
 --env WIS_IDENTITY_REVIEW_ENGINE=/qa/lifecycle-engine.mjs \
 --env WIS_IDENTITY_REVIEW_SHA=fa30f7895774f856527d5e07025edeffb927978a9d2b46146049811648ed06d3 \
 --env WIS_REVIEWTEXT_CANDIDATE=/qa \
 --env WIS_REVIEWTEXT_SERVER=/qa/server.js \
 --env WIS_REVIEWTEXT_SERVER_SHA=2590ce6d3f8ded1b8eebcaaa26f7e77fe5b424b56a64ad2334bb81ab50b9ad5f \
 "$runner" --test --test-reporter=tap \
 oa-fallback.test.mjs oa-identity-readback.test.mjs FALLBACK-INDEPENDENT-REVIEW.test.mjs \
 reviewtext-root.test.mjs projection-review.test.mjs REVIEWTEXT-INDEPENDENT.test.mjs \
 initial-identity-root.test.mjs IDENTITY-INDEPENDENT.test.mjs || status=$?
after=$(formal_cas) || exit $?
printf 'FORMAL_AFTER_UTC=%s\n%s\n' "$(date -u +%FT%TZ)" "$after"
test "$before" = "$after"
printf 'QA_TEST_EXIT_CODE=%s\n' "$status"
exit "$status"
