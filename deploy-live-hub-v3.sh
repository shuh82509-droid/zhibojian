#!/usr/bin/env bash
set -euo pipefail

archive="${1:?deployment archive is required}"
target_date="${2:-2026-08-18}"
deploy_mode="${3:-production}"
runtime_root="/home/fandow-deploy/fandow-apps/runtime/fd-027340"
main_runtime="$runtime_root/live-center-workbench"
data_runtime="$runtime_root/data-center"
main_name="fd-027340-live-center-workbench"
data_name="fd-027340-data-center"
# Use only the stable published authority route. Legacy container aliases point at
# a specific container and become stale whenever the authority is redeployed.
central_authority_base="https://app.fandow.top/fd-026222/wis-central-auth/api"
central_authority_fallback_base="https://app.fandow.top/fd-026222/wis-video-center/api"
release="$(TZ=Asia/Shanghai date +%Y%m%d%H%M%S)"
main_candidate_image="$main_name:v3-$release"
data_candidate_image="$data_name:v3-$release"
main_rollback_image="$main_name:rollback-$release"
data_rollback_image="$data_name:rollback-$release"
main_candidate="$main_name-v3-candidate-$release"
data_candidate="$data_name-v3-candidate-$release"
main_backup="$main_name-v3-backup"
data_backup="$data_name-v3-backup"
main_builder="$main_name-v3-overlay-builder-$release"
data_builder="$data_name-v3-overlay-builder-$release"
stage="$(mktemp -d /tmp/fd-027340-live-hub-v3.XXXXXX)"

cleanup_candidates() {
  docker rm -f "$main_candidate" "$data_candidate" "$main_builder" "$data_builder" >/dev/null 2>&1 || true
  rm -rf "$stage"
}
trap cleanup_candidates EXIT HUP INT TERM

test -s "$archive"
test -s "$main_runtime/.env"
test -s "$main_runtime/.env.coco"
test -s "$main_runtime/.env.minimax"
test -s "$main_runtime/.env.jump"
test -s "$data_runtime/.env"
tar -xzf "$archive" -C "$stage"
test -s "$stage/Dockerfile.live-hub-v3-main"
test -s "$stage/Dockerfile.live-hub-v3-data"
test -s "$stage/site/index.html"
test -s "$stage/exports/recruitment-pool/recruitment-dashboard.html"
test -s "$stage/exports/anchor-archives/recruitment-dashboard.html"
test -s "$stage/exports/anchor-archives/assets/anchor-avatar-sprite.png"
test -s "$stage/exports/anchor-archives/assets/anchor-development.css"
test -s "$stage/exports/anchor-archives/assets/anchor-development-20260829.css"
test -s "$stage/exports/anchor-archives/assets/anchor-development.js"
test -s "$stage/exports/material-center/material-center.html"
test -s "$stage/exports/material-center/embedded-shell.css"
test -s "$stage/exports/material-center/material-competitors.html"
test -s "$stage/exports/material-center/material-cue-cards.html"
test -s "$stage/exports/material-center/material-cue-cards-fixes.css"
test -s "$stage/exports/material-center/material-prohibited.html"
test -s "$stage/exports/material-center/material-scripts.html"
test -s "$stage/exports/material-center/communication-generator.html"
test -s "$stage/exports/material-center/communication-generator.css"
test -s "$stage/exports/material-center/communication-generator.js"
test -s "$stage/lifecycle-engine.mjs"
test -s "$stage/runtime/collaboration-center/dist/server/index.js"
test -s "$stage/runtime/data-center/dist/server/index.js"

echo '=== Building isolated overlay images without touching shared Docker cache ==='
main_base_image="$(docker inspect -f '{{.Image}}' "$main_name")"
data_base_image="$(docker inspect -f '{{.Image}}' "$data_name")"
main_persistent_image="$(docker inspect -f '{{.Config.Image}}' "$main_name")"
data_persistent_image="$(docker inspect -f '{{.Config.Image}}' "$data_name")"
docker image inspect "$main_base_image" >/dev/null
docker image inspect "$data_base_image" >/dev/null
docker rm -f "$main_builder" "$data_builder" >/dev/null 2>&1 || true
docker create --name "$main_builder" --user root --entrypoint /bin/sh "$main_base_image" -c 'sleep 600' >/dev/null
docker start "$main_builder" >/dev/null
docker exec "$main_builder" rm -rf /app/public/modules/recruitment /app/public/modules/anchors /app/public/modules/materials /app/collaboration/dist
docker cp "$stage/site/." "$main_builder:/app/public/"
docker cp "$stage/server.js" "$main_builder:/app/server.js"
docker cp "$stage/lifecycle-engine.mjs" "$main_builder:/app/lifecycle-engine.mjs"
docker cp "$stage/container-entrypoint.sh" "$main_builder:/app/container-entrypoint.sh"
docker cp "$stage/exports/recruitment-pool/." "$main_builder:/app/public/modules/recruitment/"
docker cp "$stage/exports/anchor-archives/." "$main_builder:/app/public/modules/anchors/"
docker cp "$stage/exports/material-center/." "$main_builder:/app/public/modules/materials/"
docker cp "$stage/runtime/collaboration-center/dist/." "$main_builder:/app/collaboration/dist/"
docker commit --change 'USER root' --change 'ENTRYPOINT ["docker-entrypoint.sh"]' \
  --change 'CMD ["sh","container-entrypoint.sh"]' "$main_builder" "$main_candidate_image" >/dev/null

