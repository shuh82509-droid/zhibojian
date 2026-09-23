#!/usr/bin/env bash
set -euo pipefail

base="/home/fandow-deploy/fandow-apps/runtime/fd-027340"
main="$base/live-center-workbench"
report="$(mktemp)"
trap 'rm -f "$report"' EXIT HUP INT TERM
blockers=0

test -s "$main/.env.coco" || { echo 'PREFLIGHT_BLOCKED: missing .env.coco'; exit 2; }
set -a
. "$main/.env.coco"
set +a
test -n "${FEISHU_APP_ID:-}" && test -n "${FEISHU_APP_SECRET:-}" || { echo 'PREFLIGHT_BLOCKED: incomplete Coco credentials'; exit 2; }

echo '=== Runtime health (read-only) ==='
for spec in \
  'main|http://127.0.0.1:24500/healthz' \
  'data-center|http://127.0.0.1:24600/' \
  'dispatch-center|http://127.0.0.1:24601/api/health'; do
  name="${spec%%|*}"; url="${spec#*|}"
  code="$(curl -sS -o /dev/null --max-time 20 -w '%{http_code}' "$url" || true)"
  printf 'RUNTIME | %s | HTTP %s\n' "$name" "$code"
  case "$code" in 200) ;; *) echo "PREFLIGHT_BLOCKED: ${name} is unhealthy"; exit 2;; esac
done

echo '=== Existing API payloads (read-only) ==='
curl -fsS --max-time 60 'http://127.0.0.1:24600/api/dashboard' -o "$report.data"
if ! python3 - "$report.data" <<'PY'
import json, sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
shops=['WIS官方旗舰店','WIS官方旗舰店甄选','WIS官方旗舰店优选','WIS燕窝面膜护肤店']
sessions=d.get('sessions') or []
counts={s:sum(1 for x in sessions if x.get('shop')==s) for s in shops}
print('DATA_CENTER | sessions=%s | %s' % (len(sessions), ', '.join('%s=%s'%x for x in counts.items())))
if d.get('error'): raise SystemExit('PREFLIGHT_BLOCKED: data-center returned error')
if not sessions or sum(counts.values()) == 0: print('PREFLIGHT_WARNING: deployed data-center is stale; direct Coco source checks will decide whether the new fallback can be deployed')
PY
then blockers=$((blockers + 1)); fi

today="$(TZ=Asia/Shanghai date +%F)"
curl -fsS --max-time 60 "http://127.0.0.1:24601/api/schedule?date=$today&refresh=1" -o "$report.schedule"
if ! python3 - "$report.schedule" <<'PY'
import json, sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
rooms=d.get('rooms') or []
summary=[]
for r in rooms:
    summary.append('%s=%s/%s'%(r.get('name'),len(r.get('anchors') or []),len(r.get('assistants') or [])))
print('DISPATCH | rooms=%s | %s | available=%s' % (len(rooms), ', '.join(summary), len((d.get('availability') or {}).get('available') or [])))
if len(rooms) != 4: raise SystemExit('PREFLIGHT_BLOCKED: dispatch did not return four rooms')
if sum(len(r.get('anchors') or []) for r in rooms) == 0: print('PREFLIGHT_WARNING: deployed dispatch parser is stale; direct four-sheet checks will validate the replacement parser inputs')
PY
then blockers=$((blockers + 1)); fi

curl -fsS --max-time 60 'http://127.0.0.1:24500/api/modules/live-data?refresh=1' -o "$report.modules"
if ! python3 - "$report.modules" <<'PY'
import json, sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
data=d.get('data') or {}
chats=data.get('chats') or []
placements=data.get('placements') or []
print('MODULE_DATA | chats=%s | placements=%s | failures=%s' % (len(chats),len(placements),len(data.get('failures') or [])))
if not d.get('ok') or not chats: raise SystemExit('PREFLIGHT_BLOCKED: module live-data has no chats')
PY
then blockers=$((blockers + 1)); fi

