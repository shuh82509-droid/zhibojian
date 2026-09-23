#!/usr/bin/env bash
set -euo pipefail

source_file="${1:?central auth sidecar source is required}"
nginx_source="${2:?central auth nginx config is required}"
video_runtime="/home/fandow-deploy/fandow-apps/runtime/fd-026222/wis-video-center"
live_runtime="/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench"
source_container="fd-026222-wis-video-center"
sidecar_container="fd-026222-wis-central-auth"
candidate_container="fd-026222-wis-central-auth-candidate"
builder_container="fd-026222-wis-central-auth-builder"
release="$(TZ=Asia/Shanghai date +%Y%m%d%H%M%S)"
candidate_image="fd-026222-wis-central-auth:$release"
rollback_image="fd-026222-wis-central-auth:rollback-$release"
public_route="https://app.fandow.top/fd-026222/wis-central-auth/api"
nginx_target="/etc/nginx/lightdeploy-locations/fd-026222-wis-central-auth.conf"
nginx_candidate="/tmp/fd-026222-wis-central-auth-$release.conf"
backup_dir="$live_runtime/backups/central-auth-sidecar-$release"
old_sidecar_present=0
promoted=0

cleanup() {
  docker rm -f "$candidate_container" "$builder_container" >/dev/null 2>&1 || true
  rm -f "$nginx_candidate"
}

rollback() {
  if test "$promoted" != 1; then
    return
  fi
  docker rm -f "$sidecar_container" >/dev/null 2>&1 || true
  if test "$old_sidecar_present" = 1; then
    docker run -d --name "$sidecar_container" --restart unless-stopped \
      -p 127.0.0.1:39025:3000 \
      --env-file "$video_runtime/releases/$(cat "$video_runtime/CURRENT_RELEASE")/.env" \
      -v "$video_runtime/data:/data" "$rollback_image" >/dev/null || true
  fi
  if test -s "$backup_dir/nginx.conf"; then
    sudo install -m 0644 "$backup_dir/nginx.conf" "$nginx_target" || true
  else
    sudo rm -f "$nginx_target" || true
  fi
  sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx || true
}

on_exit() {
  status=$?
  trap - EXIT
  if test "$status" != 0; then
    rollback
  fi
  cleanup
  exit "$status"
}

trap on_exit EXIT
trap 'exit 130' INT TERM

test -s "$source_file"
test -s "$nginx_source"
test -s "$video_runtime/CURRENT_RELEASE"
current_release="$(cat "$video_runtime/CURRENT_RELEASE")"
env_file="$video_runtime/releases/$current_release/.env"
test -s "$env_file"
test -d "$video_runtime/data"
mkdir -p "$backup_dir"

source_image="$(docker inspect -f '{{.Image}}' "$source_container")"
docker image inspect "$source_image" >/dev/null
docker rm -f "$candidate_container" "$builder_container" >/dev/null 2>&1 || true

docker create --name "$builder_container" --user root --entrypoint /bin/sh "$source_image" -c 'sleep 600' >/dev/null
docker start "$builder_container" >/dev/null
docker cp "$source_file" "$builder_container:/app/backend/app/auth_only.py"
docker exec "$builder_container" python -m py_compile /app/backend/app/auth_only.py
docker commit \
  --change 'ENTRYPOINT ["uvicorn"]' \
  --change 'CMD ["app.auth_only:app","--host","0.0.0.0","--port","3000"]' \
  "$builder_container" "$candidate_image" >/dev/null
docker rm -f "$builder_container" >/dev/null

docker run -d --name "$candidate_container" \
  -p 127.0.0.1:39026:3000 \
  --env-file "$env_file" -v "$video_runtime/data:/data" "$candidate_image" >/dev/null

for attempt in $(seq 1 30); do
  if curl --max-time 3 -fsS 'http://127.0.0.1:39026/api/live' >/dev/null; then
    break
  fi
  if test "$attempt" = 30; then
    docker logs --tail=160 "$candidate_container" >&2 || true
    exit 1
  fi
  sleep 1
done
candidate_status="$(curl --max-time 4 -sS -o /tmp/fd-026222-wis-central-auth-candidate-body -w '%{http_code}' 'http://127.0.0.1:39026/api/central-auth/me')"
test "$candidate_status" = 401
grep -qE '未登录|登录状态' /tmp/fd-026222-wis-central-auth-candidate-body
rm -f /tmp/fd-026222-wis-central-auth-candidate-body
echo 'CANDIDATE_CENTRAL_AUTH_SIDECAR=passed'

if docker inspect "$sidecar_container" >/dev/null 2>&1; then
  old_sidecar_present=1
  old_image="$(docker inspect -f '{{.Image}}' "$sidecar_container")"
  docker image tag "$old_image" "$rollback_image"
  docker rm -f "$sidecar_container" >/dev/null
fi
if test -s "$nginx_target"; then
  sudo cp "$nginx_target" "$backup_dir/nginx.conf"
fi

docker run -d --name "$sidecar_container" --restart unless-stopped \
  -p 127.0.0.1:39025:3000 \
  --env-file "$env_file" -v "$video_runtime/data:/data" "$candidate_image" >/dev/null
promoted=1

for attempt in $(seq 1 40); do
  if curl --max-time 3 -fsS 'http://127.0.0.1:39025/api/live' >/dev/null; then
    break
  fi
  if test "$attempt" = 40; then
    docker logs --tail=180 "$sidecar_container" >&2 || true
    exit 1
  fi
  sleep 1
done

cp "$nginx_source" "$nginx_candidate"
sudo install -m 0644 "$nginx_candidate" "$nginx_target"
sudo nginx -t
sudo systemctl reload nginx

public_status="000"
for attempt in $(seq 1 20); do
  public_status="$(curl --max-time 8 -sS -o /dev/null -w '%{http_code}' "$public_route/central-auth/me" || true)"
  case "$public_status" in
    200|302|401) break ;;
  esac
  sleep 1
done
echo "PRODUCTION_PUBLIC_CENTRAL_AUTH_STATUS=$public_status"
case "$public_status" in
  200|302|401) ;;
  *) exit 1 ;;
esac
test "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$sidecar_container")" = 'unless-stopped'
test "$(docker inspect -f '{{json .Mounts}}' "$sidecar_container")" != '[]'
echo "PRODUCTION_CENTRAL_AUTH_SIDECAR=passed public_status=$public_status"
echo "CENTRAL_AUTH_PRIMARY=$public_route"
echo "CENTRAL_AUTH_SIDECAR_DEPLOYMENT=complete rollback=$backup_dir"
promoted=0
