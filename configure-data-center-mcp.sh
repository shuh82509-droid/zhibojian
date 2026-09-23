#!/usr/bin/env bash
set -euo pipefail

incoming="${1:?incoming credential file is required}"
app_dir="/home/fandow-deploy/fandow-apps/runtime/fd-027340/data-center"
env_file="${app_dir}/.env"
container="fd-027340-data-center"
image="${container}:latest"
port="24600"

test -f "$incoming"
test "$(grep -c '^FANDOW_DATA_MCP_TOKEN=.' "$incoming")" -eq 1
if grep -q '^FANDOW_DATA_MCP_TOKEN=PASTE_MCP_TOKEN_HERE$' "$incoming"; then
  echo 'MCP Token placeholder was not replaced.' >&2
  exit 2
fi

umask 077
next_env="$(mktemp "${app_dir}/.env.next.XXXXXX")"
cleanup() { rm -f "$next_env" "$incoming"; }
trap cleanup EXIT HUP INT TERM
if test -f "$env_file"; then
  grep -v -E '^(FANDOW_DATA_MCP_TOKEN|DATA_SOURCE)=' "$env_file" > "$next_env" || true
fi
cat "$incoming" >> "$next_env"
printf 'DATA_SOURCE=mcp\n' >> "$next_env"
chmod 600 "$next_env"
mv -f "$next_env" "$env_file"
rm -f "$incoming"
trap - EXIT HUP INT TERM

if sudo docker ps -a --format '{{.Names}}' | grep -Fxq "$container"; then
  sudo docker rm -f "$container" >/dev/null
fi
sudo docker run -d --name "$container" --restart unless-stopped --env-file "$env_file" -p "127.0.0.1:${port}:3000" "$image" >/dev/null

body="$(mktemp)"
trap 'rm -f "$body"' EXIT HUP INT TERM
for attempt in $(seq 1 20); do
  status="$(curl -sS -o "$body" -w '%{http_code}' "http://127.0.0.1:${port}/api/dashboard")" || status=000
  if test "$status" = 200 && python3 - "$body" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    data = json.load(handle)
if data.get('error'):
    raise SystemExit(1)
if not isinstance(data.get('sessions'), list) or not isinstance(data.get('recentSessions'), list):
    raise SystemExit(1)
PY
  then
    break
  fi
  test "$attempt" -lt 20 || {
    echo "Data center MCP verification failed with HTTP ${status}." >&2
    head -c 800 "$body" >&2 || true
    echo >&2
    sudo docker logs --tail=100 "$container" >&2
    exit 1
  }
  sleep 3
done

python3 - "$body" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    data = json.load(handle)
print('DATA_SOURCE=mcp')
print('HTTP_STATUS=200')
print(f"SESSIONS={len(data.get('sessions', []))}")
print(f"RECENT_SESSIONS={len(data.get('recentSessions', []))}")
print(f"FETCHED_AT={data.get('fetchedAt', '')}")
print('MCP_TOKEN_STORAGE=server_only_mode_600')
PY
