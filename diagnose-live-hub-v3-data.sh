#!/usr/bin/env bash
set -euo pipefail

runtime="/home/fandow-deploy/fandow-apps/runtime/fd-027340/data-center"
container="fd-027340-data-center-v3-diagnostic"
image="$(docker image ls fd-027340-data-center --format '{{.Repository}}:{{.Tag}}' | awk '/:v3-/{print; exit}')"

if test -z "$image"; then
  echo 'DIAGNOSTIC_FAILED=no_v3_data_image'
  exit 1
fi
test -s "$runtime/.env"

cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
cleanup
echo "DIAGNOSTIC_IMAGE=$image"
docker run -d --name "$container" --env-file "$runtime/.env" "$image" >/dev/null

for attempt in $(seq 1 40); do
  if docker exec "$container" wget -q -O /dev/null 'http://127.0.0.1:3000/' 2>/dev/null; then break; fi
  test "$attempt" -lt 40 || { docker logs --tail=160 "$container"; exit 1; }
  sleep 2
done

probe() {
  local label="$1" url="$2"
  echo "=== $label ==="
  docker exec "$container" node -e '
const url=process.argv[1];
const timeout=Number(process.argv[2]);
fetch(url,{signal:AbortSignal.timeout(timeout)}).then(async response=>{
  console.log(`HTTP_STATUS=${response.status}`);
  const body=await response.text();
  console.log(body.slice(0,8000));
}).catch(error=>{console.log(`REQUEST_ERROR=${error.message}`);process.exitCode=2});
' "$url" 600000
}

probe DASHBOARD 'http://127.0.0.1:3000/api/dashboard?date=2026-08-18'
probe BUSINESS_OVERVIEW 'http://127.0.0.1:3000/api/business-overview?date=2026-08-18&refresh=1'
probe ANCHOR_TRENDS 'http://127.0.0.1:3000/api/anchor-trends?date=2026-08-18&days=14&refresh=1'
echo '=== sanitized logs ==='
docker logs --tail=200 "$container" 2>&1 | sed -E 's/(token|secret|key)=[^ ]+/\1=[redacted]/Ig'
echo 'V3_DATA_DIAGNOSTIC=complete'
