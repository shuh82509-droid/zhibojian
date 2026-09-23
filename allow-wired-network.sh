#!/usr/bin/env bash
set -euo pipefail

client_ip="108.181.22.153"
configs=(
  /etc/nginx/lightdeploy-locations/fd-027340-live-center-workbench.conf
  /etc/nginx/lightdeploy-locations/fd-027340-data-center.conf
  /etc/nginx/lightdeploy-locations/fd-027340-dispatch-center.conf
)

sudo -v
for config in "${configs[@]}"; do
  test -r "$config" || { echo "Cannot read Nginx config: $config" >&2; exit 2; }
  if grep -Fq "allow ${client_ip};" "$config"; then
    echo "Already allowed: $config"
    continue
  fi
  temp="$(mktemp)"
  sed "0,/^[[:space:]]*allow 10.0.0.0\\/8;/s//    allow ${client_ip};\\n&/" "$config" > "$temp"
  grep -Fq "allow ${client_ip};" "$temp" || { echo "Could not update: $config" >&2; exit 3; }
  sudo install -m 644 "$temp" "$config"
  rm -f "$temp"
  echo "Allowed wired-network IP in: $config"
done

sudo nginx -t
sudo nginx -s reload
echo "DONE: ${client_ip} can access the Live Hub routes."
