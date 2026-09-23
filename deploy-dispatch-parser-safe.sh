#!/usr/bin/env bash
set -euo pipefail

archive="${1:?dispatch archive is required}"
target_date="${2:-$(TZ=Asia/Shanghai date +%F)}"
target_month="${target_date:0:7}"
verify_writeback="${3:-0}"
# Default the import preview to the effective schedule date.  A future month can
# still be supplied explicitly as argument 4 once its columns exist in the
# authorized total schedule.
planning_date="${4:-${target_date}}"
deploy_mode="${5:-production}"
base="/home/fandow-deploy/fandow-apps/runtime/fd-027340"
runtime_dir="$base/dispatch-center"
data_dir="$runtime_dir/data"
env_file="$runtime_dir/.env"
production="fd-027340-dispatch-center"
candidate="${production}-candidate"
backup="${production}-rollback"
candidate_image="${production}:candidate"
latest_image="${production}:latest"
builder="${production}-overlay-builder"
candidate_port="24611"
production_port="24601"
central_authority_base="https://app.fandow.top/fd-026222/wis-central-auth/api"
release="$(TZ=Asia/Shanghai date +%Y%m%d%H%M%S)"
stage="$(mktemp -d /tmp/fd-027340-dispatch-candidate.XXXXXX)"

cleanup() {
  docker rm -f "$candidate" "$builder" >/dev/null 2>&1 || true
  rm -rf "$stage"
}
trap cleanup EXIT HUP INT TERM

test -s "$archive"
test -s "$env_file"
base_image="$(docker inspect -f '{{.Image}}' "$production")"
docker image inspect "$base_image" >/dev/null
mkdir -p "$data_dir"
docker run --rm --user root --entrypoint sh -v "$data_dir:/app/data" "$base_image" -c 'chown -R 10001:10001 /app/data && chmod 0755 /app/data && find /app/data -type f -exec chmod 0640 {} +'
data_backup_dir="$runtime_dir/backups/$release"
mkdir -p "$data_backup_dir"
docker run --rm --user root --entrypoint sh -v "$data_dir:/source:ro" -v "$data_backup_dir:/backup" "$base_image" -c 'cp -a /source/. /backup/'
docker run --rm --user root --entrypoint sh -v "$data_backup_dir:/backup" "$base_image" -c 'find /backup -maxdepth 1 -type f ! -name SHA256SUMS -exec sha256sum {} + > /backup/SHA256SUMS && chmod 0640 /backup/SHA256SUMS'
echo "DISPATCH_DATA_BACKUP=passed path=$data_backup_dir"
tar -xzf "$archive" -C "$stage"
test -f "$stage/dispatch-center/Dockerfile"
test -f "$stage/dispatch-center/schedule-api-server.js"
test -f "$stage/dispatch-center/planning-engine.js"
test -f "$stage/dispatch-center/index.html"
test -f "$stage/dispatch-center/app.js"
test -f "$stage/dispatch-center/planning-workbench.css"
test -f "$stage/dispatch-center/planning-workbench-20260829.css"
test -f "$stage/dispatch-center/planning-workbench.js"
test -f "$stage/dispatch-center/planning-room-labels.css"
test -f "$stage/dispatch-center/live-status-shared.css"
python3 - "$stage/dispatch-center/index.html" "$stage/dispatch-center/app.js" "$stage/dispatch-center/planning-workbench.js" <<'PY'
import sys
html=open(sys.argv[1],encoding='utf-8').read()
app=open(sys.argv[2],encoding='utf-8').read()
planning=open(sys.argv[3],encoding='utf-8').read()
assert '<body class="module-view" data-dispatch-page="current">' in html
assert '<aside class="sidebar"' not in html, 'dispatch module still owns a duplicate navigation sidebar'
assert all(label not in html for label in ('总览','数据中心','档案中心','素材中心'))
assert 'window.location.replace' not in app
assert all(label in html for label in ('当前排班','排班工作台'))
assert all(token in app for token in ('setDispatchView','history.replaceState'))
assert all(label in html for label in ('月度排班工作台','主播预排','助理预排','主播休息统计与连播预警','全员固定月应休','保存月应休','筛选主播'))
assert 'Eui1waw7FiNSGdkQU0jcov2HnPe' in html
assert html.count('data-planning-role="assistant"') == 4
assert all(name not in html for name in ('肖慧萍','邓艳佳','曾恩彤')), 'old makeup roster must not be rendered'
assert "$('#restMonth').value = currentScheduleDate().slice(0, 7)" in planning, 'rest board month must follow the viewed schedule date'
assert all(asset in html for asset in ('planning-workbench.css','planning-workbench-20260829.css','planning-workbench.js','planning-room-labels.css'))
assert "fetch('/" not in planning.lower() and 'fetch("/' not in planning.lower(), 'planning script conflicts with the nginx fetch-prefix sub_filter'
print('CANDIDATE_SINGLE_LEVEL_SHELL=passed')
print('CANDIDATE_PLANNING_UI=passed')
PY

