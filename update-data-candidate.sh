#!/usr/bin/env bash
set -euo pipefail
archive="${1:?archive}"
candidate=fd-027340-data-center-v3-candidate-20260904145310
builder=fd-027340-data-resilience-builder-20260904
image=fd-027340-data-center:sep3-resilience-20260904
stage=$(mktemp -d /tmp/live-data-resilience.XXXXXX)
tar -xzf "$archive" -C "$stage"
base=$(docker inspect -f '{{.Image}}' "$candidate")
docker create --name "$builder" --user root --entrypoint /bin/sh "$base" -c 'sleep 600' >/dev/null
docker start "$builder" >/dev/null
docker exec "$builder" rm -rf /app/dist
docker cp "$stage/dist/." "$builder:/app/dist/"
docker commit --change 'USER node' --change 'ENTRYPOINT ["docker-entrypoint.sh"]' --change 'CMD ["npm","run","start","--","--hostname","0.0.0.0","--port","3000"]' "$builder" "$image" >/dev/null
docker rm -f "$builder" >/dev/null
docker rm -f "$candidate" >/dev/null
docker run -d --name "$candidate" --env-file /home/fandow-deploy/fandow-apps/runtime/fd-027340/data-center/.env -e CENTRAL_AUTHORITY_BASE=https://app.fandow.top/fd-026222/wis-central-auth/api -e CENTRAL_AUTHORITY_FALLBACK_BASE=https://app.fandow.top/fd-026222/wis-video-center/api -p 127.0.0.1:24610:3000 "$image" >/dev/null
echo DATA_CANDIDATE_UPDATED_ONLY
