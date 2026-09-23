#!/usr/bin/env bash
set -euo pipefail

archive="${1:?deployment archive is required}"
target_date="${2:?target date is required}"
runtime_root="/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench"
image_name="fd-027340-live-center-workbench"
container_name="fd-027340-live-center-workbench"
candidate_name="${container_name}-recruitment-candidate"
backup_name="${container_name}-recruitment-backup"
release="$(TZ=Asia/Shanghai date +%Y%m%d%H%M%S)"
candidate_image="${image_name}:recruitment-${release}"
rollback_image="${image_name}:rollback-recruitment-${release}"
stage="$(mktemp -d /tmp/fd-027340-recruitment.XXXXXX)"

cleanup() {
  sudo docker rm -f "$candidate_name" >/dev/null 2>&1 || true
  rm -rf "$stage"
}
trap cleanup EXIT HUP INT TERM

test -s "$archive"
test -s "$runtime_root/.env"
test -s "$runtime_root/.env.coco"
test -s "$runtime_root/.env.minimax"
sudo docker image inspect "$image_name:latest" >/dev/null
tar -xzf "$archive" -C "$stage"
test -s "$stage/Dockerfile.recruitment-resume-trend"
test -s "$stage/server.js"
test -s "$stage/exports/recruitment-pool/recruitment-dashboard.html"

echo '=== Building recruitment-only overlay image ==='
sudo docker build -f "$stage/Dockerfile.recruitment-resume-trend" -t "$candidate_image" "$stage"
sudo docker rm -f "$candidate_name" >/dev/null 2>&1 || true
sudo docker run -d --name "$candidate_name" \
  --env-file "$runtime_root/.env" \
  --env-file "$runtime_root/.env.coco" \
  --env-file "$runtime_root/.env.minimax" \
  -v "$runtime_root/data:/app/data" \
  "$candidate_image" >/dev/null

for attempt in $(seq 1 40); do
  if sudo docker exec "$candidate_name" wget -q -O /dev/null 'http://127.0.0.1:3000/healthz'; then
    echo 'CANDIDATE_HEALTH=passed'
    break
  fi
  test "$attempt" -lt 40 || { sudo docker logs --tail=160 "$candidate_name" >&2; exit 1; }
  sleep 2
done

candidate_html="$stage/recruitment.html"
candidate_json="$stage/recruitment-chat.json"
sudo docker exec "$candidate_name" wget -q -O - \
  'http://127.0.0.1:3000/fd-027340/live-center-workbench/modules/recruitment/recruitment-dashboard.html' \
  > "$candidate_html"
sudo docker exec -i "$candidate_name" node - "$target_date" > "$candidate_json" <<'NODE'
const targetDate = process.argv[2];
const end = new Date(`${targetDate}T23:59:59+08:00`);
const start = new Date(`${targetDate}T00:00:00+08:00`);
start.setUTCDate(start.getUTCDate() - 13);
const url = `http://127.0.0.1:3000/api/feishu/chats/recruitment/messages?limit=500&start_time=${Math.floor(start.getTime()/1000)}&end_time=${Math.floor(end.getTime()/1000)}`;
fetch(url, {signal: AbortSignal.timeout(120000)})
  .then(async response => {
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
    process.stdout.write(body);
  })
  .catch(error => { console.error(error.message); process.exit(1); });
NODE

python3 - "$candidate_html" "$candidate_json" "$target_date" <<'PY'
import datetime as dt
import json
import re
import sys
from zoneinfo import ZoneInfo

html = open(sys.argv[1], encoding='utf-8').read()
payload = json.load(open(sys.argv[2], encoding='utf-8'))
target = dt.date.fromisoformat(sys.argv[3])
required = [
    '求职者是否符合主播邀约标准',
    'function resumeSubmissionName(text)',
    'liveResumeCounts===null',
    'const submissionKey=`${date}|${name}`',
]
missing = [item for item in required if item not in html]
assert not missing, f'missing recruitment UI rules: {missing}'
messages = ((payload.get('data') or {}).get('messages') or [])
pattern = re.compile(r'求职者\s+(.{1,20}?)\s+是否符合\s*[【\[]?\s*主播\s*[】\]]?\s*的邀约标准')
start = target - dt.timedelta(days=13)
seen = set()
counts = {}
for message in messages:
    match = pattern.search(str(message.get('text') or ''))
    if not match or not message.get('createdAt'):
        continue
    created = dt.datetime.fromisoformat(str(message['createdAt']).replace('Z', '+00:00')).astimezone(ZoneInfo('Asia/Shanghai'))
    date = created.date()
    if not start <= date <= target:
        continue
    key = (date.isoformat(), match.group(1).strip())
    if key in seen:
        continue
    seen.add(key)
    counts[key[0]] = counts.get(key[0], 0) + 1
assert seen, 'no invitation-standard resume submissions found in the last 14 days'
assert len(messages) > 50, f'time-window pagination returned only {len(messages)} messages'
assert len(seen) >= 40, f'only {len(seen)} resume submissions were recovered from the 14-day window'
print(f'CANDIDATE_RECRUITMENT_UI=passed')
print(f'CANDIDATE_RECRUITMENT_CHAT=passed messages={len(messages)} submissions={len(seen)}')
print('CANDIDATE_RECRUITMENT_DAILY=' + ','.join(f'{day}:{counts.get(day, 0)}' for day in [(start + dt.timedelta(days=i)).isoformat() for i in range(14)]))
PY

echo '=== Candidate passed; switching only the main workbench container ==='
sudo docker tag "$image_name:latest" "$rollback_image"
sudo docker rm -f "$backup_name" >/dev/null 2>&1 || true
sudo docker stop "$container_name" >/dev/null
sudo docker rename "$container_name" "$backup_name"

rollback() {
  echo 'Production verification failed; restoring the previous main container.' >&2
  sudo docker rm -f "$container_name" >/dev/null 2>&1 || true
  sudo docker rename "$backup_name" "$container_name" >/dev/null 2>&1 || true
  sudo docker start "$container_name" >/dev/null 2>&1 || true
  sudo docker tag "$rollback_image" "$image_name:latest" >/dev/null 2>&1 || true
}
trap 'rollback; cleanup' ERR

sudo docker run -d --name "$container_name" --restart unless-stopped \
  --env-file "$runtime_root/.env" \
  --env-file "$runtime_root/.env.coco" \
  --env-file "$runtime_root/.env.minimax" \
  -v "$runtime_root/data:/app/data" \
  -p 127.0.0.1:24500:3000 \
  "$candidate_image" >/dev/null

for attempt in $(seq 1 40); do
  if curl -fsS 'http://127.0.0.1:24500/healthz' >/dev/null; then break; fi
  test "$attempt" -lt 40 || exit 1
  sleep 2
done
production_html="$stage/production-recruitment.html"
curl -fsS 'http://127.0.0.1:24500/fd-027340/live-center-workbench/modules/recruitment/recruitment-dashboard.html' > "$production_html"
grep -Fq 'function resumeSubmissionName(text)' "$production_html"
grep -Fq 'liveResumeCounts===null' "$production_html"
sudo docker tag "$candidate_image" "$image_name:latest"
sudo docker rm -f "$backup_name" >/dev/null
trap cleanup EXIT HUP INT TERM

public_status="$(curl -sS -o /dev/null -w '%{http_code}' 'https://app.fandow.top/fd-027340/live-center-workbench/#lifecycle' || true)"
echo "PUBLIC_STATUS=$public_status"
echo 'RECRUITMENT_RESUME_TREND_DEPLOYMENT=passed'
