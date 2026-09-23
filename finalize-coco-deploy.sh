#!/usr/bin/env sh
set -eu

EMPLOYEE_ID="fd-027340"
EMPLOYEE_RECORD="FD-027340"
APP_NAME="live-center-workbench"
CONTAINER="${EMPLOYEE_ID}-${APP_NAME}"
PORT="24500"
PUBLIC_URL="https://app.fandow.top/${EMPLOYEE_ID}/${APP_NAME}/"
NGINX_FILE="/etc/nginx/lightdeploy-locations/${EMPLOYEE_ID}-${APP_NAME}.conf"

STATUS=$(sudo docker inspect "$CONTAINER" --format '{{.State.Status}}')
[ "$STATUS" = 'running' ] || { echo "Container status is ${STATUS}." >&2; exit 1; }
sudo docker port "$CONTAINER" | grep -q "127.0.0.1:${PORT}" || { echo 'Container port ownership check failed.' >&2; exit 1; }
curl -fsS "http://127.0.0.1:${PORT}/" | grep -q 'LIVE HUB' || { echo 'Local page fingerprint check failed.' >&2; exit 1; }

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM
curl -fsS "http://127.0.0.1:${PORT}/api/feishu/status" -o "$TMP_DIR/status.json"
curl -fsS "http://127.0.0.1:${PORT}/api/feishu/chats/recruitment/messages?limit=1" -o "$TMP_DIR/chat.json"
curl -fsS "http://127.0.0.1:${PORT}/api/feishu/documents/morning_wangou" -o "$TMP_DIR/doc.json"
python3 - "$TMP_DIR/status.json" "$TMP_DIR/chat.json" "$TMP_DIR/doc.json" <<'PY'
import json, sys
status, chat, doc = (json.load(open(path, encoding='utf-8')) for path in sys.argv[1:])
if status.get('ok') is not True or status.get('configured') is not True:
    raise SystemExit('Coco tenant-token status check failed')
if status.get('appId') != 'cli_aafbc3a80eb8dcf4':
    raise SystemExit('Coco App ID mismatch')
if chat.get('ok') is not True:
    raise SystemExit('Coco target-chat read check failed')
if doc.get('ok') is not True:
    raise SystemExit('Coco target-document read check failed')
print('FEISHU_CHECK=passed_token_chat_document')
PY

grep -q 'auth_request /_auto_deploy_auth_verify;' "$NGINX_FILE" || { echo 'Nginx OA auth_request is missing.' >&2; exit 1; }
grep -q "proxy_pass http://127.0.0.1:${PORT}/" "$NGINX_FILE" || { echo 'Nginx project proxy target is incorrect.' >&2; exit 1; }
sudo nginx -t

PUBLIC_STATUS=$(curl -ksS -o /dev/null -w '%{http_code}' "$PUBLIC_URL")
case "$PUBLIC_STATUS" in
  200|301|302|303|307|308|401|403) ;;
  *) echo "Public route returned unexpected HTTP ${PUBLIC_STATUS}." >&2; exit 1 ;;
esac

curl -fsS http://127.0.0.1:11123/api/project-records -o "$TMP_DIR/records.json"
python3 - "$TMP_DIR/records.json" "$EMPLOYEE_RECORD" "$APP_NAME" "$PUBLIC_URL" <<'PY'
import json, sys
path, employee_id, app_name, access_url = sys.argv[1:]
payload = json.load(open(path, encoding='utf-8'))
def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)
items = list(walk(payload))
same = [item for item in items if (item.get('app_name') == app_name or item.get('project_name') == app_name) and item.get('access_url') == access_url]
if not same:
    raise SystemExit('matching project record was not found')
print('PROJECT_RECORD_SYNC=skipped_unchanged')
PY

printf 'DEPLOYED_URL=%s\nHOST_PORT=%s\nCONTAINER=%s\nPORT_MAP_STATUS=reused_existing_assignment\nFINGERPRINT_CHECK=passed_local\nPUBLIC_ROUTE_STATUS=%s\n' "$PUBLIC_URL" "$PORT" "$CONTAINER" "$PUBLIC_STATUS"
