#!/usr/bin/env sh
# Runs on the company server.  It never prints the shared service token.
set -eu

EMPLOYEE_ID='fd-027340'
APP_DIR="/home/fandow-deploy/fandow-apps/runtime/${EMPLOYEE_ID}/live-center-workbench"
DATA_ENV="/home/fandow-deploy/fandow-apps/runtime/${EMPLOYEE_ID}/data-center/.env"
TARGET_ENV="${APP_DIR}/.env.minimax"

[ -s "$DATA_ENV" ] || { echo 'The data-center server configuration is missing.' >&2; exit 1; }
if [ -s "$TARGET_ENV" ] && grep -q '^MINIMAX_API_KEY=.' "$TARGET_ENV"; then
  chmod 600 "$TARGET_ENV"
  echo 'MINIMAX_SERVER_CONFIGURATION=reused_existing_provider'
  exit 0
fi
TOKEN=$(sed -n 's/^FANDOW_DATA_MCP_TOKEN=//p' "$DATA_ENV" | tail -n 1)
[ -n "$TOKEN" ] || { echo 'The existing data-center MCP token is missing.' >&2; exit 1; }

umask 077
{
  printf 'MINIMAX_API_KEY=%s\n' "$TOKEN"
  printf 'MINIMAX_BASE_URL=https://cloud.fandow.com/gpt/openclaw-jump/v1\n'
  printf 'MINIMAX_MODEL=MiniMax-M2.7-highspeed\n'
  printf 'MINIMAX_TIMEOUT_SECONDS=1800\n'
  printf 'INTELLIGENCE_REFRESH_MINUTES=15\n'
} > "$TARGET_ENV"
chmod 600 "$TARGET_ENV"
unset TOKEN
printf 'MINIMAX_SERVER_CONFIGURATION=created\n'
