#!/usr/bin/env bash
set -euo pipefail
candidate_suffix="${1:?verified main/data candidate suffix required}"
release="sep3-$(TZ=Asia/Shanghai date +%Y%m%d%H%M%S)"
root=/home/fandow-deploy/fandow-apps/runtime/fd-027340
names=(fd-027340-live-center-workbench fd-027340-data-center fd-027340-dispatch-center)
candidates=("${names[0]}-v3-candidate-$candidate_suffix" "${names[1]}-v3-candidate-$candidate_suffix" "${names[2]}-candidate")
ports=(24500 24600 24601)
auth_paths=(material-assets dashboard planning)
old_ids=(); new_ids=(); stable_tags=()
backup="$root/releases/$release"
mkdir -p "$backup"
chmod 700 "$backup"
for i in 0 1 2; do
  test "$(docker inspect -f '{{.State.Health.Status}}' "${candidates[i]}")" = healthy
  old_ids+=("$(docker inspect -f '{{.Image}}' "${names[i]}")")
  new_ids+=("$(docker inspect -f '{{.Image}}' "${candidates[i]}")")
  stable_tags+=("$(docker inspect -f '{{.Config.Image}}' "${names[i]}")")
  if docker inspect "${names[i]}-backup-$release" >/dev/null 2>&1; then exit 2; fi
  docker tag "${old_ids[i]}" "${names[i]}:rollback-$release"
  printf '%s before=%s approved=%s\n' "${names[i]}" "${old_ids[i]}" "${new_ids[i]}" >> "$backup/images.txt"
done
sudo -n cp -a /etc/nginx/lightdeploy-locations/fd-027340-live-center-workbench.conf "$backup/main-nginx.conf"
sudo -n cp -a /etc/nginx/lightdeploy-locations/fd-027340-data-center.conf "$backup/data-nginx.conf"
rollback(){
  trap - ERR
  sudo -n tee /etc/nginx/lightdeploy-locations/fd-027340-live-center-workbench.conf < "$backup/main-nginx.conf" >/dev/null
  sudo -n tee /etc/nginx/lightdeploy-locations/fd-027340-data-center.conf < "$backup/data-nginx.conf" >/dev/null
  sudo -n nginx -t && sudo -n /bin/systemctl reload nginx
  for i in 2 1 0; do
    if docker inspect "${names[i]}-backup-$release" >/dev/null 2>&1; then
      docker rm -f "${names[i]}" >/dev/null 2>&1 || true
      docker rename "${names[i]}-backup-$release" "${names[i]}"
      docker start "${names[i]}" >/dev/null
    fi
    docker tag "${old_ids[i]}" "${names[i]}:latest" || true
    if [[ "${stable_tags[i]}" != sha256:* ]]; then docker tag "${old_ids[i]}" "${stable_tags[i]}" || true; fi
  done
  echo "ROLLED_BACK; backup=$backup" >&2
}
trap rollback ERR
incoming=/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized
sudo -n tee /etc/nginx/lightdeploy-locations/fd-027340-live-center-workbench.conf < "$incoming/production-live-center-workbench-sep3.conf" >/dev/null
sudo -n tee /etc/nginx/lightdeploy-locations/fd-027340-data-center.conf < "$incoming/production-data-center-sep3.conf" >/dev/null
sudo -n nginx -t
sudo -n /bin/systemctl reload nginx
for i in 0 1 2; do
  docker stop "${names[i]}" >/dev/null
  docker rename "${names[i]}" "${names[i]}-backup-$release"
done
sudo -n cp -a "$root/live-center-workbench/data" "$backup/main-data"
sudo -n cp -a "$root/dispatch-center/data" "$backup/dispatch-data"
authority=https://app.fandow.top/fd-026222/wis-central-auth/api
fallback=https://app.fandow.top/fd-026222/wis-video-center/api
docker run -d --name "${names[0]}" --restart unless-stopped \
 --env-file "$root/live-center-workbench/.env" --env-file "$root/live-center-workbench/.env.coco" --env-file "$root/live-center-workbench/.env.minimax" --env-file "$root/live-center-workbench/.env.jump" \
 -e CENTRAL_AUTHORITY_BASE="$authority" -e CENTRAL_AUTHORITY_FALLBACK_BASE="$fallback" \
 -v "$root/live-center-workbench/data:/app/data" -p 127.0.0.1:24500:3000 "${new_ids[0]}" >/dev/null