docker create --name "$data_builder" --user root --entrypoint /bin/sh "$data_base_image" -c 'sleep 600' >/dev/null
docker start "$data_builder" >/dev/null
docker exec "$data_builder" rm -rf /app/dist
docker cp "$stage/runtime/data-center/dist/." "$data_builder:/app/dist/"
docker commit --change 'USER node' --change 'ENTRYPOINT ["docker-entrypoint.sh"]' \
  --change 'CMD ["npm","run","start","--","--hostname","0.0.0.0","--port","3000"]' "$data_builder" "$data_candidate_image" >/dev/null
docker rm -f "$main_builder" "$data_builder" >/dev/null

docker rm -f "$main_candidate" "$data_candidate" >/dev/null 2>&1 || true
main_candidate_ports=()
data_candidate_ports=()
if test "$deploy_mode" = 'candidate-only'; then
  main_candidate_ports=(-p 127.0.0.1:24510:3000)
  data_candidate_ports=(-p 127.0.0.1:24610:3000)
fi
candidate_data="$main_runtime/candidate-data-$release"
mkdir -p "$candidate_data"
docker run --rm --user root --entrypoint sh -v "$main_runtime/data:/source:ro" -v "$candidate_data:/target" "$main_base_image" -c 'cp -a /source/. /target/'
docker run -d --name "$main_candidate" "${main_candidate_ports[@]}" \
  --env-file "$main_runtime/.env" --env-file "$main_runtime/.env.coco" --env-file "$main_runtime/.env.minimax" --env-file "$main_runtime/.env.jump" \
  -e CENTRAL_AUTHORITY_BASE="$central_authority_base" -e CENTRAL_AUTHORITY_FALLBACK_BASE="$central_authority_fallback_base" -e LIFECYCLE_SCHEDULER_ENABLED=0 \
  -v "$candidate_data:/app/data" "$main_candidate_image" >/dev/null
docker run -d --name "$data_candidate" "${data_candidate_ports[@]}" \
  --env-file "$data_runtime/.env" -e CENTRAL_AUTHORITY_BASE="$central_authority_base" -e CENTRAL_AUTHORITY_FALLBACK_BASE="$central_authority_fallback_base" "$data_candidate_image" >/dev/null

wait_http() {
  local container="$1" url="$2" label="$3"
  for attempt in $(seq 1 40); do
    if docker exec "$container" wget -q -O /dev/null "$url" 2>/dev/null; then
      echo "$label=passed"
      return 0
    fi
    if test "$attempt" = 40; then
      echo "$label=failed" >&2
      docker logs --tail=180 "$container" >&2 || true
      return 1
    fi
    sleep 2
  done
}

wait_http "$main_candidate" 'http://127.0.0.1:3000/healthz' 'CANDIDATE_MAIN_HEALTH'
wait_http "$data_candidate" 'http://127.0.0.1:3000/' 'CANDIDATE_DATA_HEALTH'
test "$(docker inspect "$main_candidate" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CENTRAL_AUTHORITY_FALLBACK_BASE=//p')" = "$central_authority_fallback_base"
test "$(docker inspect "$data_candidate" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CENTRAL_AUTHORITY_FALLBACK_BASE=//p')" = "$central_authority_fallback_base"
test "$(docker inspect -f '{{json .HostConfig.Links}}' "$main_candidate")" = "null"
test "$(docker inspect -f '{{json .HostConfig.Links}}' "$data_candidate")" = "null"
echo 'CANDIDATE_CENTRAL_AUTH_NO_DOCKER_LINK=passed'

docker exec "$main_candidate" node -e '
fetch(process.argv[1],{headers:{"X-Forwarded-For":"203.0.113.8"},redirect:"manual"}).then(async response=>{
  const body=await response.text();
  if(response.status!==401 || !body.includes("error")) process.exitCode=22;
}).catch(()=>process.exitCode=23);
' 'http://127.0.0.1:3000/fd-027340/live-center-workbench/api/session'
echo 'CANDIDATE_MAIN_CENTRAL_AUTH_BOUNDARY=passed'
docker exec "$main_candidate" node -e '
fetch(process.argv[1]).then(async response=>{
  const body=await response.text();
  if(response.status!==502 || !body.includes("\"ok\":false")) process.exitCode=22;
}).catch(()=>process.exitCode=23);
' 'http://127.0.0.1:3000/fd-027340/live-center-workbench/api/feishu/resource?url=https%3A%2F%2Finternal-api-lark-file.feishu.cn%2Fdownload%2Fmessages%2Finvalid-regression%2Fkeys%2Finvalid-regression'
wait_http "$main_candidate" 'http://127.0.0.1:3000/healthz' 'CANDIDATE_MAIN_POST_FEISHU_ERROR_HEALTH'
echo 'CANDIDATE_FEISHU_RESOURCE_ERROR_BOUNDARY=passed'
docker exec "$data_candidate" node -e '
fetch(process.argv[1],{headers:{"X-Forwarded-For":"203.0.113.8"},redirect:"manual"}).then(async response=>{
  const body=await response.text();
  if(response.status!==401 || !body.includes("error")) process.exitCode=22;
}).catch(()=>process.exitCode=23);
' 'http://127.0.0.1:3000/api/session'
echo 'CANDIDATE_DATA_CENTRAL_AUTH_BOUNDARY=passed'
docker exec "$data_candidate" node -e '
fetch(process.argv[1],{headers:{"X-Forwarded-For":"203.0.113.8"},redirect:"manual"}).then(async response=>{
  const body=await response.text();
  if(response.status!==200 || !body.includes("WIS 品牌营销中枢")) process.exitCode=22;
}).catch(()=>process.exitCode=23);
' 'http://127.0.0.1:3000/'
echo 'CANDIDATE_DATA_PAGE_BOUNDARY=passed'

