#!/usr/bin/env bash
set -euo pipefail

main_container="fd-027340-live-center-workbench"
data_container="fd-027340-data-center"

echo '=== container status before recovery ==='
sudo docker ps -a --filter "name=^/${main_container}$" --filter "name=^/${data_container}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

if ! sudo docker ps -a --format '{{.Names}}' | grep -Fxq "$main_container"; then
  echo 'MAIN_CONTAINER_MISSING'
  exit 2
fi

if ! sudo docker ps --format '{{.Names}}' | grep -Fxq "$main_container"; then
  echo 'Main workbench container is stopped; starting it.'
  sudo docker start "$main_container" >/dev/null
fi

healthy=false
for attempt in $(seq 1 12); do
  if curl -fsS http://127.0.0.1:24500/healthz | grep -Fxq 'ok'; then
    healthy=true
    break
  fi
  if test "$attempt" = 3; then
    echo 'Main workbench is not responding; restarting it once.'
    sudo docker restart "$main_container" >/dev/null
  fi
  sleep 2
done

if test "$healthy" != true; then
  echo 'MAIN_WORKBENCH_UNHEALTHY'
  sudo docker inspect "$main_container" --format '{{json .State}}'
  sudo docker logs --tail=160 "$main_container"
  exit 3
fi

sudo nginx -t
sudo nginx -s reload
public_status="$(curl -ksS -o /dev/null -w '%{http_code}' 'https://app.fandow.top/fd-027340/live-center-workbench/')"

echo '=== container status after recovery ==='
sudo docker ps --filter "name=^/${main_container}$" --filter "name=^/${data_container}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo 'MAIN_HEALTH=passed'
echo "PUBLIC_STATUS=${public_status}"
echo 'RECOVERY_COMPLETE'
