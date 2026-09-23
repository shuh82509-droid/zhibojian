#!/usr/bin/env bash
set -euo pipefail

client_ip="183.6.120.155"
workbench="/etc/nginx/lightdeploy-locations/fd-027340-live-center-workbench.conf"
configs=(
  "$workbench"
  /etc/nginx/lightdeploy-locations/fd-027340-data-center.conf
  /etc/nginx/lightdeploy-locations/fd-027340-dispatch-center.conf
)

sudo -v
for config in "${configs[@]}"; do
  test -r "$config" || { echo "Cannot read Nginx config: $config" >&2; exit 2; }
  temp="$(mktemp)"
  if [[ "$config" == "$workbench" ]]; then
    awk '
      $0 == "location = /fd-027340/live-center-workbench/__access-check {" { skip=1; next }
      skip && /^}/ { skip=0; next }
      !skip { print }
    ' "$config" > "$temp"
  else
    cat "$config" > "$temp"
  fi
  if ! grep -Fq "allow ${client_ip};" "$temp"; then
    next_temp="$(mktemp)"
    sed "0,/^[[:space:]]*allow 10.0.0.0\\/8;/s//    allow ${client_ip};\\n&/" "$temp" > "$next_temp"
    mv "$next_temp" "$temp"
  fi
  grep -Fq "allow ${client_ip};" "$temp" || { echo "Could not update: $config" >&2; exit 3; }
  sudo install -m 644 "$temp" "$config"
  rm -f "$temp"
  echo "Allowed detected source in: $config"
done

sudo nginx -t
sudo nginx -s reload
echo "DONE: ${client_ip} can access the Live Hub routes; diagnostic route removed."
