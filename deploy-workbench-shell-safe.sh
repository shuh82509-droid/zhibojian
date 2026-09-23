#!/usr/bin/env bash
set -euo pipefail

update_file="${1:?updated index.html is required}"
base="/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench"
runtime_file="$base/site/index.html"
container="fd-027340-live-center-workbench"
image="fd-027340-live-center-workbench:latest"
backup="$(mktemp /tmp/fd-027340-workbench-index.XXXXXX.html)"

cleanup() { rm -f "$backup"; }
trap cleanup EXIT HUP INT TERM

test -s "$update_file"
grep -q 'data-page="business"' "$update_file"
grep -q '主播全生命周期管理' "$update_file"
docker inspect "$container" >/dev/null
docker cp "$container:/app/public/index.html" "$backup"

rollback() {
  docker cp "$backup" "$container:/app/public/index.html" >/dev/null 2>&1 || true
}
trap 'rollback; cleanup' ERR

mkdir -p "$(dirname "$runtime_file")"
cp "$update_file" "$runtime_file"
docker cp "$update_file" "$container:/app/public/index.html"

curl -fsS http://127.0.0.1:24500/healthz >/dev/null
curl -fsS http://127.0.0.1:24500/ | grep -q '直播经营看板'
curl -fsS http://127.0.0.1:24500/ | grep -q '主播全生命周期管理'
docker commit "$container" "$image" >/dev/null
trap cleanup EXIT HUP INT TERM
echo 'WORKBENCH_SHELL_DEPLOY=complete'
