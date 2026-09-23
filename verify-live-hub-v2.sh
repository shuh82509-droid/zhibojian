#!/usr/bin/env bash
set -euo pipefail

main_status="$(curl -sS -o /tmp/fd-main.html -w '%{http_code}' http://127.0.0.1:24500/)"
data_status="$(curl -sS -o /tmp/fd-data.json -w '%{http_code}' 'http://127.0.0.1:24600/api/dashboard?date=2026-08-18')"
overview_status="$(curl -sS -o /tmp/fd-overview.json -w '%{http_code}' 'http://127.0.0.1:24600/api/business-overview?date=2026-08-18')"
dispatch_status="$(curl -sS -o /tmp/fd-dispatch.json -w '%{http_code}' 'http://127.0.0.1:24601/api/schedule?date=2026-08-18')"
public_status="$(curl -sS -o /dev/null -w '%{http_code}' 'https://app.fandow.top/fd-027340/live-center-workbench/')"

python3 - <<'PY'
import json
data=json.load(open('/tmp/fd-data.json',encoding='utf-8'))
overview=json.load(open('/tmp/fd-overview.json',encoding='utf-8'))
dispatch=json.load(open('/tmp/fd-dispatch.json',encoding='utf-8'))
shops={item.get('shop') for item in data.get('sessions',[])}
assert len(shops)==4, shops
assert len(overview.get('targets') or [])==4, overview.get('targets')
assert overview.get('calendar'), 'calendar is empty'
rooms=dispatch.get('rooms') or []
assert len(rooms)==4, rooms
assert all(room.get('anchors') and room.get('assistants') for room in rooms), rooms
print('VERIFY_DATA | shops=4 targets=4 calendar=%d' % len(overview['calendar']))
print('VERIFY_DISPATCH | ' + ', '.join('%s=%d/%d' % (x['name'],len(x['anchors']),len(x['assistants'])) for x in rooms))
PY

grep -q '直播经营看板' /tmp/fd-main.html
grep -q '主播全生命周期管理' /tmp/fd-main.html
echo "VERIFY_HTTP | main=$main_status data=$data_status overview=$overview_status dispatch=$dispatch_status public=$public_status"
echo 'LIVE_HUB_V2_VERIFY=passed'
