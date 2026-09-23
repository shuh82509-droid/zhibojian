#!/usr/bin/env sh
set -eu

TMP_FILE=$(mktemp)
trap 'rm -f "$TMP_FILE"' EXIT HUP INT TERM
curl -fsS http://127.0.0.1:11123/openapi.json -o "$TMP_FILE"
python3 - "$TMP_FILE" <<'PY'
import json, sys
spec = json.load(open(sys.argv[1], encoding='utf-8'))
terms = ('user', 'employee', 'feishu', 'profile', 'identity', 'auth', 'staff')
matches = {}
for path, methods in spec.get('paths', {}).items():
    blob = (path + ' ' + json.dumps(methods, ensure_ascii=False)).lower()
    if any(term in blob for term in terms):
        matches[path] = {
            method: {
                'summary': details.get('summary'),
                'parameters': details.get('parameters', []),
                'requestBody': details.get('requestBody', {}),
                'responses': details.get('responses', {}),
            }
            for method, details in methods.items()
            if isinstance(details, dict)
        }
print(json.dumps(matches, ensure_ascii=False, indent=2))
PY