docker rm -f "$builder" >/dev/null 2>&1 || true
docker create --name "$builder" --user root --entrypoint /bin/sh "$base_image" -c 'sleep 600' >/dev/null
docker start "$builder" >/dev/null
docker cp "$stage/dispatch-center/." "$builder:/app/"
docker commit --change 'USER app' --change 'ENTRYPOINT ["docker-entrypoint.sh"]' --change 'CMD ["node","schedule-api-server.js"]' \
  "$builder" "$candidate_image" >/dev/null
docker rm -f "$builder" >/dev/null
docker rm -f "$candidate" >/dev/null 2>&1 || true
candidate_data="$runtime_dir/candidate-data-$(date +%Y%m%d%H%M%S)"
mkdir -p "$candidate_data"
docker run --rm --user root --entrypoint sh -v "$data_dir:/source:ro" -v "$candidate_data:/target" "$base_image" -c 'cp -a /source/. /target/ && chown -R 10001:10001 /target && chmod 0755 /target && find /target -type f -exec chmod 0640 {} +'
docker run -d --name "$candidate" --env-file "$env_file" -e CENTRAL_AUTHORITY_BASE="$central_authority_base" -v "$candidate_data:/app/data" -p "127.0.0.1:${candidate_port}:3000" "$candidate_image" >/dev/null
test "$(docker inspect "$candidate" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CENTRAL_AUTHORITY_BASE=//p')" = "$central_authority_base"

for attempt in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${candidate_port}/api/health" | grep -q '"ok":true'; then break; fi
  test "$attempt" -lt 15 || { docker logs --tail=120 "$candidate" >&2; exit 1; }
  sleep 2
done

unauthorized_json="$stage/unauthorized-session.json"
unauthorized_status="$(curl -sS -o "$unauthorized_json" -w '%{http_code}' -H 'X-Forwarded-For: 203.0.113.8' \
  "http://127.0.0.1:${candidate_port}/api/session")"
test "$unauthorized_status" = 401
python3 - "$unauthorized_json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
assert d.get('error'), d
print('CANDIDATE_CENTRAL_AUTH_BOUNDARY=passed')
PY
unauthorized_page_status="$(curl -sS -o "$stage/unauthorized-page.html" -w '%{http_code}' -H 'X-Forwarded-For: 203.0.113.8' \
  "http://127.0.0.1:${candidate_port}/")"
test "$unauthorized_page_status" = 401
grep -q 'WIS 品牌营销中枢' "$stage/unauthorized-page.html"

candidate_json="$stage/candidate-schedule.json"
if ! curl -fsS "http://127.0.0.1:${candidate_port}/api/schedule?date=${target_date}&refresh=1" -o "$candidate_json"; then
  docker logs --tail=160 "$candidate" >&2 || true
  exit 1
