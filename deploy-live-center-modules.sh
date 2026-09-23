#!/usr/bin/env bash
set -euo pipefail

employee_id="fd-027340"
app_name="${1:?app name is required}"
archive="${2:?archive is required}"
fingerprint="${3:?content fingerprint is required}"
case "$app_name" in data-center|dispatch-center) ;; *) echo "Unsupported app: $app_name" >&2; exit 2;; esac

base="/home/fandow-deploy/fandow-apps/runtime/${employee_id}"
app_dir="${base}/${app_name}"
container="${employee_id}-${app_name}"
image="${container}:latest"
nginx_conf="/etc/nginx/lightdeploy-locations/${employee_id}-${app_name}.conf"
url="https://app.fandow.top/${employee_id}/${app_name}/"

sudo -v
echo "Intranet-only rollout: RFC1918 source ranges are allowed; all other sources are denied."

case "$app_name" in
  data-center) host_port=24600 ;;
  dispatch-center) host_port=24601 ;;
esac
if ss -ltn | grep -Eq "127\.0\.0\.1:${host_port}([^0-9]|$)"; then
  echo "Required host port ${host_port} is already assigned; deployment stopped without changing any app." >&2
  exit 5
fi

stage="$(mktemp -d)"
cleanup(){ rm -rf "$stage"; }
trap cleanup EXIT
tar -xzf "$archive" -C "$stage"
source_dir="${stage}/${app_name}"
test -f "$source_dir/Dockerfile"

old_env=""
if test -f "${app_dir}/.env"; then
  old_env="$(mktemp)"
  cat "${app_dir}/.env" > "$old_env"
fi

if [[ "$app_name" == "data-center" ]]; then
  env_key="FANDOW_DATA_MCP_TOKEN"
else
  env_key="MCP_BEARER_TOKEN"
fi
if [[ -z "$old_env" ]] || ! grep -q "^${env_key}=" "$old_env"; then
  read -r -s -p "Enter ${env_key} for ${app_name} (input hidden): " mcp_token
  echo
  test -n "$mcp_token" || { echo "No MCP token entered." >&2; exit 4; }
  env_file="$(mktemp)"
  umask 077
  printf '%s=%s\n' "$env_key" "$mcp_token" > "$env_file"
else
  env_file="$old_env"
fi

install -d -m 750 "$base"
rm -rf "${app_dir}.next"
install -d -m 750 "${app_dir}.next"
tar -C "$source_dir" -cf - . | tar -C "${app_dir}.next" -xf -
install -m 600 "$env_file" "${app_dir}.next/.env"
rm -f "$env_file"

sudo docker build -t "$image" "${app_dir}.next"

if sudo docker ps -a --format '{{.Names}}' | grep -Fxq "$container"; then sudo docker rm -f "$container"; fi
sudo docker run -d --name "$container" --restart unless-stopped --env-file "${app_dir}.next/.env" -p "127.0.0.1:${host_port}:3000" "$image"
sleep 3
sudo docker inspect "$container" --format '{{.State.Status}} {{.Config.User}} {{json .HostConfig.PortBindings}}' | grep -Eq '^running (node|app) '

if test -d "$app_dir"; then mv "$app_dir" "${app_dir}.backup.$(date +%s)"; fi
mv "${app_dir}.next" "$app_dir"

tmp_conf="$(mktemp)"
cat > "$tmp_conf" <<EOF
location = /${employee_id}/${app_name} { return 301 /${employee_id}/${app_name}/; }
location ^~ /${employee_id}/${app_name}/api/ {
    allow 10.0.0.0/8;
    allow 172.16.0.0/12;
    allow 192.168.0.0/16;
    deny all;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Prefix /${employee_id}/${app_name};
    proxy_pass http://127.0.0.1:${host_port}/api/;
}
location ^~ /${employee_id}/${app_name}/ {
    allow 10.0.0.0/8;
    allow 172.16.0.0/12;
    allow 192.168.0.0/16;
    deny all;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Prefix /${employee_id}/${app_name};
    proxy_set_header Accept-Encoding "";
    sub_filter_once off;
    sub_filter_types text/html text/css application/javascript text/javascript application/json;
    sub_filter 'href="/' 'href="/${employee_id}/${app_name}/';
    sub_filter 'src="/' 'src="/${employee_id}/${app_name}/';
    sub_filter 'fetch("/' 'fetch("/${employee_id}/${app_name}/';
    sub_filter "fetch('/" "fetch('/${employee_id}/${app_name}/";
    proxy_pass http://127.0.0.1:${host_port}/;
}
EOF
sudo install -m 644 "$tmp_conf" "$nginx_conf"
sudo nginx -t
sudo nginx -s reload
if [[ "$app_name" == "dispatch-center" ]]; then
  curl -fsS "http://127.0.0.1:${host_port}/api/health" | grep -q '"ok":true'
else
  curl -fsS -o /dev/null "http://127.0.0.1:${host_port}/"
fi

echo "DEPLOYED ${url}"
