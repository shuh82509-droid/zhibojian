#!/usr/bin/env bash
set -euo pipefail

archive="${1:?data-center archive is required}"
target_date="${2:-$(TZ=Asia/Shanghai date +%F)}"
base="/home/fandow-deploy/fandow-apps/runtime/fd-027340"
runtime_dir="$base/data-center"
env_file="$runtime_dir/.env"
production="fd-027340-data-center"
candidate="${production}-candidate"
backup="${production}-rollback"
candidate_image="${production}:candidate"
latest_image="${production}:latest"
candidate_port="24610"
production_port="24600"
stage="$(mktemp -d /tmp/fd-027340-data-candidate.XXXXXX)"

cleanup() {
  docker rm -f "$candidate" >/dev/null 2>&1 || true
  rm -rf "$stage"
}
trap cleanup EXIT HUP INT TERM

test -s "$archive"
test -s "$env_file"
tar -xzf "$archive" -C "$stage"
test -f "$stage/data-center/Dockerfile"
docker build -t "$candidate_image" "$stage/data-center"
docker rm -f "$candidate" >/dev/null 2>&1 || true
docker run -d --name "$candidate" --env-file "$env_file" -p "127.0.0.1:${candidate_port}:3000" "$candidate_image" >/dev/null

for attempt in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${candidate_port}/" >/dev/null; then break; fi
  test "$attempt" -lt 20 || { docker logs --tail=160 "$candidate" >&2; exit 1; }
  sleep 3
done

dashboard_json="$stage/dashboard.json"
overview_json="$stage/overview.json"
curl -fsS --max-time 300 "http://127.0.0.1:${candidate_port}/api/dashboard?date=${target_date}" -o "$dashboard_json"
curl -fsS --max-time 300 "http://127.0.0.1:${candidate_port}/api/business-overview?date=${target_date}&refresh=1" -o "$overview_json"
python3 - "$dashboard_json" "$overview_json" <<'PY'
import json,sys
dashboard=json.load(open(sys.argv[1],encoding='utf-8'))
overview=json.load(open(sys.argv[2],encoding='utf-8'))
sessions=dashboard.get('sessions') or []
expected={
  'WIS\u5b98\u65b9\u65d7\u8230\u5e97',
  'WIS\u5b98\u65b9\u65d7\u8230\u5e97\u7504\u9009',
  'WIS\u5b98\u65b9\u65d7\u8230\u5e97\u4f18\u9009',
  'WIS\u71d5\u7a9d\u9762\u819c\u62a4\u80a4\u5e97',
}
shops={x.get('shop') for x in sessions}
assert expected <= shops, f'missing dashboard shops: {expected-shops}'
targets=overview.get('targets') or []
assert len(targets)==4, f'target count={len(targets)}'
assert all(x.get('target') and x.get('daysFound',0)>0 for x in targets), targets
assert overview.get('calendar'), 'monthly planning document produced no dated calendar entries'
assert not overview.get('warnings'), overview.get('warnings')
print('DATA_CANDIDATE=passed')
print('SESSION_COUNTS=' + ','.join(f"{shop}:{sum(1 for x in sessions if x.get('shop')==shop)}" for shop in sorted(expected)))
print('TARGETS=' + ','.join(f"{x['room']}:{x['actual']:.0f}/{x['target']:.0f}" for x in targets))
print('CALENDAR_ITEMS=%s'%len(overview['calendar']))
PY

docker rm -f "$backup" >/dev/null 2>&1 || true
docker stop "$production" >/dev/null
docker rename "$production" "$backup"

rollback() {
  docker rm -f "$production" >/dev/null 2>&1 || true
  docker rename "$backup" "$production" >/dev/null 2>&1 || true
  docker start "$production" >/dev/null 2>&1 || true
}
trap 'rollback; cleanup' ERR
docker rm -f "$candidate" >/dev/null
docker run -d --name "$production" --restart unless-stopped --env-file "$env_file" -p "127.0.0.1:${production_port}:3000" "$candidate_image" >/dev/null

for attempt in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${production_port}/" >/dev/null; then break; fi
  test "$attempt" -lt 20 || { docker logs --tail=160 "$production" >&2; exit 1; }
  sleep 3
done
curl -fsS --max-time 300 "http://127.0.0.1:${production_port}/api/dashboard?date=${target_date}" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d.get("sessions") or [])>=4'
curl -fsS --max-time 300 "http://127.0.0.1:${production_port}/api/business-overview?date=${target_date}" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d.get("targets") or [])==4; assert d.get("calendar")'

docker tag "$candidate_image" "$latest_image"
tar -xzf "$archive" -C "$base"
docker rm -f "$backup" >/dev/null
trap cleanup EXIT HUP INT TERM
echo 'DATA_CENTER_SAFE_DEPLOY=complete'