fi
python3 - "$candidate_json" "$target_date" <<'PY'
import json,sys
path,target=sys.argv[1:]
d=json.load(open(path,encoding='utf-8'))
rooms=d.get('rooms') or []
assert d.get('date') == target, (d.get('date'),target)
assert [r.get('code') for r in rooms] == ['guanqi','brand_selection','youxuan','wangou']
for room in rooms:
    assert room.get('anchors'), f"{room.get('name')} anchors empty"
    assert room.get('assistants'), f"{room.get('name')} assistants empty"
status=d.get('sourceStatus') or {}
for code in ('guanqi','brand_selection','youxuan','wangou'):
    source=status.get(code) or {}
    assert source.get('found') is True, f"{code} source block missing"
    assert isinstance(source.get('firstRow'),int) and source['firstRow'] > 1
print('CANDIDATE_SCHEDULE=passed')
print('SOURCE_ROWS=' + ','.join(f"{code}:{status[code]['firstRow']}" for code in ('guanqi','brand_selection','youxuan','wangou')))
PY

planning_json="$stage/candidate-planning.json"
curl -fsS "http://127.0.0.1:${candidate_port}/api/planning" -o "$planning_json"
python3 - "$planning_json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
rooms=d.get('rooms') or {}
assert d.get('ok') and list(rooms)==['guanqi','brand_selection','youxuan','wangou'], d
assert (rooms.get('guanqi') or {}).get('assistants') == ['尹珩瑞','杨冰','陈嘉欣','蒙万叶','韦彩云','林梓烁','雷惠朝'], rooms
assert all(set((rooms.get(key) or {}).get('assistantShifts') or []) == {'L','A','X','Z','I','J','P','WB','M','ZBB'} for key in rooms), rooms
total=d.get('totalSchedule') or {}
assert total.get('wikiToken') == 'Eui1waw7FiNSGdkQU0jcov2HnPe', total
assert total.get('label') == '品牌营销部-直播中心排班表_20260901_20260930 （coco）', total
assert total.get('permissionStatus') in ('已连接','待授权','待回传'), total
if total.get('permissionStatus') == '已连接':
    assert total.get('spreadsheetToken') and total.get('sheetId'), total
else:
    assert total.get('reason'), total
print(f"CANDIDATE_PLANNING_API=passed rooms=4 independent_assistant_rosters=true shifts=10 source={total.get('permissionStatus')}")
PY

rest_json="$stage/candidate-rest.json"
# The rest board verifies the currently effective attendance month.  The
# planning draft below intentionally targets next month, but reusing that month
# here fails on the first day of a month before next month's roster is imported.
curl -fsS "http://127.0.0.1:${candidate_port}/api/planning/rest?month=${target_month}" -o "$rest_json"
python3 - "$rest_json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
data=d.get('data') or {}
source=data.get('source') or {}
assert d.get('ok') and isinstance(data.get('available'),bool), d
assert source.get('permissionStatus') in ('已读取','待授权','待回传'), source
if data.get('available'):
    assert source.get('spreadsheetToken') and source.get('sheetId') and data.get('people'), data
    assert all(all(day.get('status') in ('work','rest','unassigned') for day in (person.get('calendar') or [])) for person in data['people']), data
else:
    assert data.get('reason') and source.get('permissionStatus') in ('待授权','待回传'), data
print(f"CANDIDATE_REST_BOARD=passed available={str(data['available']).lower()} people={len(data.get('people') or [])} source={source.get('permissionStatus')}")
PY

# Generate an isolated one-day assistant draft, then preview the exact Feishu
# total-table ranges. Preview is read-only: it verifies mapping/access without
# importing or overwriting any schedule cells.
planning_generate_request="$stage/planning-generate-request.json"
python3 - "$planning_date" "$planning_generate_request" <<'PY'
import json,sys
date,path=sys.argv[1:]
json.dump({'roomCode':'guanqi','role':'assistant','startDate':date,'endDate':date},open(path,'w',encoding='utf-8'),ensure_ascii=False)
PY
planning_generate_response="$stage/planning-generate-response.json"
curl --fail-with-body -sS -H 'Content-Type: application/json' --data-binary "@$planning_generate_request" \
  "http://127.0.0.1:${candidate_port}/api/planning/generate" -o "$planning_generate_response"
