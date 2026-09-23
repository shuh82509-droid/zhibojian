#!/usr/bin/env bash
set -Eeuo pipefail

base="/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench"
production="fd-027340-live-center-workbench"
production_image="fd-027340-live-center-workbench:latest"
release="$(date +%Y%m%d%H%M%S)"
candidate="${production}-candidate-${release}"
backup_image="fd-027340-live-center-workbench:rollback-${release}"
probe="$(mktemp /tmp/fd-027340-violations-resume.XXXXXX.json)"
switched=0

cleanup() {
  sudo docker rm -f "$candidate" >/dev/null 2>&1 || true
  rm -f "$probe"
}

run_production() {
  sudo docker run -d --name "$production" --restart unless-stopped \
    --env-file "$base/.env" --env-file "$base/.env.coco" --env-file "$base/.env.minimax" \
    -v "$base/data:/app/data" -p 127.0.0.1:24500:3000 "$production_image" >/dev/null
}

rollback() {
  code=$?
  if test "$switched" = 1; then
    echo 'Verification failed after switching; restoring the previous production image.' >&2
    sudo docker rm -f "$production" >/dev/null 2>&1 || true
    sudo docker tag "$backup_image" "$production_image"
    run_production
  fi
  cleanup
  exit "$code"
}
trap rollback ERR HUP INT TERM
trap cleanup EXIT

test -s "$base/.env"
test -s "$base/.env.coco"
test -s "$base/.env.minimax"
sudo -v

candidate_image="$(sudo docker image ls \
  --filter 'reference=fd-027340-live-center-workbench:violations-*' \
  --format '{{.Repository}}:{{.Tag}}' | head -n 1)"
test -n "$candidate_image" || { echo 'No verified collaboration candidate image was found.' >&2; exit 2; }
echo "RESUMING_IMAGE=$candidate_image"

sudo docker run -d --name "$candidate" \
  --env-file "$base/.env" --env-file "$base/.env.coco" --env-file "$base/.env.minimax" \
  -v "$base/data:/app/data" "$candidate_image" >/dev/null

for attempt in $(seq 1 45); do
  if sudo docker exec "$candidate" wget -q -O /dev/null http://127.0.0.1:3000/healthz; then
    echo 'CANDIDATE_MAIN_HEALTH=passed'
    break
  fi
  test "$attempt" -lt 45 || { sudo docker logs --tail=160 "$candidate" >&2; exit 3; }
  sleep 2
done

for attempt in $(seq 1 45); do
  if sudo docker exec "$candidate" wget -q -O /dev/null http://127.0.0.1:3001/; then
    echo 'CANDIDATE_COLLABORATION_HEALTH=passed'
    break
  fi
  test "$attempt" -lt 45 || { sudo docker logs --tail=160 "$candidate" >&2; exit 4; }
  sleep 2
done

candidate_url='http://127.0.0.1:3000/fd-027340/live-center-workbench/modules/tasks/api/violations?refresh=1'
if ! sudo docker exec "$candidate" node -e '
const url = process.argv[1];
fetch(url).then(async (response) => {
  console.error(`CANDIDATE_API_HTTP=${response.status}`);
  process.stdout.write(await response.text());
  if (!response.ok) process.exitCode = 22;
}).catch((error) => { console.error(error.message); process.exitCode = 23; });
' "$candidate_url" > "$probe"; then
  echo 'Candidate violation endpoint failed. Response body:' >&2
  cat "$probe" >&2 || true
  sudo docker logs --tail=160 "$candidate" >&2 || true
  exit 5
fi

python3 - "$probe" <<'PY'
import json, sys
p = json.load(open(sys.argv[1], encoding='utf-8'))
assert p.get('ok') is True, p
assert p.get('source') == 'feishu_chat', p
assert 'oc_a1f32ee1874fa98271d3bb19522abbb8' in (p.get('chatIds') or []), p
assert int(p.get('messagesScanned') or 0) > 0, p
assert len(p.get('rows') or []) > 0, p
print('CANDIDATE_COCO_CHAT=passed')
print('CANDIDATE_MESSAGES_SCANNED=%s' % p.get('messagesScanned'))
print('CANDIDATE_VIOLATIONS=%s' % len(p.get('rows') or []))
PY

sudo docker tag "$production_image" "$backup_image"
sudo docker tag "$candidate_image" "$production_image"
sudo docker rm -f "$production" >/dev/null
switched=1
run_production

for attempt in $(seq 1 45); do
  status="$(curl -sS -o "$probe" -w '%{http_code}' \
    'http://127.0.0.1:24500/fd-027340/live-center-workbench/modules/tasks/api/violations?refresh=1' || true)"
  if test "$status" = 200; then break; fi
  test "$attempt" -lt 45 || {
    echo "PRODUCTION_API_HTTP=$status" >&2
    cat "$probe" >&2 || true
    sudo docker logs --tail=160 "$production" >&2 || true
    exit 6
  }
  sleep 2
done
echo 'PRODUCTION_API_HTTP=200'

python3 - "$probe" <<'PY'
import json, sys
p = json.load(open(sys.argv[1], encoding='utf-8'))
assert p.get('ok') is True, p
assert p.get('source') == 'feishu_chat', p
assert 'oc_a1f32ee1874fa98271d3bb19522abbb8' in (p.get('chatIds') or []), p
assert int(p.get('messagesScanned') or 0) > 0, p
assert len(p.get('rows') or []) > 0, p
print('PRODUCTION_COCO_CHAT=passed')
print('PRODUCTION_MESSAGES_SCANNED=%s' % p.get('messagesScanned'))
print('PRODUCTION_VIOLATIONS=%s' % len(p.get('rows') or []))
PY

public_status="$(curl -sS -o /dev/null -w '%{http_code}' 'https://app.fandow.top/fd-027340/live-center-workbench/')"
case "$public_status" in 200|302) ;; *) echo "Unexpected public status: $public_status" >&2; exit 7;; esac

switched=0
echo "PUBLIC_STATUS=$public_status"
echo 'COLLABORATION_VIOLATION_DEPLOYMENT=passed'
