#!/usr/bin/env bash
set -euo pipefail

employee="fd-027340"
work_dir="$(mktemp -d)"
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT HUP INT TERM

write_config() {
  app="$1"
  port="$2"
  target="/etc/nginx/lightdeploy-locations/${employee}-${app}.conf"
  backup="${work_dir}/${app}.backup.conf"
  candidate="${work_dir}/${app}.conf"
  test -r "$target"
  cp "$target" "$backup"

  cat > "$candidate" <<EOF
location = /${employee}/${app} { return 301 /${employee}/${app}/; }
location ^~ /${employee}/${app}/api/ {
    auth_request /_auto_deploy_auth_verify;
    error_page 401 = @auto_deploy_login_callbackUrl;
    error_page 500 =503 /_auth_unavailable;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Prefix /${employee}/${app};
    proxy_pass http://127.0.0.1:${port}/api/;
}
location ^~ /${employee}/${app}/ {
    auth_request /_auto_deploy_auth_verify;
    error_page 401 = @auto_deploy_login_callbackUrl;
    error_page 500 =503 /_auth_unavailable;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Prefix /${employee}/${app};
    proxy_set_header Accept-Encoding "";
    sub_filter_once off;
    sub_filter_types text/html text/css application/javascript text/javascript application/json;
    sub_filter 'href="/' 'href="/${employee}/${app}/';
    sub_filter 'src="/' 'src="/${employee}/${app}/';
    sub_filter 'fetch("/' 'fetch("/${employee}/${app}/';
    sub_filter "fetch('/" "fetch('/${employee}/${app}/";
    proxy_pass http://127.0.0.1:${port}/;
}
EOF
  sudo install -m 644 "$candidate" "$target"
}

write_config data-center 24600
write_config dispatch-center 24601

if ! sudo nginx -t; then
  sudo install -m 644 "$work_dir/data-center.backup.conf" "/etc/nginx/lightdeploy-locations/${employee}-data-center.conf"
  sudo install -m 644 "$work_dir/dispatch-center.backup.conf" "/etc/nginx/lightdeploy-locations/${employee}-dispatch-center.conf"
  sudo nginx -t || true
  echo 'Nginx validation failed; original module configurations were restored.' >&2
  exit 3
fi
sudo nginx -s reload

for app in data-center dispatch-center; do
  target="/etc/nginx/lightdeploy-locations/${employee}-${app}.conf"
  test "$(grep -c 'auth_request /_auto_deploy_auth_verify;' "$target")" -eq 2
  if grep -Eq '^[[:space:]]*(allow|deny)[[:space:]]' "$target"; then
    echo "IP restriction remains in ${app} configuration." >&2
    exit 4
  fi
  echo "${app}: OA_AUTH=enabled IP_ALLOWLIST=removed"
done
echo 'UNIFIED_AUTH_COMPLETE'