planning_preview_request="$stage/planning-preview-request.json"
python3 - "$planning_generate_response" "$planning_preview_request" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
assert d.get('ok') and (d.get('draft') or {}).get('assignments'), d
json.dump({'draft':d['draft']},open(sys.argv[2],'w',encoding='utf-8'),ensure_ascii=False)
PY
planning_preview_response="$stage/planning-preview-response.json"
planning_permission="$(python3 - "$planning_json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
print((d.get('totalSchedule') or {}).get('permissionStatus') or '')
PY
)"
if test "$planning_permission" = '已连接'; then
  curl --fail-with-body -sS -H 'Content-Type: application/json' --data-binary "@$planning_preview_request" \
    "http://127.0.0.1:${candidate_port}/api/planning/import/preview" -o "$planning_preview_response"
  python3 - "$planning_preview_response" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
plan=d.get('plan') or {}
assert d.get('ok') and plan.get('assignmentCount',0) > 0, d
assert plan.get('expectedHash') and plan.get('ranges'), plan
print(f"CANDIDATE_PLANNING_TOTAL_PREVIEW=passed assignments={plan['assignmentCount']} ranges={len(plan['ranges'])} write=none")
PY
else
  echo "CANDIDATE_PLANNING_TOTAL_PREVIEW=skipped source=$planning_permission write=none"
fi

makeup_json="$stage/candidate-makeup.json"
makeup_status="$(curl -sS -o "$makeup_json" -w '%{http_code}' "http://127.0.0.1:${candidate_port}/api/planning/makeup?date=${target_date}")"
if test "$makeup_status" != "200"; then
  echo "CANDIDATE_MAKEUP_HTTP=failed status=$makeup_status" >&2
  cat "$makeup_json" >&2 || true
  echo >&2
  docker logs --tail=120 "$candidate" >&2 || true
  exit 1
fi
python3 - "$makeup_json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
data=d.get('data') or {}
assert d.get('ok') and isinstance(data.get('available'),bool), d
source=data.get('source') or {}
assert source.get('wikiToken') == 'QrjQwGyHoi6kZYkuKYCczBGYnoc', source
assert source.get('permissionStatus') in ('待授权','已读取','已读取 · 日期未覆盖','待回传'), source
if not data.get('available'):
    assert data.get('reason'), data
assert all(person.get('name') for person in (data.get('people') or [])), data
print(f"CANDIDATE_MAKEUP_SOURCE=passed available={str(data['available']).lower()} roster={len(data.get('roster') or [])} people={len(data.get('people') or [])}")
PY

makeup_available="$(python3 - "$makeup_json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
print('true' if (d.get('data') or {}).get('available') else 'false')
PY
)"
if test "$makeup_available" = "true"; then
makeup_generate_response="$stage/candidate-makeup-generate.json"
makeup_generate_request="$stage/candidate-makeup-generate-request.json"
python3 - "$makeup_json" "$target_month" "$makeup_generate_request" <<'PY'
import json,sys
source,month,target=sys.argv[1:]
d=json.load(open(source,encoding='utf-8')); names=(d.get('data') or {}).get('roster') or []
assert 2 <= len(names) <= 6, d
json.dump({'month':month,'roster':[{'name':name,'restDates':[]} for name in names]},open(target,'w',encoding='utf-8'),ensure_ascii=False)
PY
curl --fail-with-body -sS -H 'Content-Type: application/json' --data-binary "@$makeup_generate_request" \
  "http://127.0.0.1:${candidate_port}/api/planning/makeup/generate" -o "$makeup_generate_response"