echo '=== Coco source permissions and non-empty data (read-only) ==='
if ! python3 - <<'PY'
import datetime, json, os, re, sys, urllib.parse, urllib.request, urllib.error

BASE='https://open.feishu.cn/open-apis'
def req(path, method='GET', body=None, token=None):
    data=None if body is None else json.dumps(body).encode()
    headers={'Content-Type':'application/json; charset=utf-8'}
    if token: headers['Authorization']='Bearer '+token
    request=urllib.request.Request(BASE+path,data=data,headers=headers,method=method)
    try:
        with urllib.request.urlopen(request,timeout=40) as response:
            raw=response.read().decode('utf-8','replace')
    except urllib.error.HTTPError as error:
        raw=error.read().decode('utf-8','replace')
        raise RuntimeError('HTTP %s %s'%(error.code,raw[:260]))
    payload=json.loads(raw)
    if payload.get('code') not in (None,0): raise RuntimeError('%s %s'%(payload.get('code'),payload.get('msg')))
    return payload.get('data') or payload

auth=req('/auth/v3/tenant_access_token/internal','POST',{'app_id':os.environ['FEISHU_APP_ID'],'app_secret':os.environ['FEISHU_APP_SECRET']})
token=auth.get('tenant_access_token')
if not token: raise SystemExit('PREFLIGHT_BLOCKED: Coco tenant token unavailable')
print('COCO_TOKEN | passed')

blocked=[]; warnings=[]
def check(label, fn, critical=True):
    try:
        detail=fn()
        print('SOURCE_OK | %s | %s'%(label,detail))
    except Exception as error:
        text=str(error).replace('\n',' ')[:360]
        print('SOURCE_FAIL | %s | %s'%(label,text))
        (blocked if critical else warnings).append(label)

def wiki(token_value):
    data=req('/wiki/v2/spaces/get_node?token='+urllib.parse.quote(token_value),token=token)
    node=data.get('node') or {}
    if not node.get('obj_token'): raise RuntimeError('wiki node has no object token')
    return '%s:%s'%(node.get('obj_type'),node.get('title') or node.get('obj_token'))

def sheet_values(book, range_value):
    path='/sheets/v2/spreadsheets/%s/values/%s?valueRenderOption=ToString&dateTimeRenderOption=FormattedString'%(urllib.parse.quote(book),urllib.parse.quote(range_value,safe=''))
    data=req(path,token=token)
    values=(data.get('valueRange') or {}).get('values') or []
    if not values: raise RuntimeError('sheet returned no rows')
    return 'rows=%s cols=%s'%(len(values),max(len(x) for x in values))

def sheet_rows(book, range_value):
    path='/sheets/v2/spreadsheets/%s/values/%s?valueRenderOption=ToString&dateTimeRenderOption=FormattedString'%(urllib.parse.quote(book),urllib.parse.quote(range_value,safe=''))
    data=req(path,token=token)
    return (data.get('valueRange') or {}).get('values') or []

def cell_text(value):
    if isinstance(value,list): return ''.join(cell_text(x) for x in value)
    if isinstance(value,dict): return cell_text(value.get('text',value.get('value','')))
    return str(value or '').strip()

