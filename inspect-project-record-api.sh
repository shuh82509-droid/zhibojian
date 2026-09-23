#!/usr/bin/env sh
set -eu

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

curl -fsS http://127.0.0.1:11123/api/project-records -o "$TMP_DIR/records.json"
curl -fsS http://127.0.0.1:11123/openapi.json -o "$TMP_DIR/openapi.json" || printf '{}\n' > "$TMP_DIR/openapi.json"

python3 - "$TMP_DIR/records.json" "$TMP_DIR/openapi.json" <<'PY'
import json, sys
records = json.load(open(sys.argv[1], encoding='utf-8'))
openapi = json.load(open(sys.argv[2], encoding='utf-8'))

def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)

matches = []
for item in walk(records):
    text = json.dumps(item, ensure_ascii=False).lower()
    if 'fd-027340' in text or 'live-center-workbench' in text or 'data-center' in text or 'dispatch-center' in text:
        clean = {k: v for k, v in item.items() if not any(word in k.lower() for word in ('secret', 'password', 'token'))}
        if clean and clean not in matches:
            matches.append(clean)

print('MATCHING_RECORDS=')
print(json.dumps(matches[:20], ensure_ascii=False, indent=2))
post = openapi.get('paths', {}).get('/api/project-records', {}).get('post', {})
print('POST_REQUEST_SCHEMA=')
print(json.dumps(post.get('requestBody', {}), ensure_ascii=False, indent=2))
schemas = openapi.get('components', {}).get('schemas', {})
related = {k: v for k, v in schemas.items() if 'project' in k.lower() or 'record' in k.lower()}
print('RELATED_SCHEMAS=')
print(json.dumps(related, ensure_ascii=False, indent=2))
PY
