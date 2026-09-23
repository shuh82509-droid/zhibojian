import datetime, json, os, re, urllib.parse, urllib.request, urllib.error

BASE='https://open.feishu.cn/open-apis'
BOOK='EuYqssm4WhNwAvtyybKcDdk1ned'
SHEET='PhlV42'
TARGET=datetime.date(2026,8,18)

def request(path, method='GET', body=None, token=None):
    data=None if body is None else json.dumps(body).encode()
    headers={'Content-Type':'application/json; charset=utf-8'}
    if token: headers['Authorization']='Bearer '+token
    req=urllib.request.Request(BASE+path,data=data,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=50) as response:
            raw=response.read().decode('utf-8','replace')
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode('utf-8','replace')[:500]) from error
    payload=json.loads(raw)
    if payload.get('code') not in (None,0): raise RuntimeError(f"{payload.get('code')}: {payload.get('msg')}")
    return payload.get('data') or payload

auth=request('/auth/v3/tenant_access_token/internal','POST',{'app_id':os.environ['FEISHU_APP_ID'],'app_secret':os.environ['FEISHU_APP_SECRET']})
token=auth['tenant_access_token']
query='?valueRenderOption=ToString&dateTimeRenderOption=FormattedString'
area=urllib.parse.quote(f'{SHEET}!A1:O1200',safe='')
data=request(f'/sheets/v2/spreadsheets/{BOOK}/values/{area}{query}',token=token)
rows=(data.get('valueRange') or {}).get('values') or []

def text(value):
    if value is None: return ''
    return str(value).replace('\n',' ').strip()

def compact(row):
    parts=[]
    for index,value in enumerate(row[:15]):
        value=text(value)
        if value and value.lower()!='none': parts.append(f'{chr(65+index)}={value[:140]}')
    return ' | '.join(parts)

weekday_chars='一二三四五六日天'
weekday_index={'一':0,'二':1,'三':2,'四':3,'五':4,'六':5,'日':6,'天':6}
date_markers=[]
for index,row in enumerate(rows):
    for column,value in enumerate(row[:15]):
        value=text(value)
        match=re.search(r'(?:(20\d{2})[年/.-])?(\d{1,2})月?(?:/|\.|-)?(\d{1,2})日?',value)
        chinese=re.search(r'(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日',value)
        chosen=chinese or match
        if not chosen: continue
        year_raw,month_raw,day_raw=chosen.groups()
        month,day=int(month_raw),int(day_raw)
        if not (1<=month<=12 and 1<=day<=31): continue
        week=re.search(r'星期(['+weekday_chars+'])',value)
        date_markers.append({'row':index,'col':column,'value':value,'year':int(year_raw) if year_raw else None,'month':month,'day':day,'weekday':weekday_index[week.group(1)] if week else None})

print(f'SHEET_ROWS={len(rows)} TARGET={TARGET.isoformat()} TARGET_WEEKDAY={TARGET.weekday()}')
print('=== BOTTOM_MOST_DATE_MARKERS ===')
for marker in reversed(date_markers[-24:]):
    print(f"DATE_MARKER | row={marker['row']+1} col={chr(65+marker['col'])} value={marker['value']} year={marker['year']} weekday={marker['weekday']}")

candidates=[]
for marker in date_markers:
    if marker['month']!=TARGET.month or marker['day']!=TARGET.day: continue
    if marker['year'] is not None and marker['year']!=TARGET.year: continue
    if marker['weekday'] is not None and marker['weekday']!=TARGET.weekday(): continue
    candidates.append(marker)

print('=== EXACT_TARGET_CANDIDATES ===')
for marker in reversed(candidates):
    print(f"CANDIDATE | row={marker['row']+1} col={chr(65+marker['col'])} value={marker['value']}")
if not candidates:
    raise SystemExit('NO_EXACT_2026_08_18_TUESDAY_BLOCK')

selected=candidates[-1]
start=max(0,selected['row']-12)
end=min(len(rows),selected['row']+1)
# Include rows until the next date marker after the selected header.
next_rows=[m['row'] for m in date_markers if m['row']>selected['row'] and m['col']==selected['col']]
if next_rows: end=min(len(rows),next_rows[0])
else: end=min(len(rows),selected['row']+40)
print(f"SELECTED_BLOCK | row={selected['row']+1} col={chr(65+selected['col'])} context={start+1}:{end}")
print('=== HEADER_CONTEXT_AND_FULL_BLOCK_A_TO_O ===')
for index in range(start,end):
    value=compact(rows[index])
    if value: print(f'ROW {index+1} | {value}')
print('SCHEDULE_EXACT_INSPECTION=complete')