recruitment_html="$stage/recruitment.html"
anchor_html="$stage/anchors.html"
material_html="$stage/materials.html"
material_scripts_html="$stage/material-scripts.html"
communication_generator_html="$stage/communication-generator.html"
material_prohibited_html="$stage/material-prohibited.html"
material_cue_html="$stage/material-cue-cards.html"
home_html="$stage/home.html"
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/' > "$home_html"
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/modules/recruitment/recruitment-dashboard.html' > "$recruitment_html"
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/modules/anchors/recruitment-dashboard.html' > "$anchor_html"
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/modules/materials/material-center.html' > "$material_html"
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/modules/materials/material-scripts.html' > "$material_scripts_html"
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/modules/materials/communication-generator.html' > "$communication_generator_html"
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/modules/materials/material-prohibited.html' > "$material_prohibited_html"
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/modules/materials/material-cue-cards.html' > "$material_cue_html"
python3 - "$home_html" "$recruitment_html" "$anchor_html" "$material_html" "$material_scripts_html" "$communication_generator_html" "$material_prohibited_html" "$material_cue_html" <<'PY'
import sys
home=open(sys.argv[1],encoding='utf-8').read()
recruitment=open(sys.argv[2],encoding='utf-8').read()
anchors=open(sys.argv[3],encoding='utf-8').read()
materials=open(sys.argv[4],encoding='utf-8').read()
scripts=open(sys.argv[5],encoding='utf-8').read()
generator=open(sys.argv[6],encoding='utf-8').read()
prohibited=open(sys.argv[7],encoding='utf-8').read()
cue_cards=open(sys.argv[8],encoding='utf-8').read()
navigation=['WIS直播中心总览','各直播间数据','主播全生命周期管理','调度中心','协同中心','素材中心']
assert all(x in home for x in navigation), [x for x in navigation if x not in home]
assert [home.index(x) for x in navigation] == sorted(home.index(x) for x in navigation), 'main navigation order is incorrect'
assert home.count('<aside') == 1, 'complete platform must own exactly one global sidebar'
assert all(x in home for x in ('platformUserName','platformUserRole',"basePath+'api/session'")), 'central account is not rendered in the global sidebar'
assert all(x in home for x in ('?embed=1&v=20260907a','liveHubNavigationGuard','cleanEmbeddedNavigation(frame,key)','?view=overview','?view=data')), 'embedded navigation hardening is missing'
required_recruitment=['待入职人数','群内面试记录 · 正式日历待授权','招聘周期每日送审简历数量趋势','<video controls','funnelHired','funnelAssessment','每天 09:30、18:00','api/lifecycle/refresh?module=recruitment']
required_anchors=['REQUIRED_WEEKLY_REVIEWS=2','近 7 天上播数据趋势','trend-gmv','trend-conversion','主播当月 GMV 排名','rankStart','rankEnd','anchor-avatar-sprite.png','api/lifecycle/refresh?module=anchors','能力与新人池','主播周期评级与成长档案','在职周期评级','成长与新人池','anchor-development.css','anchor-development-20260829.css','anchor-development.js']
assert all(x in recruitment for x in required_recruitment), [x for x in required_recruitment if x not in recruitment]
assert recruitment.index('funnelHired') < recruitment.index('funnelAssessment')
assert all(x in anchors for x in required_anchors), [x for x in required_anchors if x not in anchors]
assert all(x in materials for x in ('竞对分析','直播手卡','违禁词资料','material-competitors.html','material-cue-cards.html','material-prohibited.html'))
assert all(x in prohibited for x in ('违禁词资料','prohibited-word',"kind:'prohibited'",'飞书 Wiki / 飞书 Docx'))
assert '违禁词资料库' not in cue_cards
assert 'live-hub-embedded' in anchors, 'anchor module does not own embedded layout'
assert all(x in materials for x in ('live-hub-embedded','embedded-shell.css?v=20260828d')), 'material module does not own embedded layout'
assert all(x in scripts for x in ('沟通稿自动生成器','两轮完整直播循环','各产品稿件归档','上传稿件','飞书 Wiki 或飞书 Docx','communication-generator.html?embed=1'))
assert 'communicationGeneratorDialog' not in scripts
assert all(x in generator for x in ('沟通稿自动生成器','完整两轮沟通稿','生成长稿并合规复核','communication-generator.js'))
print('CANDIDATE_MAIN_NAVIGATION=passed')
print('CANDIDATE_RECRUITMENT_UI=passed')
print('CANDIDATE_ANCHOR_UI=passed')
print('CANDIDATE_MATERIAL_UI=passed')
print('CANDIDATE_COMMUNICATION_GENERATOR_UI=passed')
PY

