import datetime, json, os, re, urllib.parse, urllib.request, urllib.error

BASE = 'https://open.feishu.cn/open-apis'

def request(path, method='GET', body=None, token=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {'Content-Type': 'application/json; charset=utf-8'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=50) as response:
            raw = response.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as error:
        raw = error.read().decode('utf-8', 'replace')
        raise RuntimeError(f'HTTP {error.code}: {raw[:400]}') from error
    payload = json.loads(raw)
    if payload.get('code') not in (None, 0):
        raise RuntimeError(f"{payload.get('code')}: {payload.get('msg')}")
    return payload.get('data') or payload

auth = request('/auth/v3/tenant_access_token/internal', 'POST', {
    'app_id': os.environ['FEISHU_APP_ID'],
    'app_secret': os.environ['FEISHU_APP_SECRET'],
})
token = auth['tenant_access_token']

def wiki_object(wiki_token):
    data = request('/wiki/v2/spaces/get_node?token=' + urllib.parse.quote(wiki_token), token=token)
    return data.get('node') or {}

def sheet_list(book):
    data = request(f'/sheets/v3/spreadsheets/{urllib.parse.quote(book)}/sheets/query?page_size=100', token=token)
    return data.get('sheets') or data.get('items') or []

def read(book, area):
    query = '?valueRenderOption=ToString&dateTimeRenderOption=FormattedString'
    path = f'/sheets/v2/spreadsheets/{urllib.parse.quote(book)}/values/{urllib.parse.quote(area, safe="")}{query}'
    data = request(path, token=token)
    return (data.get('valueRange') or {}).get('values') or []

def compact(row):
    values = []
    for index, value in enumerate(row):
        if value is None:
            continue
        text = str(value).replace('\n', ' ').strip()
        if text and text.lower() != 'none':
            values.append(f'{index + 1}:{text[:100]}')
    return ' | '.join(values)

def nonempty(row):
    return any(value is not None and str(value).strip() and str(value).strip().lower() != 'none' for value in row)

def latest_rows(book, sheet_id, row_count, end_col, wanted=8):
    found = []
    end = row_count
    # Grid row_count often includes thousands of formatted but empty rows.
    # Read backwards in bounded chunks and stop at the newest real data block.
    for _ in range(12):
        start = max(1, end - 499)
        values = read(book, f'{sheet_id}!A{start}:{end_col}{end}')
        actual = [(start + index, row) for index, row in enumerate(values) if nonempty(row)]
        if actual:
            found = actual[-wanted:]
            break
        if start == 1:
            break
        end = start - 1
    return found

def grid(sheet):
    props = sheet.get('grid_properties') or sheet.get('gridProperties') or {}
    return int(props.get('row_count') or props.get('rowCount') or 1200), int(props.get('column_count') or props.get('columnCount') or 26)

def inspect_book(label, book, focus=None):
    print(f'\n=== {label} ===')
    sheets = sheet_list(book)
    for sheet in sheets:
        sid = sheet.get('sheet_id') or sheet.get('sheetId')
        title = sheet.get('title') or ''
        rows, cols = grid(sheet)
        print(f'SHEET | {sid} | {title} | rows={rows} cols={cols}')
    chosen = [s for s in sheets if not focus or focus(s)]
    for sheet in chosen[:8]:
        sid = sheet.get('sheet_id') or sheet.get('sheetId')
        title = sheet.get('title') or ''
        rows, cols = grid(sheet)
        end_col = 'Z' if cols <= 26 else 'AZ'
        header_rows = [(i + 1, row) for i, row in enumerate(read(book, f'{sid}!A1:{end_col}25')) if nonempty(row)]
        print(f'-- HEADERS {sid} {title}')
        for row_number, row in header_rows[:8]:
            print(f'HEADER {row_number} | {compact(row)}')
        tail = latest_rows(book, sid, rows, end_col)
        print(f'-- LATEST_REAL_ROWS {sid} {title} count={len(tail)}')
        for row_number, row in tail:
            print(f'ROW {row_number} | {compact(row)}')

important_douyin = {'官旗数据（2.23后）', '品牌精选', '优选', '王鸥美肤'}
inspect_book('抖店根数据工作簿', 'YB0osgtwbhvUdutIiJQcy2Elnmg', lambda s: (s.get('title') or '') in important_douyin)

video_node = wiki_object('VvyAwiXd7ifxcTkoiaLcSU9BnjT')
video_book = video_node.get('obj_token')
print(f"\nVIDEO_NODE | type={video_node.get('obj_type')} token_present={bool(video_book)} title={video_node.get('title')}")
if video_book:
    inspect_book('视频号渠道根数据工作簿', video_book, lambda s: True)

kpi_node = wiki_object('Lb2vwOidyiViRBkGLIHcfTP5nWe')
kpi_book = kpi_node.get('obj_token')
print(f"\nKPI_NODE | type={kpi_node.get('obj_type')} token_present={bool(kpi_book)} title={kpi_node.get('title')}")
if kpi_book:
    kpi_sheets = sheet_list(kpi_book)
    for sheet in kpi_sheets:
        title = sheet.get('title') or ''
        if '2026年8月' not in title:
            continue
        sid = sheet.get('sheet_id') or sheet.get('sheetId')
        print(f'KPI_SHEET | {sid} | {title}')
        for index, row in enumerate(read(kpi_book, f'{sid}!A1:H40'), 1):
            if any(word in str(row) for word in ('GSV', 'GMV', '直播间')):
                print(f'KPI_ROW {index} | {compact(row)}')

print('\n=== 班表底部最新日期区块 ===')
schedule = read('EuYqssm4WhNwAvtyybKcDdk1ned', 'PhlV42!A1:O1200')
date_rows = []
weekday_map = {'一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6, '天': 6}
for index in range(len(schedule) - 1, -1, -1):
    row = schedule[index]
    text = str(row[0] if row else '')
    match = re.search(r'(\d{1,2})月(\d{1,2})日', text)
    if not match:
        continue
    weekday = re.search(r'星期([一二三四五六日天])', text)
    inferred = []
    for year in range(datetime.date.today().year + 1, datetime.date.today().year - 4, -1):
        try:
            value = datetime.date(year, int(match.group(1)), int(match.group(2)))
        except ValueError:
            continue
        if not weekday or value.weekday() == weekday_map[weekday.group(1)]:
            inferred.append(str(year))
    date_rows.append((index, text.replace('\n', ' '), inferred))
    if len(date_rows) >= 16:
        break
for index, label, inferred in date_rows:
    print(f'DATE_BLOCK | row={index + 1} | label={label} | inferred_years={",".join(inferred) or "unknown"}')
if date_rows:
    newest_index = date_rows[0][0]
    print('-- NEWEST_BLOCK_ROWS (bottom-most date block only)')
    for index in range(newest_index, min(len(schedule), newest_index + 20)):
        row = schedule[index]
        cells = [row[i] if i < len(row) else '' for i in (0, 1, 2, 13, 14)]
        if any(value is not None and str(value).strip() for value in cells):
            print(f'SCHEDULE_ROW {index + 1} | A={cells[0]} | B={cells[1]} | C={cells[2]} | N={cells[3]} | O={cells[4]}')

print('\nSOURCE_SCHEMA_INSPECTION=complete')
