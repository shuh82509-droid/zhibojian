#!/usr/bin/env bash
set -Eeuo pipefail

archive="${1:?central hub archive is required}"
runtime="/home/fandow-deploy/fandow-apps/runtime/fd-026222/wis-marketing-hub"
production="fd-026222-wis-marketing-hub"
latest_image="${production}:latest"
release="$(TZ=Asia/Shanghai date +%Y%m%d%H%M%S)"
candidate_image="${production}:single-level-${release}"
rollback_image="${production}:rollback-${release}"
candidate="${production}-single-level-candidate"
backup="${production}-single-level-backup"
builder="${production}-single-level-builder"
production_port="18140"
stage="$(mktemp -d /tmp/fd-026222-hub-single-level.XXXXXX)"

cleanup() {
  docker rm -f "$candidate" "$builder" >/dev/null 2>&1 || true
  rm -rf "$stage"
}
trap cleanup EXIT HUP INT TERM

test -s "$archive"
test -d "$runtime"
tar -xzf "$archive" -C "$stage"
test -s "$stage/server.mjs"
test -s "$stage/dist/index.html"
grep -Fq 'https://app.fandow.top/fd-027340/live-center-workbench/#schedule' "$stage/server.mjs"

docker image inspect "$latest_image" >/dev/null
docker rm -f "$builder" "$candidate" >/dev/null 2>&1 || true
docker create --name "$builder" --user root --entrypoint /bin/sh "$latest_image" -c 'sleep 600' >/dev/null
docker start "$builder" >/dev/null
docker exec "$builder" rm -rf /app/dist
docker cp "$stage/dist/." "$builder:/app/dist/"
docker cp "$stage/server.mjs" "$builder:/app/server.mjs"
docker commit --change 'USER app' --change 'ENTRYPOINT ["docker-entrypoint.sh"]' \
  --change 'CMD ["node","server.mjs"]' "$builder" "$candidate_image" >/dev/null
docker rm -f "$builder" >/dev/null

docker run -d --name "$candidate" -e "RELEASE_ID=$release" "$candidate_image" >/dev/null
for attempt in $(seq 1 30); do
  if docker exec "$candidate" node -e \
    "fetch('http://127.0.0.1:3000/health').then(r=>r.json()).then(d=>{if(!d.ok)process.exit(1)}).catch(()=>process.exit(1))"; then break; fi
  test "$attempt" -lt 30 || { docker logs --tail=120 "$candidate" >&2; exit 1; }
  sleep 2
done
docker exec "$candidate" grep -Fq 'https://app.fandow.top/fd-027340/live-center-workbench/#schedule' /app/server.mjs
docker exec "$candidate" node -e '
fetch("http://127.0.0.1:3000/api/session",{headers:{"X-Forwarded-For":"203.0.113.8"}})
  .then(response=>{console.log(`CANDIDATE_SESSION_STATUS=${response.status}`);if(![302,401,403].includes(response.status))process.exitCode=22})
  .catch(()=>process.exitCode=23)
'
echo 'CANDIDATE_CENTRAL_HUB=passed'

docker tag "$latest_image" "$rollback_image"
docker rm -f "$backup" >/dev/null 2>&1 || true
docker stop "$production" >/dev/null
docker rename "$production" "$backup"

rollback() {
  echo 'Central hub production verification failed; rolling back.' >&2
  docker rm -f "$production" >/dev/null 2>&1 || true
  docker rename "$backup" "$production" >/dev/null 2>&1 || true
  docker start "$production" >/dev/null 2>&1 || true
  docker tag "$rollback_image" "$latest_image" >/dev/null 2>&1 || true
}
trap 'rollback; cleanup' ERR

docker run -d --name "$production" --restart unless-stopped \
  --label 'fandow.employee_id=fd-026222' --label 'fandow.app_name=wis-marketing-hub' \
  --label "fandow.release_id=$release" -e "RELEASE_ID=$release" \
  -p "127.0.0.1:${production_port}:3000" "$candidate_image" >/dev/null
for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${production_port}/health" | grep -q '"ok":true'; then break; fi
  test "$attempt" -lt 30 || { docker logs --tail=120 "$production" >&2; exit 1; }
  sleep 2
done

public_health="$(curl -sS -o "$stage/public-health.json" -w '%{http_code}' \
  'https://app.fandow.top/fd-026222/wis-marketing-hub/health')"
test "$public_health" = "200"
grep -q '"ok":true' "$stage/public-health.json"
public_status="$(curl -sS -o /dev/null -w '%{http_code}' \
  'https://app.fandow.top/fd-026222/wis-marketing-hub/')"
test "$public_status" = "302" -o "$public_status" = "401"

release_dir="$runtime/releases/$release"
test ! -e "$release_dir"
mkdir -p "$release_dir"
cp -a "$stage/server.mjs" "$stage/dist" "$release_dir/"
ln -sfn "releases/$release" "$runtime/current"
printf '%s\n' "$release" > "$runtime/CURRENT_RELEASE"
docker tag "$candidate_image" "$latest_image"
docker rm -f "$backup" >/dev/null
trap cleanup EXIT HUP INT TERM

echo "CENTRAL_HUB_RELEASE=$release"
echo "PUBLIC_STATUS=$public_status"
echo 'CENTRAL_HUB_SINGLE_LEVEL_DEPLOY=complete'