lifecycle_status="$stage/lifecycle-status.json"
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/api/lifecycle/status' > "$lifecycle_status"
python3 - "$lifecycle_status" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
assert d.get('ok') and d.get('refreshRule') == 'Asia/Shanghai 09:30,18:00 daily', d
assert d.get('schedulerEnabled') is False, d
assert set((d.get('modules') or {})) == {'recruitment','anchors'}, d
print('CANDIDATE_LIFECYCLE_API=passed scheduler=isolated')
PY
recruitment_cycle="$stage/recruitment-cycle.json"
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/api/lifecycle/recruitment-cycle?month=2026-09' > "$recruitment_cycle"
python3 - "$recruitment_cycle" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
data=d.get('data') or {}
coverage=data.get('coverage') or {}
assert d.get('ok') and data.get('status') in ('current','partial'), d
assert isinstance(data.get('dailyNames'), dict) and isinstance(data.get('interviewEvents'), dict), data
assert coverage.get('reactionStatus') == '已核验', coverage
assert coverage.get('chatMessages', 0) > 0, coverage
assert coverage.get('employmentStatus') in ('已读取','待授权'), coverage
print(f"CANDIDATE_RECRUITMENT_SOURCE=passed messages={coverage['chatMessages']} reactions={coverage['reactionStatus']} employment={coverage['employmentStatus']} candidates={len(data.get('candidates') or [])}")
PY
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/api/material-cards' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") and isinstance(d.get("cards"),list)'
echo 'CANDIDATE_MATERIAL_CARDS_API=passed'
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/api/material-assets' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") and isinstance(d.get("assets"),list)'
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/api/material-links' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") and isinstance(d.get("links"),list)'
echo 'CANDIDATE_MATERIAL_ARCHIVE_APIS=passed'

script_config="$stage/script-generator-config.json"
anchor_development="$stage/anchor-development.json"
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/api/script-generator/config' > "$script_config"
docker exec "$main_candidate" wget -q -O - 'http://127.0.0.1:3000/fd-027340/live-center-workbench/api/anchor-development' > "$anchor_development"
python3 - "$script_config" "$anchor_development" <<'PY'
import json,sys
script=json.load(open(sys.argv[1],encoding='utf-8'))
anchor=json.load(open(sys.argv[2],encoding='utf-8'))
assert script.get('ok') and script.get('configured') is True, script
assert script.get('productCatalogStatus') == '已连接', script
assert len(script.get('productCatalog') or []) >= 6 and len(script.get('stages') or []) == 7, script
assert len(script.get('personas') or []) >= 2 and len(script.get('broadcastModes') or []) == 2 and len(script.get('platforms') or []) >= 2, script
assert script.get('sourcePolicy') == 'feishu_verified_only', script
assert anchor.get('ok') and len(anchor.get('dimensions') or []) == 4, anchor
assert len(anchor.get('courses') or []) == 8 and len(anchor.get('accounts') or []) == 4, anchor
assert anchor.get('ratingScale') == {'values': ['A','B','C','D'], 'unit': '等级'}, anchor
assert anchor.get('growthScale') == {'min': 0, 'max': 100, 'unit': '分'}, anchor
assert anchor.get('ratingPolicy') == 'abcd_periodic_and_growth_score', anchor
print(f"CANDIDATE_SCRIPT_CONFIG=passed products={len(script['products'])} unique_catalog={len(script['productCatalog'])} stages={len(script['stages'])} policy={script['sourcePolicy']}")
print(f"CANDIDATE_ANCHOR_DEVELOPMENT_API=passed dimensions={len(anchor['dimensions'])} courses={len(anchor['courses'])} accounts={len(anchor['accounts'])}")
PY

# Generate one source-grounded candidate paragraph. This reads the authorized
# Feishu documents and invokes the configured model, but does not save a draft.
script_generation="$stage/script-generator-generation.json"
for attempt in $(seq 1 3); do
  if docker exec "$main_candidate" node -e '
const url=process.argv[1];
fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({product:"水润面膜",persona:"成分型",broadcastMode:"单播",platform:"抖音",mechanism:{price:"待核验",mainQuantity:"待核验",gifts:"待核验"},stages:["暖场与痛点","卖点与背书"],count:2,brief:"候选环境来源与模型连通性验收"}),signal:AbortSignal.timeout(600000)}).then(async response=>{
  const body=await response.text(); process.stdout.write(body); if(!response.ok){process.stderr.write(body);process.exitCode=22;}
}).catch(error=>{process.stderr.write(error.message);process.exitCode=23});
' 'http://127.0.0.1:3000/fd-027340/live-center-workbench/api/script-generator/generate' > "$script_generation"; then
    break
  fi
  echo "CANDIDATE_SCRIPT_MODEL_RETRY=attempt_$attempt" >&2
  test "$attempt" -lt 3 || exit 1
  sleep 5
done
python3 - "$script_generation" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
data=d.get('data') or {}
stages=data.get('stages') or {}
assert d.get('ok') and len(data.get('scripts') or []) == 2, d
assert len(stages.get('暖场与痛点') or []) == 2 and len(stages.get('卖点与背书') or []) == 2, data
assert all(item.get('fullScript') for item in data['scripts']), data
assert data.get('sources') and all('feishu.cn/' in str(x.get('sourceUrl') or '') for x in data['sources']), data
assert data.get('model') and data.get('generatedAt'), data
assert all(not (stages.get(name) or []) for name in ('机制与售后','第一轮逼单','第二轮承接','使用方法与换角度','循环收口')), stages
assert all(isinstance(item.get('compliance'), dict) for item in data['scripts']), data
print(f"CANDIDATE_SCRIPT_SOURCE_AND_MODEL=passed sources={len(data['sources'])} scripts={len(data['scripts'])} model={data['model']} saved=false")
PY

collaboration_json="$stage/collaboration.json"
for attempt in $(seq 1 30); do
  if docker exec "$main_candidate" node -e '
