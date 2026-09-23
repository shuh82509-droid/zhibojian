#!/usr/bin/env bash
set -euo pipefail

client_ip="183.6.120.155"
configs=(
  /etc/nginx/lightdeploy-locations/fd-027340-data-center.conf
  /etc/nginx/lightdeploy-locations/fd-027340-dispatch-center.conf
)

sudo -v
for config in "${configs[@]}"; do
  test -r "$config" || { echo "Cannot read Nginx config: $config" >&2; exit 2; }
  temp="$(mktemp)"
  awk -v ip="$client_ip" '
    /^[[:space:]]*location[[:space:]]/ { allowed=0 }
    index($0, "allow " ip ";") { allowed=1 }
    /^[[:space:]]*allow 10\.0\.0\.0\/8;/ {
      if (!allowed) print "    allow " ip ";"
      print
      next
    }
    { print }
  ' "$config" > "$temp"
  blocks=$(grep -Ec '^[[:space:]]*allow 10\.0\.0\.0/8;' "$temp" || true)
  granted=$(grep -Ec "^[[:space:]]*allow ${client_ip//./\\.};" "$temp" || true)
  if [[ "$granted" -lt "$blocks" ]]; then
    echo "Could not grant every restricted route in: $config" >&2
    exit 3
  fi
  sudo install -m 644 "$temp" "$config"
  rm -f "$temp"
  echo "Updated ${granted}/${blocks} protected route blocks in: $config"
done

sudo nginx -t
sudo nginx -s reload
echo "DONE: module page and API routes now allow ${client_ip}."
