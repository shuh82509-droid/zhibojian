#!/usr/bin/env bash
set -euo pipefail

config="/etc/nginx/lightdeploy-locations/fd-027340-live-center-workbench.conf"
marker="/fd-027340/live-center-workbench/__access-check"

sudo -v
test -r "$config" || { echo "Cannot read Nginx config." >&2; exit 2; }
if grep -Fq "$marker" "$config"; then
  echo "Access diagnostic is already installed."
else
  temp="$(mktemp)"
  cat > "$temp" <<'EOF'
location = /fd-027340/live-center-workbench/__access-check {
    default_type text/plain;
    return 200 "$remote_addr\n";
}
EOF
  cat "$config" >> "$temp"
  sudo install -m 644 "$temp" "$config"
  rm -f "$temp"
fi
sudo nginx -t
sudo nginx -s reload
echo "OPEN: https://app.fandow.top/fd-027340/live-center-workbench/__access-check"