const url=process.argv[1];
fetch(url).then(async response=>{process.stdout.write(await response.text());if(!response.ok)process.exitCode=22}).catch(()=>process.exitCode=23);
' 'http://127.0.0.1:3000/fd-027340/live-center-workbench/modules/tasks/api/violations?refresh=1' > "$collaboration_json"; then
    break
  fi
  test "$attempt" -lt 30 || { docker logs --tail=180 "$main_candidate" >&2; exit 1; }
  sleep 2
done

dashboard_json="$stage/dashboard.json"
overview_json="$stage/overview.json"
anchor_json="$stage/anchor.json"
fetch_candidate_json() {
  local label="$1" url="$2" output="$3"
  for attempt in $(seq 1 8); do
    if docker exec "$data_candidate" node -e '
const [url]=process.argv.slice(1);
fetch(url,{signal:AbortSignal.timeout(600000)}).then(async response=>{
  const body=await response.text(); process.stdout.write(body);
  if(!response.ok) process.exitCode=22;
}).catch(error=>{process.stderr.write(error.message);process.exitCode=23});
' "$url" > "$output"; then
      echo "$label=http_passed attempt=$attempt"
      return 0
    fi
    if test "$attempt" -lt 8; then
      echo "$label=not_ready attempt=$attempt; retrying" >&2
      sleep 10
    fi
  done
  echo "$label=failed" >&2
  head -c 8000 "$output" >&2 || true
  echo >&2
  return 1
}
fetch_candidate_json 'CANDIDATE_DASHBOARD_HTTP' "http://127.0.0.1:3000/api/dashboard?date=$target_date" "$dashboard_json"
fetch_candidate_json 'CANDIDATE_BUSINESS_OVERVIEW_HTTP' "http://127.0.0.1:3000/api/business-overview?date=$target_date&refresh=1" "$overview_json"
fetch_candidate_json 'CANDIDATE_ANCHOR_TRENDS_HTTP' "http://127.0.0.1:3000/api/anchor-trends?date=$target_date&days=14&refresh=1" "$anchor_json"

python3 - "$collaboration_json" "$dashboard_json" "$overview_json" "$anchor_json" <<'PY'
import json,sys
collaboration=json.load(open(sys.argv[1],encoding='utf-8'))
dashboard=json.load(open(sys.argv[2],encoding='utf-8'))
overview=json.load(open(sys.argv[3],encoding='utf-8'))
anchor=json.load(open(sys.argv[4],encoding='utf-8'))
assert collaboration.get('ok') and collaboration.get('source') == 'feishu_chat', collaboration
assert 'oc_a1f32ee1874fa98271d3bb19522abbb8' in (collaboration.get('chatIds') or []), collaboration
violation_rows=collaboration.get('rows') or []
assert violation_rows, 'violation chat parsed zero strict violation records'
required_violation_fields={'id','roomId','time','detail','quote','product','room','host','occurredAt'}
assert all(required_violation_fields <= set(row) for row in violation_rows), 'violation records do not use the six-field evidence schema'
assert all(not ({'level','status','type','content'} & set(row)) for row in violation_rows), 'legacy risk/status/type fields are still exposed'
timestamps=[row.get('occurredAt') or '' for row in violation_rows]
assert timestamps == sorted(timestamps, reverse=True), 'violation records are not newest-first'
operations=('断播','重开','重新开播','掉线','黑屏','卡顿','拉流','推流','重启','恢复开播','开播报备','断流','无声','收播')
assert all(not (any(word in ' '.join(str(row.get(key) or '') for key in ('detail','quote')) for word in operations) and not any(word in str(row.get('detail') or '') for word in ('违规','处罚','判罚'))) for row in violation_rows), 'operation-only messages leaked into the violation ledger'
expected={'WIS官方旗舰店','WIS官方旗舰店甄选','WIS官方旗舰店优选','WIS燕窝面膜护肤店'}
sessions=dashboard.get('sessions') or []
shops={x.get('shop') for x in sessions}
assert expected <= shops, f'missing dashboard shops: {expected-shops}'
audience_status=(dashboard.get('audienceStatus') or {}).get('byShop') or {}
missing_audience={shop for shop in expected if not any(x.get('shop')==shop and (x.get('audience') or []) for x in sessions)}
assert set(audience_status) == expected, audience_status
assert all((audience_status.get(shop) or {}).get('reason') for shop in expected), audience_status
summary=(dashboard.get('agent') or {}).get('summary') or ''
assert 'MCP' not in summary, summary
if dashboard.get('sourceErrors'):
    assert any(marker in summary for marker in ('实时经营数据源授权已失效','实时经营数据源部分直播间未返回场次','公司数据服务暂时超时')), summary
    assert all('MCP' not in ((audience_status.get(shop) or {}).get('reason') or '') for shop in expected), audience_status
traffic=dashboard.get('traffic') or []
assert {x.get('label') for x in traffic} == {'自然推荐','付费推广','短视频引流','粉丝关注','同城','分享/私域','其他'}, traffic
assert all(x.get('paymentAmountShare') is not None or x.get('transactionStatus') == '待接入' for x in traffic), traffic
profiles=dashboard.get('audienceProfiles') or []
strategy={'小镇青年','都市银发','小镇中老年','都市蓝领','资深中产','新锐白领','精致妈妈','Z世代'}
for scope in ('FULL_SESSION_VIEWER','FULL_SESSION_BUYER'):
    rows=[x for x in profiles if x.get('scope') == scope]
    assert not rows or all({i.get('label') for i in (row.get('items') or [])} <= strategy for row in rows), rows
