#!/usr/bin/env sh
set -eu

EMPLOYEE_ID="fd-027340"
EMPLOYEE_RECORD="FD-027340"
APP_NAME="live-center-workbench"
APP_DIR="/home/fandow-deploy/fandow-apps/runtime/${EMPLOYEE_ID}/${APP_NAME}"
CONTAINER="${EMPLOYEE_ID}-${APP_NAME}"
IMAGE="${CONTAINER}:latest"
NGINX_FILE="/etc/nginx/lightdeploy-locations/${EMPLOYEE_ID}-${APP_NAME}.conf"
PUBLIC_PREFIX="/${EMPLOYEE_ID}/${APP_NAME}"
PUBLIC_URL="https://app.fandow.top${PUBLIC_PREFIX}/"
FINGERPRINT="LIVE HUB"
PORT="24500"

cd "$APP_DIR"
mkdir -p data/morning
chmod 700 data data/morning
if [ ! -s .env ]; then
  umask 077
  SESSION_VALUE=$(openssl rand -hex 32)
  {
    printf 'SESSION_SECRET=%s\n' "$SESSION_VALUE"
    printf 'AUTH_REQUIRED=false\n'
    printf 'BASE_PATH=/fd-027340/live-center-workbench\n'
    printf 'PUBLIC_ORIGIN=https://app.fandow.top\n'
  } > .env
  unset SESSION_VALUE
fi
[ -s .env.coco ] || { echo 'Missing server-only Coco credential file: .env.coco' >&2; exit 1; }
[ -s .env.minimax ] || { echo 'Missing server-only MiniMax configuration file: .env.minimax' >&2; exit 1; }
grep -q '^FEISHU_APP_ID=cli_aafbc3a80eb8dcf4$' .env.coco || { echo 'Coco App ID is missing or incorrect.' >&2; exit 1; }
grep -q '^FEISHU_APP_SECRET=.' .env.coco || { echo 'Coco App Secret is empty.' >&2; exit 1; }
grep -q '^MINIMAX_API_KEY=.' .env.minimax || { echo 'MiniMax API key is empty.' >&2; exit 1; }
grep -q '^MINIMAX_BASE_URL=https://cloud.fandow.com/gpt/openclaw-jump/v1$' .env.minimax || { echo 'MiniMax endpoint is missing or incorrect.' >&2; exit 1; }
if grep -q '^FEISHU_APP_SECRET=PASTE_APP_SECRET_HERE$' .env.coco; then
  echo 'Coco App Secret still contains the placeholder.' >&2
  exit 1
fi
chmod 600 .env .env.coco .env.minimax

# Reuse the host port already assigned to this same app by its earlier verified
# deployment. Refuse to continue if another container or non-Docker listener
# has taken it.
PORT_OWNERS=$(sudo docker ps -a --format '{{.Names}} {{.Ports}}' | grep "127.0.0.1:${PORT}->" || true)
if [ -n "$PORT_OWNERS" ] && ! printf '%s\n' "$PORT_OWNERS" | awk -v expected="$CONTAINER" '$1 != expected { bad=1 } END { exit bad }'; then
  echo "Host port ${PORT} is owned by another container; deployment stopped." >&2
  exit 1
fi
if ss -ltn | grep -Eq "127\\.0\\.0\\.1:${PORT}([^0-9]|$)" && [ -z "$PORT_OWNERS" ]; then
  echo "Host port ${PORT} is occupied by a non-project listener; deployment stopped." >&2
  exit 1
fi

sudo nginx -T 2>/dev/null | grep -q '_auto_deploy_auth_verify' || { echo 'Server OA authentication infrastructure is missing.' >&2; exit 1; }
sudo docker build -t "$IMAGE" .
if sudo docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then sudo docker rm -f "$CONTAINER"; fi
sudo docker run -d --name "$CONTAINER" --restart unless-stopped --env-file .env --env-file .env.coco --env-file .env.minimax -v "$APP_DIR/data:/app/data" -p "127.0.0.1:${PORT}:3000" "$IMAGE"

STATUS=$(sudo docker inspect "$CONTAINER" --format '{{.State.Status}}')
[ "$STATUS" = 'running' ] || { echo 'Container is not running.' >&2; exit 1; }
sudo docker port "$CONTAINER" | grep -q "127.0.0.1:${PORT}" || { echo 'Container is bound to the wrong host port.' >&2; exit 1; }

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:${PORT}/" | grep -q "$FINGERPRINT"; then break; fi
  [ "$attempt" -lt 10 ] || { sudo docker logs --tail=120 "$CONTAINER"; echo 'Local health or fingerprint check failed.' >&2; exit 1; }
  sleep 2
done

for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS "http://127.0.0.1:${PORT}/modules/tasks/" | grep -q '直播运营'; then break; fi
  [ "$attempt" -lt 15 ] || { sudo docker logs --tail=160 "$CONTAINER"; echo 'Collaboration center runtime check failed.' >&2; exit 1; }
  sleep 2