docker run -d --name "${names[1]}" --restart unless-stopped --env-file "$root/data-center/.env" \
 -e CENTRAL_AUTHORITY_BASE="$authority" -e CENTRAL_AUTHORITY_FALLBACK_BASE="$fallback" -p 127.0.0.1:24600:3000 "${new_ids[1]}" >/dev/null
docker run -d --name "${names[2]}" --restart unless-stopped --env-file "$root/dispatch-center/.env" \
 -e CENTRAL_AUTHORITY_BASE="$authority" -v "$root/dispatch-center/data:/app/data" -p 127.0.0.1:24601:3000 "${new_ids[2]}" >/dev/null
for attempt in $(seq 1 30); do
  ready=true
  for name in "${names[@]}"; do
    if test "$(docker inspect -f '{{.State.Health.Status}}' "$name")" != healthy; then ready=false; fi
  done
  if $ready; then break; fi
  test "$attempt" -lt 30
  sleep 2
done
for i in 0 1 2; do
  test "$(docker inspect -f '{{.Image}}' "${names[i]}")" = "${new_ids[i]}"
  test "$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 198.51.100.12' "http://127.0.0.1:${ports[i]}/api/${auth_paths[i]}")" = 401
done
curl -fsS --max-time 120 'http://127.0.0.1:24500/api/material-cards' > "$backup/cards-readback.json"
curl -fsS --max-time 120 'http://127.0.0.1:24601/api/planning' > "$backup/planning-readback.json"
data_ready=false
for attempt in 1 2 3; do
  http=$(curl -sS --max-time 120 -o "$backup/dashboard-readback-$attempt.json" -w '%{http_code}' 'http://127.0.0.1:24600/api/dashboard?date=2026-09-04') || http=000
  if python3 - "$backup/dashboard-readback-$attempt.json" "$http" <<'PY'
import json,sys
try:
 d=json.load(open(sys.argv[1]));ok=sys.argv[2]=='200' and not d.get('sourceErrors') and len({x['shop'] for x in d.get('sessions',[])})==4
 print('DATA_READBACK http='+sys.argv[2]+' complete='+str(ok)+' source_errors='+str(list(d.get('sourceErrors',{}))))
except Exception:
 ok=False;print('DATA_READBACK http='+sys.argv[2]+' unreadable_response=true')
sys.exit(0 if ok else 1)
PY
  then
    cp "$backup/dashboard-readback-$attempt.json" "$backup/dashboard-readback.json"
    data_ready=true
    break
  fi
  sleep 2
done
$data_ready
python3 - "$backup" <<'PY'
import json,sys,pathlib
p=pathlib.Path(sys.argv[1])
c=json.load(open(p/'cards-readback.json'));d=json.load(open(p/'dashboard-readback.json'));s=json.load(open(p/'planning-readback.json'))
assert c.get('ok') and s.get('ok')
assert not d.get('sourceErrors'), d.get('sourceErrors')
assert len({x['shop'] for x in d.get('sessions',[])})==4
assert not any('候选测试' in x.get('title','') for x in c.get('cards',[]))
print('PRODUCTION_READBACK=passed; candidate_fixtures_absent=true; data_mcp_errors=0')
PY
for i in 0 1 2; do
 docker tag "${new_ids[i]}" "${names[i]}:latest"
 docker tag "${new_ids[i]}" "${names[i]}:$release"
 if [[ "${stable_tags[i]}" != sha256:* ]]; then docker tag "${new_ids[i]}" "${stable_tags[i]}"; fi
done
trap - ERR
echo "VERIFIED_IMAGES_PROMOTED; backup=$backup; rollback_containers_retained=true"