assert len(overview.get('reports') or []) == 2, overview.get('reports')
assert {x.get('kind') for x in overview['reports']} == {'早报文档','早报看板'}
assert len(overview.get('targets') or []) == 4, overview.get('targets')
assert all(isinstance(x.get('daily'),list) for x in overview.get('targets') or []), overview.get('targets')
target_rows={x.get('code'):x for x in overview.get('targets') or []}
for code in ('brand-selection','preferred'):
    row=target_rows.get(code) or {}
    assert row.get('actual') is not None and (row.get('daysFound') or 0) > 0, f'{code} target actual is still unavailable: {row}'
    assert row.get('basis') == 'cumulative_gmv', f'{code} basis is not explicit: {row}'
assert overview.get('calendar'), 'current-month calendar is empty'
assert overview.get('concerns'), 'current-month concerns are empty'
assert all('读取失败' not in warning for warning in (overview.get('warnings') or [])), overview.get('warnings')
assert anchor.get('ok'), anchor
series=(anchor.get('data') or {}).get('series') or {}
points=[point for values in series.values() for point in values]
assert points, 'anchor 14-day series is empty'
assert any(point.get('conversion') is not None for point in points), 'all anchor conversion points are empty'
print(f"CANDIDATE_COCO_VIOLATIONS=passed count={len(violation_rows)} schema=six_fields order=newest_first")
print('CANDIDATE_DATA_ROOMS=passed ' + ','.join(f"{shop}:{sum(1 for x in sessions if x.get('shop')==shop)}/{sum(len(x.get('audience') or []) for x in sessions if x.get('shop')==shop)}" for shop in sorted(expected)) + f" pending_audience={len(missing_audience)}")
print(f"CANDIDATE_BUSINESS_OVERVIEW=passed calendar={len(overview['calendar'])} concerns={len(overview['concerns'])} selected_days={target_rows['brand-selection']['daysFound']} preferred_days={target_rows['preferred']['daysFound']}")
print(f"CANDIDATE_ANCHOR_TRENDS=passed anchors={len(series)} points={len(points)} conversions={sum(1 for p in points if p.get('conversion') is not None)}")
PY

if test "$deploy_mode" = 'candidate-only'; then
  trap - EXIT HUP INT TERM
  rm -rf "$stage"
  echo 'LIVE_HUB_V3_CANDIDATE_ONLY=passed main_port=24510 data_port=24610 production_unchanged=true'
  exit 0
fi

echo '=== Candidate verification passed; switching both production containers ==='
docker tag "$main_base_image" "$main_rollback_image"
docker tag "$data_base_image" "$data_rollback_image"
docker rm -f "$main_backup" "$data_backup" >/dev/null 2>&1 || true
docker stop "$main_name" "$data_name" >/dev/null
docker rename "$main_name" "$main_backup"
docker rename "$data_name" "$data_backup"

rollback() {
  echo 'Production verification failed; rolling back both containers.' >&2
  docker rm -f "$main_name" "$data_name" >/dev/null 2>&1 || true
  docker rename "$main_backup" "$main_name" >/dev/null 2>&1 || true
  docker rename "$data_backup" "$data_name" >/dev/null 2>&1 || true
  docker start "$main_name" "$data_name" >/dev/null 2>&1 || true
  docker tag "$main_rollback_image" "$main_name:latest" >/dev/null 2>&1 || true
  docker tag "$data_rollback_image" "$data_name:latest" >/dev/null 2>&1 || true
}
trap 'rollback; cleanup_candidates' ERR

docker run -d --name "$main_name" --restart unless-stopped \
  --env-file "$main_runtime/.env" --env-file "$main_runtime/.env.coco" --env-file "$main_runtime/.env.minimax" --env-file "$main_runtime/.env.jump" \
  -e CENTRAL_AUTHORITY_BASE="$central_authority_base" -e CENTRAL_AUTHORITY_FALLBACK_BASE="$central_authority_fallback_base" \
  -v "$main_runtime/data:/app/data" -p 127.0.0.1:24500:3000 "$main_candidate_image" >/dev/null
docker run -d --name "$data_name" --restart unless-stopped \
  --env-file "$data_runtime/.env" -e CENTRAL_AUTHORITY_BASE="$central_authority_base" -e CENTRAL_AUTHORITY_FALLBACK_BASE="$central_authority_fallback_base" \
  -p 127.0.0.1:24600:3000 "$data_candidate_image" >/dev/null

test "$(docker inspect -f '{{json .HostConfig.Links}}' "$main_name")" = "null"
test "$(docker inspect -f '{{json .HostConfig.Links}}' "$data_name")" = "null"

for attempt in $(seq 1 40); do
  if curl -fsS 'http://127.0.0.1:24500/healthz' >/dev/null && curl -fsS 'http://127.0.0.1:24600/' >/dev/null; then break; fi
  test "$attempt" -lt 40 || exit 1
  sleep 2
done
docker exec "$main_name" node -e '
fetch(process.argv[1]).then(async response=>{
  const body=await response.text();
  if(response.status!==502 || !body.includes("\"ok\":false")) process.exitCode=22;
}).catch(()=>process.exitCode=23);
' 'http://127.0.0.1:3000/fd-027340/live-center-workbench/api/feishu/resource?url=https%3A%2F%2Finternal-api-lark-file.feishu.cn%2Fdownload%2Fmessages%2Finvalid-regression%2Fkeys%2Finvalid-regression'
curl -fsS 'http://127.0.0.1:24500/healthz' >/dev/null
echo 'PRODUCTION_FEISHU_RESOURCE_ERROR_BOUNDARY=passed'
production_collaboration="$stage/production-collaboration.json"
for attempt in $(seq 1 40); do
  if curl -fsS --max-time 90 'http://127.0.0.1:24500/fd-027340/live-center-workbench/modules/tasks/api/violations?refresh=1' > "$production_collaboration"; then break; fi
  test "$attempt" -lt 40 || exit 1
  sleep 2
