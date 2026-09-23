#!/usr/bin/env bash
set -euo pipefail

container="fd-027340-data-center"
port="24600"
fingerprint="直播数据指挥中心"

sudo -v
sudo docker inspect "$container" --format '{{.State.Status}} {{.Config.User}} {{json .HostConfig.PortBindings}}' | grep -Eq '^running node '
curl -fsS -o /dev/null "http://127.0.0.1:${port}/"
sudo nginx -t
sudo nginx -s reload
echo "Data center is running locally on 127.0.0.1:${port}; Nginx graceful reload succeeded."