def schedule_source(label,sheet_id,max_col,roster_cols):
    today=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
    column=sheet_rows('EuYqssm4WhNwAvtyybKcDdk1ned',f'{sheet_id}!A:A')
    weekdays='一二三四五六日'
    candidates=[]
    for index,row in enumerate(column):
        raw=cell_text(row[0] if row else '')
        match=re.search(r'(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日',raw)
        if not match: continue
        year,month,day=match.groups()
        if int(month)!=today.month or int(day)!=today.day or (year and int(year)!=today.year): continue
        weekday=re.search(r'星期\s*([一二三四五六日天])',raw)
        if weekday and weekdays.index('日' if weekday.group(1)=='天' else weekday.group(1))!=today.weekday(): continue
        candidates.append((index+1,raw))
    if not candidates: raise RuntimeError(f'no exact {today.isoformat()} weekday-matched block')
    start,marker=candidates[-1]
    end=min(len(column),start+35)
    block=sheet_rows('EuYqssm4WhNwAvtyybKcDdk1ned',f'{sheet_id}!A{start}:{max_col}{end}')
    if not block: raise RuntimeError('matched block returned no rows')
    time_pattern=re.compile(r'\d{1,2}:\d{2}\s*[-—~～至]\s*\d{1,2}:\d{2}')
    roster=[]
    best_header=-1; best_time_count=0
    for row_index,row in enumerate(block):
        values=[cell_text(x) for x in row]
        time_count=sum(1 for value in values[3:] if time_pattern.search(value.replace('次日','')))
        if time_count>best_time_count: best_header=row_index; best_time_count=time_count
        if len(values)>max(roster_cols) and values[roster_cols[0]] and values[roster_cols[1]]: roster.append(values[roster_cols[0]])
    if best_header<0 or best_header+1>=len(block): raise RuntimeError('timeline time header was not found')
    next_values=[cell_text(x) for x in block[best_header+1]][3:]
    timeline_names=[value for value in next_values if value and value not in ('主播','助理','时间','不断播','暂无','无')]
    if not any(any('\u4e00'<=char<='\u9fff' for char in name) for name in timeline_names): raise RuntimeError('timeline has no readable Chinese anchor names')
    if not roster: raise RuntimeError('attendance roster columns are empty')
    return f'row={start} marker={marker.replace(chr(10),"/")} roster={len(roster)}'

def chat(chat_id):
    qs=urllib.parse.urlencode({'container_id_type':'chat','container_id':chat_id,'page_size':20,'sort_type':'ByCreateTimeDesc'})
    data=req('/im/v1/messages?'+qs,token=token)
    items=data.get('items') or []
    if not items: raise RuntimeError('chat returned no recent messages')
    types={x.get('msg_type') for x in items}
    return 'messages=%s types=%s'%(len(items),','.join(sorted(str(x) for x in types)))

check('KPI目标汇总',lambda:wiki('Lb2vwOidyiViRBkGLIHcfTP5nWe'))
check('直播月度规划',lambda:wiki('IFpowLFu1iiVzZk3kehc4QmUn8b'))
check('早报文档',lambda:wiki('FTFEwNQdEiLfx6kfGnEcPydonmc'))
check('抖店备用根数据',lambda:sheet_values('YB0osgtwbhvUdutIiJQcy2Elnmg','l5eJH0!A1:Z1200'))
check('视频号备用根数据节点',lambda:wiki('VvyAwiXd7ifxcTkoiaLcSU9BnjT'))
check('视频号备用根数据表',lambda:sheet_values('VvyAwiXd7ifxcTkoiaLcSU9BnjT','ULkveo!A1:W1200'),critical=False)
check('官旗最新班表',lambda:schedule_source('官旗','NYB2iu','Q',(15,16)))
check('品牌精选最新班表',lambda:schedule_source('品牌精选','MVpDv0','L',(1,2)))
check('优选最新班表',lambda:schedule_source('优选','LRAvIU','L',(1,2)))
check('王鸥美肤最新班表',lambda:schedule_source('王鸥美肤','PhlV42','K',(1,2)))
check('主播周排名群',lambda:chat('oc_c85a6a939535461dc437e7aada39e0a5'))
check('新人主播审核群',lambda:chat('oc_b66a4cb78495045fce0caed731d7870e'))

print('SOURCE_SUMMARY | blocked=%s warnings=%s'%(','.join(blocked) or 'none',','.join(warnings) or 'none'))
if blocked: raise SystemExit(2)
PY
then blockers=$((blockers + 1)); fi

if [ "$blockers" -gt 0 ]; then
  echo "PREFLIGHT_RESULT=blocked blockers=$blockers"
  exit 2
fi
echo 'PREFLIGHT_RESULT=passed blockers=0'