done
python3 - "$production_collaboration" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
rows=d.get('rows') or []
required={'id','roomId','time','detail','quote','product','room','host','occurredAt'}
assert d.get('ok') and rows and all(required <= set(row) for row in rows), d
assert all(not ({'level','status','type','content'} & set(row)) for row in rows)
print(f"PRODUCTION_COCO_VIOLATIONS=passed count={len(rows)}")
PY
fetch_production_json() {
  local label="$1" url="$2" output="$3"
  for attempt in $(seq 1 8); do
    if curl -fsS --max-time 600 "$url" > "$output"; then
      echo "$label=http_passed attempt=$attempt"
      return 0
    fi
    if test "$attempt" -lt 8; then
      echo "$label=not_ready attempt=$attempt; retrying" >&2
      sleep 10
    fi
  done
  echo "$label=failed" >&2
  head -c 8000 "$output" >&2 || true
  echo >&2
  return 1
}
production_overview="$stage/production-overview.json"
production_dashboard="$stage/production-dashboard.json"
production_anchor="$stage/production-anchor.json"
fetch_production_json 'PRODUCTION_BUSINESS_OVERVIEW_HTTP' "http://127.0.0.1:24600/api/business-overview?date=$target_date" "$production_overview"
fetch_production_json 'PRODUCTION_DASHBOARD_HTTP' "http://127.0.0.1:24600/api/dashboard?date=$target_date" "$production_dashboard"
fetch_production_json 'PRODUCTION_ANCHOR_TRENDS_HTTP' "http://127.0.0.1:24600/api/anchor-trends?date=$target_date&days=14" "$production_anchor"
python3 - "$production_overview" "$production_dashboard" "$production_anchor" <<'PY'
import json,sys
overview=json.load(open(sys.argv[1],encoding='utf-8'))
dashboard=json.load(open(sys.argv[2],encoding='utf-8'))
anchor=json.load(open(sys.argv[3],encoding='utf-8'))
assert len(overview.get('reports') or []) == 2 and overview.get('calendar') and overview.get('concerns'), overview
summary=(dashboard.get('agent') or {}).get('summary') or ''
assert 'MCP' not in summary, summary
assert not dashboard.get('sourceErrors') or any(marker in summary for marker in ('实时经营数据源授权已失效','实时经营数据源部分直播间未返回场次','公司数据服务暂时超时')), summary
points=[x for values in ((anchor.get('data') or {}).get('series') or {}).values() for x in values]
assert anchor.get('ok') and points and any(x.get('conversion') is not None for x in points), anchor
print(f"PRODUCTION_BUSINESS_DATA=passed rooms={len(set(x.get('shop') for x in dashboard.get('sessions') or []))} calendar={len(overview['calendar'])} anchor_points={len(points)}")
PY
production_lifecycle="$stage/production-lifecycle.json"
production_recruitment="$stage/production-recruitment.json"
production_cards="$stage/production-cards.json"
production_assets="$stage/production-assets.json"
production_links="$stage/production-links.json"
production_scripts="$stage/production-scripts.json"
production_development="$stage/production-development.json"
fetch_production_json 'PRODUCTION_LIFECYCLE_HTTP' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/api/lifecycle/status' "$production_lifecycle"
fetch_production_json 'PRODUCTION_RECRUITMENT_HTTP' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/api/lifecycle/recruitment-cycle?month=2026-09' "$production_recruitment"
fetch_production_json 'PRODUCTION_MATERIAL_CARDS_HTTP' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/api/material-cards' "$production_cards"
fetch_production_json 'PRODUCTION_MATERIAL_ASSETS_HTTP' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/api/material-assets' "$production_assets"
fetch_production_json 'PRODUCTION_MATERIAL_LINKS_HTTP' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/api/material-links' "$production_links"
fetch_production_json 'PRODUCTION_SCRIPT_CONFIG_HTTP' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/api/script-generator/config' "$production_scripts"
fetch_production_json 'PRODUCTION_ANCHOR_DEVELOPMENT_HTTP' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/api/anchor-development' "$production_development"
python3 - "$production_lifecycle" "$production_recruitment" "$production_cards" "$production_assets" "$production_links" "$production_scripts" "$production_development" <<'PY'
import json,sys
lifecycle,recruitment,cards,assets,links,scripts,development=[json.load(open(path,encoding='utf-8')) for path in sys.argv[1:]]
assert lifecycle.get('ok') and lifecycle.get('schedulerEnabled') is True and lifecycle.get('refreshRule')=='Asia/Shanghai 09:30,18:00 daily', lifecycle
x=recruitment.get('data') or {}; c=x.get('coverage') or {}
assert recruitment.get('ok') and x.get('status') in ('current','partial') and isinstance(x.get('dailyNames'),dict) and isinstance(x.get('interviewEvents'),dict) and c.get('reactionStatus')=='已核验' and c.get('chatMessages',0)>0 and c.get('employmentStatus') in ('已读取','待授权'), recruitment
assert cards.get('ok') and isinstance(cards.get('cards'),list), cards
assert assets.get('ok') and isinstance(assets.get('assets'),list), assets
assert links.get('ok') and isinstance(links.get('links'),list), links
assert scripts.get('ok') and scripts.get('configured') is True and scripts.get('productCatalogStatus')=='已连接' and len(scripts.get('productCatalog') or [])>=6 and len(scripts.get('stages') or [])==7 and len(scripts.get('personas') or [])>=2 and len(scripts.get('broadcastModes') or [])==2 and len(scripts.get('platforms') or [])>=2 and scripts.get('sourcePolicy')=='feishu_verified_only', scripts
assert development.get('ok') and len(development.get('dimensions') or [])==4 and len(development.get('courses') or [])==8 and len(development.get('accounts') or [])==4 and development.get('ratingScale')=={'values':['A','B','C','D'],'unit':'等级'} and development.get('growthScale')=={'min':0,'max':100,'unit':'分'} and development.get('ratingPolicy')=='abcd_periodic_and_growth_score', development
PY