done
curl -fsS "http://127.0.0.1:${PORT}/modules/materials/material-center.html" | grep -q '素材中心' || { echo 'Material center static check failed.' >&2; exit 1; }
curl -fsSG --data-urlencode 'url=https://jqx28l0j4lx.feishu.cn/wiki/DpHqwtFbYigLnkk6CJMcVuCIn4d' "http://127.0.0.1:${PORT}/api/feishu/view" | grep -q 'Coco 文档读取' || { echo 'Coco document proxy check failed.' >&2; exit 1; }
curl -fsS "http://127.0.0.1:${PORT}/api/intelligence/status" | grep -q '"configured":true' || { echo 'MiniMax server configuration check failed.' >&2; exit 1; }
curl -fsS "http://127.0.0.1:${PORT}/api/morning/status" | grep -q '"refreshRule"' || { echo 'Dynamic morning report API check failed.' >&2; exit 1; }
# MiniMax generation is asynchronous and may briefly be unavailable after a
# host restart.  Do not roll back healthy Coco-backed module updates merely
# because the first intelligence refresh needs another scheduled retry.
INTELLIGENCE_CHECK=$(mktemp)
if curl -fsS --max-time 90 "http://127.0.0.1:${PORT}/api/intelligence/briefing" -o "$INTELLIGENCE_CHECK"; then
  python3 - "$INTELLIGENCE_CHECK" <<'PY' || echo 'MiniMax initial analysis is incomplete; scheduled retry will continue.' >&2
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    payload = json.load(handle)
data = payload.get('data') if isinstance(payload, dict) else None
if not payload.get('ok') or not isinstance(data, dict) or not data.get('overview') or not data.get('generatedAt'):
    raise SystemExit(1)
PY
else
  echo 'MiniMax initial analysis is temporarily unavailable; scheduled retry will continue.' >&2
fi
rm -f "$INTELLIGENCE_CHECK"

cat > "/tmp/${EMPLOYEE_ID}-${APP_NAME}.conf" <<EOF
location = ${PUBLIC_PREFIX} { return 301 ${PUBLIC_PREFIX}/; }
location ^~ ${PUBLIC_PREFIX}/api/ {
    auth_request /_auto_deploy_auth_verify;
    error_page 401 = @auto_deploy_login_callbackUrl;
    error_page 500 =503 /_auth_unavailable;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Prefix ${PUBLIC_PREFIX};
    proxy_pass http://127.0.0.1:${PORT}/api/;
}
location ^~ ${PUBLIC_PREFIX}/ {
    auth_request /_auto_deploy_auth_verify;
    error_page 401 = @auto_deploy_login_callbackUrl;
    error_page 500 =503 /_auth_unavailable;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Prefix ${PUBLIC_PREFIX};
    proxy_pass http://127.0.0.1:${PORT}/;
}
EOF
sudo install -m 644 "/tmp/${EMPLOYEE_ID}-${APP_NAME}.conf" "$NGINX_FILE"
sudo nginx -t
sudo nginx -s reload

PUBLIC_STATUS=$(curl -ksS -o /dev/null -w '%{http_code}' "$PUBLIC_URL")
case "$PUBLIC_STATUS" in
  200|301|302|303|307|308|401|403) ;;
  *) echo "Public route check failed with HTTP ${PUBLIC_STATUS}." >&2; exit 1 ;;
esac

RECORD_FILE=$(mktemp)
trap 'rm -f "$RECORD_FILE"' EXIT HUP INT TERM
curl -fsS http://127.0.0.1:11123/api/project-records -o "$RECORD_FILE"
python3 - "$RECORD_FILE" "$APP_NAME" "$PUBLIC_URL" <<'PY'
import json, sys
record_file, app_name, url = sys.argv[1:]
with open(record_file, encoding='utf-8') as handle:
    payload = json.load(handle)
def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)
matched = any(
    (item.get('app_name') == app_name or item.get('project_name') == app_name)
    and item.get('access_url') == url
    for item in walk(payload)
)
if not matched:
    print('matching project record was not found; keeping the already-registered record unchanged', file=sys.stderr)
PY
rm -f "$RECORD_FILE"
trap - EXIT HUP INT TERM

printf 'DEPLOYED_URL=%s\nHOST_PORT=%s\nCONTAINER=%s\nPORT_MAP_STATUS=reused_existing_assignment\nFINGERPRINT_CHECK=passed_local\nCOLLABORATION_CENTER_CHECK=passed_local\nMATERIAL_CENTER_CHECK=passed_local\nCOCO_DOCUMENT_PROXY_CHECK=passed_local\nMINIMAX_CONFIGURATION_CHECK=passed_local\nDYNAMIC_MORNING_API_CHECK=passed_local\nPUBLIC_ROUTE_STATUS=%s\nPROJECT_RECORD_SYNC=skipped_unchanged\n' "$PUBLIC_URL" "$PORT" "$CONTAINER" "$PUBLIC_STATUS"
