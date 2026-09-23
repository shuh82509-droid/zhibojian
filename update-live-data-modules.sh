#!/usr/bin/env bash
set -euo pipefail

data_archive="${1:?data archive is required}"
dispatch_archive="${2:?dispatch archive is required}"
base="/home/fandow-deploy/fandow-apps/runtime/fd-027340"
stage="$(mktemp -d)"
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT HUP INT TERM

tar -xzf "$data_archive" -C "$stage"
tar -xzf "$dispatch_archive" -C "$stage"
test -f "$stage/data-center/Dockerfile"
test -f "$stage/dispatch-center/Dockerfile"

for app in data-center dispatch-center; do
  current="${base}/${app}"
  incoming="${stage}/${app}"
  test -s "${current}/.env"
  install -m 600 "${current}/.env" "${incoming}/.env"
  # Coco credentials stay server-only in the main workbench runtime.  Both
  # modules need them for their Feishu-backed APIs, and the data center also
  # needs the existing MiniMax provider for its constrained planning agent.
  if [ -s "${base}/live-center-workbench/.env.coco" ]; then
    grep -E '^FEISHU_APP_(ID|SECRET)=' "${base}/live-center-workbench/.env.coco" >> "${incoming}/.env"
  fi
  if [ "$app" = "data-center" ] && [ -s "${base}/live-center-workbench/.env.minimax" ]; then
    grep -E '^MINIMAX_(BASE_URL|API_KEY|MODEL)=' "${base}/live-center-workbench/.env.minimax" >> "${incoming}/.env"
  fi
done

sudo docker build -t fd-027340-data-center:latest "$stage/data-center"
sudo docker build -t fd-027340-dispatch-center:latest "$stage/dispatch-center"

for app in data-center dispatch-center; do
  current="${base}/${app}"
  incoming="${stage}/${app}"
  next="${current}.next"
  rm -rf "$next"
  install -d -m 750 "$next"
  tar -C "$incoming" -cf - . | tar -C "$next" -xf -
  chmod 600 "$next/.env"
done

if sudo docker ps -a --format '{{.Names}}' | grep -Fxq fd-027340-data-center; then sudo docker rm -f fd-027340-data-center >/dev/null; fi
sudo docker run -d --name fd-027340-data-center --restart unless-stopped --env-file "$base/data-center.next/.env" -p 127.0.0.1:24600:3000 fd-027340-data-center:latest >/dev/null

if sudo docker ps -a --format '{{.Names}}' | grep -Fxq fd-027340-dispatch-center; then sudo docker rm -f fd-027340-dispatch-center >/dev/null; fi
sudo docker run -d --name fd-027340-dispatch-center --restart unless-stopped --env-file "$base/dispatch-center.next/.env" -p 127.0.0.1:24601:3000 fd-027340-dispatch-center:latest >/dev/null

for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:24600/api/dashboard | python3 -c 'import json,sys; d=json.load(sys.stdin); assert not d.get("error"); assert isinstance(d.get("sessions"),list)' 2>/dev/null; then break; fi
  test "$attempt" -lt 20 || { sudo docker logs --tail=120 fd-027340-data-center >&2; exit 1; }
  sleep 3
done
for attempt in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:24601/api/health | grep -q '"ok":true'; then break; fi
  test "$attempt" -lt 15 || { sudo docker logs --tail=120 fd-027340-dispatch-center >&2; exit 1; }
  sleep 2
done

for app in data-center dispatch-center; do
  current="${base}/${app}"
  next="${current}.next"
  backup="${current}.backup.$(date +%s)"
  mv "$current" "$backup"
  mv "$next" "$current"
done

curl -fsS http://127.0.0.1:24500/healthz | grep -Fxq ok
echo 'DATA_CENTER_API=passed_live_mcp_json'
echo 'DISPATCH_CENTER_API=passed_live_mcp_json'
echo 'MAIN_WORKBENCH_HEALTH=passed'
echo 'MODULE_API_PATH_UPDATE_COMPLETE'
