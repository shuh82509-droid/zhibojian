#!/usr/bin/env bash
set -Eeuo pipefail

name="fd-027340-live-center-workbench"
runtime="/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench"
authority="https://app.fandow.top/fd-026222/wis-video-center/api"
release="$(TZ=Asia/Shanghai date +%Y%m%d%H%M%S)"
candidate="${name}-auth-route-candidate"
backup="${name}-auth-route-rollback-${release}"
image="$(docker inspect "$name" --format '{{.Config.Image}}')"
switched=0

cleanup() {
  docker rm -f "$candidate" >/dev/null 2>&1 || true
}

rollback() {
  local code="${1:-$?}"
  trap - ERR INT TERM
  set +e
  if [[ "$switched" == "1" ]]; then
    echo "LIVE_AUTH_ROUTE_FAILED_CONTAINER_LOGS" >&2
    docker logs --tail=80 "$name" >&2 || true
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker rename "$backup" "$name" >/dev/null 2>&1 || true
    docker start "$name" >/dev/null 2>&1 || true
  fi
  cleanup
  echo "LIVE_AUTH_ROUTE_ROLLBACK=performed" >&2
  exit "$code"
}
trap 'rollback $?' ERR
trap 'rollback 130' INT TERM
trap cleanup EXIT

test -s "$runtime/.env"
test -s "$runtime/.env.coco"
test -s "$runtime/.env.minimax"
test -s "$runtime/.env.jump"
docker image inspect "$image" >/dev/null
docker rm -f "$candidate" >/dev/null 2>&1 || true

docker run -d --name "$candidate" \
  --env-file "$runtime/.env" \
  --env-file "$runtime/.env.coco" \
  --env-file "$runtime/.env.minimax" \
  --env-file "$runtime/.env.jump" \
  -e CENTRAL_AUTHORITY_BASE="$authority" \
  -e LIFECYCLE_SCHEDULER_ENABLED=0 \
  -v "$runtime/data:/app/data" \
  "$image" >/dev/null

for _ in $(seq 1 40); do
  state="$(docker inspect "$candidate" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
  [[ "$state" == "healthy" ]] && break
  [[ "$state" == "unhealthy" || "$state" == "exited" || "$state" == "dead" ]] && false
  sleep 2
done
test "$(docker inspect "$candidate" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')" = "healthy"

docker exec "$candidate" node -e '
const base=process.env.CENTRAL_AUTHORITY_BASE;
if(base!=="https://app.fandow.top/fd-026222/wis-video-center/api") throw new Error(`unexpected authority ${base}`);
const health=await fetch(`${base}/health`,{redirect:"manual",signal:AbortSignal.timeout(15000)});
if(![200,301,302,303,307,308,401].includes(health.status)) throw new Error(`authority route ${health.status}`);
const auth=await fetch(`${base}/central-auth/me`,{redirect:"manual",signal:AbortSignal.timeout(15000)});
if(![301,302,303,307,308,401].includes(auth.status)) throw new Error(`authority auth ${auth.status}`);
console.log(`CANDIDATE_AUTHORITY=passed health=${health.status} unauth=${auth.status}`);
'

docker stop "$name" >/dev/null
docker rename "$name" "$backup"
switched=1

docker run -d --name "$name" --restart unless-stopped \
  --env-file "$runtime/.env" \
  --env-file "$runtime/.env.coco" \
  --env-file "$runtime/.env.minimax" \
  --env-file "$runtime/.env.jump" \
  -e CENTRAL_AUTHORITY_BASE="$authority" \
  -v "$runtime/data:/app/data" \
  -p 127.0.0.1:24500:3000 \
  "$image" >/dev/null
echo "PRODUCTION_CONTAINER_STARTED=passed"

for _ in $(seq 1 40); do
  state="$(docker inspect "$name" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
  [[ "$state" == "healthy" ]] && break
  [[ "$state" == "unhealthy" || "$state" == "exited" || "$state" == "dead" ]] && false
  sleep 2
done
test "$(docker inspect "$name" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')" = "healthy"
echo "PRODUCTION_HEALTH=passed"
test "$(docker inspect "$name" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CENTRAL_AUTHORITY_BASE=//p')" = "$authority"
echo "PRODUCTION_AUTHORITY_ENV=passed"
curl -fsS 'http://127.0.0.1:24500/healthz' >/dev/null
echo "PRODUCTION_LOCAL_ROUTE=passed"

session_status="$(docker exec "$name" node -e '
const response=await fetch("http://127.0.0.1:3000/fd-027340/live-center-workbench/api/session",{
  headers:{"X-Forwarded-For":"203.0.113.10"},redirect:"manual",signal:AbortSignal.timeout(20000)
});
process.stdout.write(String(response.status));
')"
echo "PRODUCTION_UNAUTH_SESSION_OBSERVED=$session_status"
test "$session_status" = "401"
echo "PRODUCTION_UNAUTH_SESSION=passed status=$session_status"

public_status="$(curl -sS -o /dev/null -w '%{http_code}' 'https://app.fandow.top/fd-027340/live-center-workbench/')"
case "$public_status" in 200|301|302|303|307|308|401) ;; *) false ;; esac
echo "PRODUCTION_PUBLIC_ROUTE=passed status=$public_status"

switched=0
trap - ERR INT TERM
echo "LIVE_AUTH_ROUTE_RELEASE=$release"
echo "CENTRAL_AUTHORITY_BASE=$authority"
echo "SESSION_UNAUTH_STATUS=$session_status"
echo "PUBLIC_STATUS=$public_status"
echo "LIVE_AUTH_ROUTE_FIX=passed"