makeup_preview_request="$stage/candidate-makeup-preview-request.json"
python3 - "$makeup_generate_response" "$makeup_preview_request" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
assert d.get('ok') and (d.get('draft') or {}).get('assignments'), d
json.dump({'draft':d['draft']},open(sys.argv[2],'w',encoding='utf-8'),ensure_ascii=False)
PY
makeup_preview_response="$stage/candidate-makeup-preview.json"
curl --fail-with-body -sS -H 'Content-Type: application/json' --data-binary "@$makeup_preview_request" \
  "http://127.0.0.1:${candidate_port}/api/planning/makeup/import/preview" -o "$makeup_preview_response"
python3 - "$makeup_preview_response" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8')); plan=d.get('plan') or {}; target=plan.get('target') or {}
assert d.get('ok') and plan.get('expectedHash') and plan.get('ranges') and not plan.get('unresolved'), d
assert target.get('spreadsheetToken') and target.get('sheetId') == '33648c', target
print(f"CANDIDATE_MAKEUP_IMPORT_PREVIEW=passed mode={plan.get('mode')} ranges={len(plan['ranges'])} write=none")
PY
else
  echo 'CANDIDATE_MAKEUP_IMPORT_PREVIEW=skipped source=待回传 write=none'
fi

# 用现有排班内容执行一次“同值写回”，验证飞书写权限、并发指纹、
# 写后回读和审计落盘；不改变任何可见排班姓名。
if test "$verify_writeback" = "1"; then
preview_request="$stage/writeback-preview-request.json"
python3 - "$candidate_json" "$preview_request" <<'PY'
import json,sys
source,target=sys.argv[1:]
d=json.load(open(source,encoding='utf-8'))
for room in d.get('rooms') or []:
    anchors=room.get('anchors') or []
    if anchors:
        shift=anchors[0]
        json.dump({
            'date':d['date'],'roomCode':room['code'],'role':'anchor',
            'name':shift[2],'start':shift[0],'end':shift[1]
        },open(target,'w',encoding='utf-8'),ensure_ascii=False)
        break
else:
    raise AssertionError('no existing anchor shift for write verification')
PY
preview_response="$stage/writeback-preview-response.json"
if ! curl --fail-with-body -sS -H 'Content-Type: application/json' --data-binary "@$preview_request" \
  "http://127.0.0.1:${candidate_port}/api/schedule/writeback/preview" -o "$preview_response"; then
  cat "$preview_response" >&2 || true
  docker logs --tail=160 "$candidate" >&2 || true
  exit 1
fi
commit_request="$stage/writeback-commit-request.json"
python3 - "$preview_request" "$preview_response" "$commit_request" <<'PY'
import json,sys
request=json.load(open(sys.argv[1],encoding='utf-8'))
preview=json.load(open(sys.argv[2],encoding='utf-8'))
assert preview.get('ok') is True
plan=preview.get('plan') or {}
request.update({'confirm':True,'expectedHash':plan['expectedHash'],'verifyWrite':True})
json.dump(request,open(sys.argv[3],'w',encoding='utf-8'),ensure_ascii=False)
PY
commit_response="$stage/writeback-commit-response.json"
if ! curl --fail-with-body -sS -H 'Content-Type: application/json' --data-binary "@$commit_request" \
  "http://127.0.0.1:${candidate_port}/api/schedule/writeback" -o "$commit_response"; then
  cat "$commit_response" >&2 || true
  docker logs --tail=160 "$candidate" >&2 || true
  exit 1
fi
python3 - "$commit_response" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
assert d.get('ok') is True
assert d.get('readbackVerified') is True
assert d.get('auditId')
print('CANDIDATE_WRITEBACK=passed')
PY
else
  echo 'CANDIDATE_WRITEBACK=skipped_existing_verified_release'
fi

if test "$deploy_mode" = 'candidate-only'; then
  trap - EXIT HUP INT TERM
  echo 'DISPATCH_CANDIDATE_ONLY=passed production_unchanged=true'
  exit 0
