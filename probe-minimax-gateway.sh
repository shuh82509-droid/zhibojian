#!/usr/bin/env sh
# Small, server-side compatibility probe. It never prints the API key.
set -eu
ENV_FILE='/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench/.env.minimax'
[ -s "$ENV_FILE" ] || { echo 'MiniMax environment is missing.' >&2; exit 1; }
KEY=$(sed -n 's/^MINIMAX_API_KEY=//p' "$ENV_FILE" | tail -n 1)
BASE=$(sed -n 's/^MINIMAX_BASE_URL=//p' "$ENV_FILE" | tail -n 1)
MODEL=$(sed -n 's/^MINIMAX_MODEL=//p' "$ENV_FILE" | tail -n 1)
[ -n "$KEY" ] && [ -n "$BASE" ] && [ -n "$MODEL" ] || { echo 'MiniMax environment is incomplete.' >&2; exit 1; }
probe() {
  label="$1"; method="$2"; endpoint="$3"; payload="${4:-}"
  output=$(mktemp)
  if [ -n "$payload" ]; then
    code=$(curl -sS --max-time 45 -o "$output" -w '%{http_code}' -X "$method" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' --data "$payload" "$BASE/$endpoint" || true)
  else
    code=$(curl -sS --max-time 45 -o "$output" -w '%{http_code}' -X "$method" -H "Authorization: Bearer $KEY" "$BASE/$endpoint" || true)
  fi
  printf '\n=== %s: HTTP %s ===\n' "$label" "$code"
  head -c 1600 "$output"; printf '\n'
  rm -f "$output"
}
echo 'MINIMAX_GATEWAY_PROBE=started'
probe 'models' GET 'models'
probe 'chat_completions_non_streaming_json' POST 'chat/completions' "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"system\",\"content\":\"Return strictly valid JSON only.\"},{\"role\":\"user\",\"content\":\"Return {\\\"ok\\\":true}\"}],\"max_tokens\":128,\"stream\":false}"
probe 'completions' POST 'completions' "{\"model\":\"$MODEL\",\"prompt\":\"Return only: ok\",\"max_tokens\":8}"
probe 'responses' POST 'responses' "{\"model\":\"$MODEL\",\"input\":\"Return only: ok\",\"max_output_tokens\":8}"
unset KEY
echo 'MINIMAX_GATEWAY_PROBE=complete'
