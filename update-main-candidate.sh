#!/usr/bin/env bash
set -euo pipefail
incoming=/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized
root=/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench
candidate=fd-027340-live-center-workbench-v3-candidate-20260904145310
builder=fd-027340-main-evidence-builder-20260904
image=fd-027340-live-center-workbench:sep3-evidence-20260904
base=$(docker inspect -f '{{.Image}}' "$candidate")
data=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' "$candidate")
[[ "$data" == "$root"/candidate-data-* ]]
docker create --name "$builder" --user root --entrypoint /bin/sh "$base" -c 'sleep 600' >/dev/null
docker start "$builder" >/dev/null
docker cp "$incoming/server.js" "$builder:/app/server.js"
test -s "$incoming/calendar-user-reader.mjs"
test -s "$incoming/calendar-auth-http.mjs"
test -s "$incoming/frame-policy.mjs"
docker cp "$incoming/calendar-user-reader.mjs" "$builder:/app/calendar-user-reader.mjs"
docker cp "$incoming/calendar-auth-http.mjs" "$builder:/app/calendar-auth-http.mjs"
docker cp "$incoming/frame-policy.mjs" "$builder:/app/frame-policy.mjs"
docker cp "$incoming/lifecycle-engine.mjs" "$builder:/app/lifecycle-engine.mjs"
docker cp "$incoming/recruitment-dashboard-final.html" "$builder:/app/public/modules/recruitment/recruitment-dashboard.html"
docker cp "$incoming/anchor-dashboard-final.html" "$builder:/app/public/modules/anchors/recruitment-dashboard.html"
docker commit --change 'USER root' --change 'ENTRYPOINT ["docker-entrypoint.sh"]' --change 'CMD ["sh","container-entrypoint.sh"]' "$builder" "$image" >/dev/null
docker rm -f "$builder" "$candidate" >/dev/null
docker run -d --name "$candidate" --env-file "$root/.env" --env-file "$root/.env.coco" --env-file "$root/.env.minimax" --env-file "$root/.env.jump" \
 -e CENTRAL_AUTHORITY_BASE=https://app.fandow.top/fd-026222/wis-central-auth/api -e CENTRAL_AUTHORITY_FALLBACK_BASE=https://app.fandow.top/fd-026222/wis-video-center/api -e LIFECYCLE_SCHEDULER_ENABLED=0 -v "$data:/app/data" -p 127.0.0.1:24510:3000 "$image" >/dev/null
echo MAIN_CANDIDATE_UPDATED_ONLY
