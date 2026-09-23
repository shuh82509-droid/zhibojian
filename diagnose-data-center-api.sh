#!/usr/bin/env bash
set -euo pipefail

headers="$(mktemp)"
body="$(mktemp)"
trap 'rm -f "$headers" "$body"' EXIT

curl -sS -D "$headers" -o "$body" -w 'HTTP_STATUS:%{http_code}\n' \
  'http://127.0.0.1:24600/api/dashboard'
echo '--- response body (first 4000 characters; no credential values) ---'
head -c 4000 "$body"
echo
echo '--- end ---'
