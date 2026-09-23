#!/usr/bin/env sh
set -eu

APP_DIR="/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench"
BASE_ENV="$APP_DIR/.env"
COCO_ENV="$APP_DIR/.env.coco"
APP_ID="cli_aafbc3a80eb8dcf4"

mkdir -p "$APP_DIR"
umask 077

# Keep non-secret runtime settings separate from the Coco credential file.
SESSION_VALUE=""
if [ -f "$BASE_ENV" ]; then
  SESSION_VALUE=$(sed -n 's/^SESSION_SECRET=//p' "$BASE_ENV" | head -n 1)
fi
[ -n "$SESSION_VALUE" ] || SESSION_VALUE=$(openssl rand -hex 32)

BASE_TMP=$(mktemp "$APP_DIR/.env.base.XXXXXX")
trap 'rm -f "$BASE_TMP"' EXIT HUP INT TERM
if [ -f "$BASE_ENV" ]; then
  grep -v -E '^(FEISHU_APP_ID|FEISHU_APP_SECRET|SESSION_SECRET|AUTH_REQUIRED|BASE_PATH|PUBLIC_ORIGIN)=' "$BASE_ENV" > "$BASE_TMP" || true
fi
{
  printf 'SESSION_SECRET=%s\n' "$SESSION_VALUE"
  printf 'AUTH_REQUIRED=false\n'
  printf 'BASE_PATH=/fd-027340/live-center-workbench\n'
  printf 'PUBLIC_ORIGIN=https://app.fandow.top\n'
} >> "$BASE_TMP"
chmod 600 "$BASE_TMP"
mv -f "$BASE_TMP" "$BASE_ENV"
trap - EXIT HUP INT TERM

if [ ! -f "$COCO_ENV" ]; then
  {
    printf 'FEISHU_APP_ID=%s\n' "$APP_ID"
    printf 'FEISHU_APP_SECRET=PASTE_APP_SECRET_HERE\n'
  } > "$COCO_ENV"
fi
chmod 600 "$COCO_ENV"

echo 'Opening the server-only Coco configuration file:' >&2
echo "  $COCO_ENV" >&2
echo 'Replace PASTE_APP_SECRET_HERE, save the file, then close the editor.' >&2
if command -v nano >/dev/null 2>&1; then
  nano "$COCO_ENV"
elif command -v vi >/dev/null 2>&1; then
  vi "$COCO_ENV"
else
  echo 'Neither nano nor vi is installed on the server.' >&2
  exit 1
fi

chmod 600 "$COCO_ENV"
grep -q "^FEISHU_APP_ID=${APP_ID}$" "$COCO_ENV" || {
  echo 'FEISHU_APP_ID is missing or incorrect in .env.coco.' >&2
  exit 1
}
grep -q '^FEISHU_APP_SECRET=.' "$COCO_ENV" || {
  echo 'FEISHU_APP_SECRET is empty in .env.coco.' >&2
  exit 1
}
if grep -q '^FEISHU_APP_SECRET=PASTE_APP_SECRET_HERE$' "$COCO_ENV"; then
  echo 'Replace the App Secret placeholder before closing the editor.' >&2
  exit 1
fi

echo 'Coco server configuration saved with file mode 600. No secret was printed.'
