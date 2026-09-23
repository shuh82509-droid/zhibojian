#!/usr/bin/env bash
set -euo pipefail

runtime_root="/home/fandow-deploy/fandow-apps/runtime/fd-027340"
main_runtime="$runtime_root/live-center-workbench"
data_runtime="$runtime_root/data-center"
main_name="fd-027340-live-center-workbench"
data_name="fd-027340-data-center"
authority="fd-026222-wis-video-center"
authority_base="https://app.fandow.top/fd-026222/wis-video-center/api"
authority_fallback="http://wis-video-center-authority:3000/api"
main_backup="${main_name}-persistent-backup"
data_backup="${data_name}-persistent-backup"

test "$(docker inspect -f '{{.State.Running}}' "$main_name")" = "true"
test "$(docker inspect -f '{{.State.Running}}' "$data_name")" = "true"
test "$(docker inspect -f '{{.State.Running}}' "$authority")" = "true"

main_old_id="$(docker inspect -f '{{.Image}}' "$main_name")"
data_old_id="$(docker inspect -f '{{.Image}}' "$data_name")"
main_persistent_image="$(docker inspect -f '{{.Config.Image}}' "$main_name")"
data_persistent_image="$(docker inspect -f '{{.Config.Image}}' "$data_name")"
main_new_id="$(docker image inspect -f '{{.Id}}' "$main_name:latest")"
data_new_id="$(docker image inspect -f '{{.Id}}' "$data_name:latest")"
test "$main_new_id" != "$main_old_id"
test "$data_new_id" != "$data_old_id"

docker tag "$main_new_id" "$main_persistent_image"
docker tag "$data_new_id" "$data_persistent_image"
docker rm -f "$main_backup" "$data_backup" >/dev/null 2>&1 || true
docker stop "$main_name" "$data_name" >/dev/null
docker rename "$main_name" "$main_backup"
docker rename "$data_name" "$data_backup"

rollback() {
  docker rm -f "$main_name" "$data_name" >/dev/null 2>&1 || true
  docker tag "$main_old_id" "$main_persistent_image" >/dev/null 2>&1 || true
  docker tag "$data_old_id" "$data_persistent_image" >/dev/null 2>&1 || true
  docker rename "$main_backup" "$main_name" >/dev/null 2>&1 || true
  docker rename "$data_backup" "$data_name" >/dev/null 2>&1 || true
  docker start "$main_name" "$data_name" >/dev/null 2>&1 || true
}
trap rollback ERR

docker run -d --name "$main_name" --restart unless-stopped \
  --link "$authority:wis-video-center-authority" \
  --env-file "$main_runtime/.env" --env-file "$main_runtime/.env.coco" --env-file "$main_runtime/.env.minimax" --env-file "$main_runtime/.env.jump" \
  -e CENTRAL_AUTHORITY_BASE="$authority_base" -e CENTRAL_AUTHORITY_FALLBACK_BASE="$authority_fallback" \
  -v "$main_runtime/data:/app/data" -p 127.0.0.1:24500:3000 "$main_persistent_image" >/dev/null
docker run -d --name "$data_name" --restart unless-stopped \
  --link "$authority:wis-video-center-authority" \
  --env-file "$data_runtime/.env" -e CENTRAL_AUTHORITY_BASE="$authority_base" -e CENTRAL_AUTHORITY_FALLBACK_BASE="$authority_fallback" \
  -p 127.0.0.1:24600:3000 "$data_persistent_image" >/dev/null

for attempt in $(seq 1 40); do
  if curl -fsS 'http://127.0.0.1:24500/healthz' >/dev/null && curl -fsS 'http://127.0.0.1:24600/' >/dev/null; then break; fi
  test "$attempt" -lt 40 || exit 1
  sleep 2
done

curl -fsS 'http://127.0.0.1:24500/fd-027340/live-center-workbench/api/script-generator/config' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") and d.get("sourcePolicy")=="feishu_verified_only"'
curl -fsS 'http://127.0.0.1:24500/fd-027340/live-center-workbench/api/anchor-development' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") and len(d.get("dimensions") or [])==4 and len(d.get("courses") or [])==8'
curl -fsS 'http://127.0.0.1:24600/api/dashboard?date=2026-08-28' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("sessions") and all(x.get("transactionStatus")=="待接入" for x in (d.get("traffic") or []))'
test "$(docker inspect -f '{{.Image}}' "$main_name")" = "$main_new_id"
test "$(docker inspect -f '{{.Image}}' "$data_name")" = "$data_new_id"

docker rm -f "$main_backup" "$data_backup" >/dev/null
trap - ERR
echo 'PERSISTENT_MAIN_IMAGE_PIN=passed'
echo 'PERSISTENT_DATA_IMAGE_PIN=passed'
echo 'PRODUCTION_FUNCTIONAL_UPGRADE_APIS=passed'
