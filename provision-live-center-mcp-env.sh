#!/usr/bin/env bash
set -euo pipefail

employee_id="fd-027340"
for app_name in data-center dispatch-center; do
  case "$app_name" in
    data-center) env_key="FANDOW_DATA_MCP_TOKEN" ;;
    dispatch-center) env_key="MCP_BEARER_TOKEN" ;;
  esac
  app_dir="/home/fandow-deploy/fandow-apps/runtime/${employee_id}/${app_name}"
  install -d -m 750 "$app_dir"
  env_file="${app_dir}/.env"
  if test -f "$env_file" && grep -q "^${env_key}=" "$env_file"; then
    chmod 600 "$env_file"
    echo "Restricted runtime configuration already exists for ${app_name}; keeping it unchanged."
    continue
  fi
  if [[ "$app_name" == "dispatch-center" ]]; then
    data_env="/home/fandow-deploy/fandow-apps/runtime/${employee_id}/data-center/.env"
    if test -f "$data_env" && grep -q '^FANDOW_DATA_MCP_TOKEN=' "$data_env"; then
      umask 077
      sed 's/^FANDOW_DATA_MCP_TOKEN=/MCP_BEARER_TOKEN=/' "$data_env" > "$env_file"
      chmod 600 "$env_file"
      echo "Reused the existing restricted MCP configuration for ${app_name}."
      continue
    fi
  fi
  read -r -s -p "Enter ${env_key} for ${app_name} (input hidden): " token
  echo
  test -n "$token" || { echo "No token entered for ${app_name}." >&2; exit 2; }
  umask 077
  printf '%s=%s\n' "$env_key" "$token" > "$env_file"
  chmod 600 "$env_file"
  unset token
  echo "Stored restricted runtime configuration for ${app_name}."
done