fi

# Keep the last working container intact until the candidate has passed all
# live source checks. The public port is switched only after this point.
docker rm -f "$backup" >/dev/null 2>&1 || true
docker stop "$production" >/dev/null
docker rename "$production" "$backup"
docker rm -f "$candidate" >/dev/null

rollback() {
  docker rm -f "$production" >/dev/null 2>&1 || true
  docker rename "$backup" "$production" >/dev/null 2>&1 || true
  docker start "$production" >/dev/null 2>&1 || true
}
trap 'rollback; cleanup' ERR

docker run -d --name "$production" --restart unless-stopped --env-file "$env_file" -e CENTRAL_AUTHORITY_BASE="$central_authority_base" -v "$data_dir:/app/data" -p "127.0.0.1:${production_port}:3000" "$candidate_image" >/dev/null
for attempt in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${production_port}/api/health" | grep -q '"ok":true'; then break; fi
  test "$attempt" -lt 15 || { docker logs --tail=120 "$production" >&2; exit 1; }
  sleep 2
done

production_json="$stage/production-schedule.json"
curl -fsS "http://127.0.0.1:${production_port}/api/schedule?date=${target_date}&refresh=1" -o "$production_json"
python3 - "$production_json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
rooms=d.get('rooms') or []
assert len(rooms)==4
assert all(r.get('anchors') and r.get('assistants') for r in rooms)
print('PRODUCTION_SCHEDULE=passed')
print('ROOM_COUNTS=' + ','.join(f"{r['name']}:{len(r['anchors'])}/{len(r['assistants'])}" for r in rooms))
PY

fetch_production_json() {
  local label="$1" url="$2" output="$3"
  for attempt in 1 2 3; do
    if curl -fsS --max-time 90 "$url" -o "$output"; then
      echo "$label=http_passed attempt=$attempt"
      return 0
    fi
    sleep 2
  done
  echo "$label=failed" >&2
  docker logs --tail=160 "$production" >&2 || true
  return 1
}

production_planning="$stage/production-planning.json"
production_rest="$stage/production-rest.json"
production_makeup="$stage/production-makeup.json"
fetch_production_json 'PRODUCTION_PLANNING_HTTP' "http://127.0.0.1:${production_port}/api/planning" "$production_planning"
fetch_production_json 'PRODUCTION_REST_HTTP' "http://127.0.0.1:${production_port}/api/planning/rest?month=${target_month}" "$production_rest"
fetch_production_json 'PRODUCTION_MAKEUP_HTTP' "http://127.0.0.1:${production_port}/api/planning/makeup?date=${target_date}" "$production_makeup"
python3 - "$production_planning" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8')); x=d.get('totalSchedule') or {}
assert d.get('ok') and len(d.get('rooms') or {})==4 and x.get('wikiToken')=='Eui1waw7FiNSGdkQU0jcov2HnPe' and x.get('permissionStatus') in ('已连接','待授权','待回传'), d
PY
python3 - "$production_rest" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8')); x=d.get('data') or {}; s=x.get('source') or {}
assert d.get('ok') and isinstance(x.get('available'),bool) and s.get('permissionStatus') in ('已读取','待授权','待回传') and (x.get('available') or x.get('reason')), d
PY
python3 - "$production_makeup" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8')); x=d.get('data') or {}
assert d.get('ok') and isinstance(x.get('available'),bool) and (x.get('source') or {}).get('wikiToken')=='QrjQwGyHoi6kZYkuKYCczBGYnoc' and (x.get('available') or x.get('reason')), d
PY
echo 'PRODUCTION_PLANNING_REST_AND_MAKEUP=passed'

docker tag "$candidate_image" "$latest_image"
tar -xzf "$archive" -C "$base"
docker rm -f "$backup" >/dev/null
trap cleanup EXIT HUP INT TERM
echo 'DISPATCH_SAFE_DEPLOY=complete'
