#!/usr/bin/env bash
set -euo pipefail

employee="fd-027340"
main_container="${employee}-live-center-workbench"
container="${employee}-dispatch-center"
image="${container}:latest"
data_env="/home/fandow-deploy/fandow-apps/runtime/${employee}/data-center/.env"
app_dir="/home/fandow-deploy/fandow-apps/runtime/${employee}/dispatch-center"
env_file="${app_dir}/.env"
port="24601"

test -f "$data_env"
token_line="$(grep '^FANDOW_DATA_MCP_TOKEN=.' "$data_env" | head -n 1)"
test -n "$token_line"
test -d "$app_dir"
sudo docker image inspect "$image" >/dev/null

umask 077
next_env="$(mktemp "${app_dir}/.env.next.XXXXXX")"
trap 'rm -f "$next_env"' EXIT HUP INT TERM
if test -f "$env_file"; then
  grep -v '^MCP_BEARER_TOKEN=' "$env_file" > "$next_env" || true
fi
printf 'MCP_BEARER_TOKEN=%s\n' "${token_line#FANDOW_DATA_MCP_TOKEN=}" >> "$next_env"
chmod 600 "$next_env"
mv -f "$next_env" "$env_file"
trap - EXIT HUP INT TERM

if sudo docker ps -a --format '{{.Names}}' | grep -Fxq "$container"; then
  sudo docker rm -f "$container" >/dev/null
fi
sudo docker run -d --name "$container" --restart unless-stopped --env-file "$env_file" -p "127.0.0.1:${port}:3000" "$image" >/dev/null

for attempt in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${port}/api/health" | grep -q '"ok":true'; then break; fi
  test "$attempt" -lt 15 || { sudo docker logs --tail=120 "$container" >&2; exit 1; }
  sleep 2
done
curl -fsS "http://127.0.0.1:${port}/" | grep -q '调度中心' || { echo 'Dispatch page check failed.' >&2; exit 1; }

if ! sudo docker ps --format '{{.Names}}' | grep -Fxq "$main_container"; then
  sudo docker start "$main_container" >/dev/null
fi
for attempt in $(seq 1 10); do
  if curl -fsS http://127.0.0.1:24500/healthz | grep -Fxq ok; then break; fi
  test "$attempt" -lt 10 || { echo 'Main workbench is not healthy after dispatch recovery.' >&2; exit 1; }
  sleep 2
done

sudo nginx -t
sudo nginx -s reload
public_status="$(curl -ksS -o /dev/null -w '%{http_code}' 'https://app.fandow.top/fd-027340/dispatch-center/')"
echo 'DISPATCH_CONTAINER=running'
echo 'DISPATCH_HEALTH=passed'
echo 'MCP_CONFIGURATION=server_side_reused'
echo 'MAIN_WORKBENCH_HEALTH=passed'
echo "PUBLIC_STATUS=${public_status}"
echo 'DISPATCH_RECOVERY_COMPLETE'
