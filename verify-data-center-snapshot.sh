#!/usr/bin/env bash
set -euo pipefail

container="fd-027340-data-center"
url="http://127.0.0.1:24600/api/dashboard"

sudo -v
sudo docker inspect "$container" --format '{{.State.Status}} {{.Config.User}}' | grep -Eq '^running node$'
for attempt in $(seq 1 12); do
  if curl -fsS "$url" | grep -Fq '"sessions":[{'; then
    echo "SNAPSHOT_DATA_CENTER_READY"
    exit 0
  fi
  echo "Waiting for data center API ($attempt/12)..."
  sleep 3
done
echo "Data center did not become ready. Recent container logs:" >&2
sudo docker logs --tail=100 "$container" >&2
exit 1