fetch_production_text() {
  local label="$1" url="$2" output="$3"
  for attempt in 1 2 3; do
    if curl -fsS --max-time 30 "$url" -o "$output"; then
      echo "$label=http_passed attempt=$attempt"
      return 0
    fi
    sleep 2
  done
  echo "$label=failed" >&2
  return 1
}
production_material_scripts="$stage/production-material-scripts.html"
production_material_generator="$stage/production-material-generator.html"
production_material_competitors="$stage/production-material-competitors.html"
production_material_center="$stage/production-material-center.html"
production_material_prohibited="$stage/production-material-prohibited.html"
production_material_cues="$stage/production-material-cues.html"
production_anchor_page="$stage/production-anchor-page.html"
fetch_production_text 'PRODUCTION_MATERIAL_SCRIPTS_PAGE' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/modules/materials/material-scripts.html' "$production_material_scripts"
fetch_production_text 'PRODUCTION_MATERIAL_GENERATOR_PAGE' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/modules/materials/communication-generator.html' "$production_material_generator"
fetch_production_text 'PRODUCTION_MATERIAL_COMPETITORS_PAGE' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/modules/materials/material-competitors.html' "$production_material_competitors"
fetch_production_text 'PRODUCTION_MATERIAL_CENTER_PAGE' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/modules/materials/material-center.html' "$production_material_center"
fetch_production_text 'PRODUCTION_MATERIAL_PROHIBITED_PAGE' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/modules/materials/material-prohibited.html' "$production_material_prohibited"
fetch_production_text 'PRODUCTION_MATERIAL_CUES_PAGE' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/modules/materials/material-cue-cards.html' "$production_material_cues"
fetch_production_text 'PRODUCTION_ANCHOR_PAGE' 'http://127.0.0.1:24500/fd-027340/live-center-workbench/modules/anchors/recruitment-dashboard.html' "$production_anchor_page"
grep -q 'communication-generator.html?embed=1' "$production_material_scripts"
if grep -q 'communicationGeneratorDialog' "$production_material_scripts"; then
  echo 'PRODUCTION_DEDICATED_GENERATOR=failed embedded_dialog_present' >&2
  exit 1
fi
grep -q 'communication-generator.js' "$production_material_generator"
grep -q '完整两轮沟通稿' "$production_material_generator"
grep -q '各产品稿件归档' "$production_material_scripts"
grep -q '新增竞对分析' "$production_material_competitors"
grep -q 'material-prohibited.html' "$production_material_center"
grep -q '飞书 Wiki / 飞书 Docx' "$production_material_prohibited"
if grep -q '违禁词资料库' "$production_material_cues"; then
  echo 'PRODUCTION_CUE_CARD_PROHIBITED_SPLIT=failed' >&2
  exit 1
fi
grep -q 'anchor-development.js' "$production_anchor_page"
grep -q 'anchor-development-20260829.css' "$production_anchor_page"
echo 'PRODUCTION_FUNCTIONAL_UPGRADE_APIS=passed'

docker tag "$main_candidate_image" "$main_name:latest"
docker tag "$data_candidate_image" "$data_name:latest"
# The Fandow supervisor can recreate containers from their previously pinned
# image references. Move those stable references to the verified candidate so
# an automatic recreation cannot silently restore an older filesystem.
if [[ "$main_persistent_image" != sha256:* ]]; then
  docker tag "$main_candidate_image" "$main_persistent_image"
else
  echo 'MAIN_PERSISTENT_DIGEST_TAG=skipped immutable_digest=true'
fi
if [[ "$data_persistent_image" != sha256:* ]]; then
  docker tag "$data_candidate_image" "$data_persistent_image"
else
  echo 'DATA_PERSISTENT_DIGEST_TAG=skipped immutable_digest=true'
fi
docker rm -f "$main_backup" "$data_backup" >/dev/null
trap cleanup_candidates EXIT HUP INT TERM

public_status="$(curl -sS -o /dev/null -w '%{http_code}' 'https://app.fandow.top/fd-027340/live-center-workbench/' || true)"
echo "PUBLIC_STATUS=$public_status"
echo 'RECRUITMENT_DEPLOYMENT=passed'
echo 'ANCHOR_DEPLOYMENT=passed'
echo 'BUSINESS_OVERVIEW_DEPLOYMENT=passed'
echo 'COLLABORATION_REGRESSION=passed'
echo 'LIVE_HUB_V3_DEPLOYMENT=passed'
