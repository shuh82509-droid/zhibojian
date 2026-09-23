#!/usr/bin/env sh
set -eu
APP_DIR='/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
CONTAINER='fd-027340-live-center-workbench'
PORT='24500'

cd "$APP_DIR"
echo '=== server-side MiniMax configuration ==='
if [ -s .env.minimax ] && grep -q '^MINIMAX_API_KEY=.' .env.minimax; then
  echo 'MINIMAX_CONFIG=present'
  sed -n -e 's/^MINIMAX_BASE_URL=/MINIMAX_BASE_URL=/' -e 's/^MINIMAX_MODEL=/MINIMAX_MODEL=/' -e 's/^INTELLIGENCE_REFRESH_MINUTES=/INTELLIGENCE_REFRESH_MINUTES=/' .env.minimax
else
  echo 'MINIMAX_CONFIG=missing_or_empty'
fi
echo '=== main container ==='
sudo docker ps -a --filter "name=^/${CONTAINER}$" --format 'NAME={{.Names}} STATUS={{.Status}} PORTS={{.Ports}}'
echo '=== MiniMax-related container logs (no credentials) ==='
sudo docker logs --tail=220 "$CONTAINER" 2>&1 | grep -Ei 'minimax|intelligence|feishu|listening|error|failed' || true
echo '=== local status endpoint ==='
curl -sS --max-time 20 "http://127.0.0.1:${PORT}/api/intelligence/status" || true
echo
printf 'DIAGNOSTIC_COMPLETE\n'
