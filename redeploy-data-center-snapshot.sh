#!/usr/bin/env bash
set -euo pipefail

employee_id="fd-027340"
app_name="data-center"
archive="${1:?archive is required}"
base="/home/fandow-deploy/fandow-apps/runtime/${employee_id}"
app_dir="${base}/${app_name}"
next_dir="${app_dir}.next"
container="${employee_id}-${app_name}"
image="${container}:latest"
port="24600"

sudo -v
stage="$(mktemp -d)"
cleanup(){ rm -rf "$stage"; }
trap cleanup EXIT
tar -xzf "$archive" -C "$stage"
source_dir="${stage}/${app_name}"
test -f "$source_dir/Dockerfile"

env_copy="$(mktemp)"
if test -f "${app_dir}/.env"; then cat "${app_dir}/.env" > "$env_copy"; fi
sed '/^DATA_SOURCE=/d' "$env_copy" > "${env_copy}.next"
printf 'DATA_SOURCE=snapshot\n' >> "${env_copy}.next"
mv "${env_copy}.next" "$env_copy"

rm -rf "$next_dir"
install -d -m 750 "$next_dir"
tar -C "$source_dir" -cf - . | tar -C "$next_dir" -xf -
install -m 600 "$env_copy" "$next_dir/.env"
rm -f "$env_copy"

sudo docker build -t "$image" "$next_dir"
if sudo docker ps -a --format '{{.Names}}' | grep -Fxq "$container"; then sudo docker rm -f "$container"; fi
sudo docker run -d --name "$container" --restart unless-stopped --env-file "$next_dir/.env" -p "127.0.0.1:${port}:3000" "$image"
sudo docker inspect "$container" --format '{{.State.Status}} {{.Config.User}}' | grep -Eq '^running node$'
for attempt in $(seq 1 12); do
  if curl -fsS "http://127.0.0.1:${port}/api/dashboard" | grep -Fq '"sessions":[{'; then break; fi
  test "$attempt" -lt 12 || { sudo docker logs --tail=100 "$container" >&2; exit 1; }
  sleep 3
done

if test -d "$app_dir"; then mv "$app_dir" "${app_dir}.backup.$(date +%s)"; fi
mv "$next_dir" "$app_dir"
echo "SNAPSHOT_DATA_CENTER_DEPLOYED"
