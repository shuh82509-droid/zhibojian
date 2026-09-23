#!/usr/bin/env python3
"""Read-only direct Coco permission report; credentials and content never leave the server."""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

APP_DIR = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'
ENV_PATH = os.path.join(APP_DIR, '.env.coco')
URL_PATTERN = re.compile(r'https://jqx28l0j4lx\.feishu\.cn/(?:wiki|docx)/[A-Za-z0-9_-]+')

def env_value(name):
    with open(ENV_PATH, encoding='utf-8') as handle:
        for line in handle:
            if line.startswith(name + '='):
                return line.rstrip('\r\n').split('=', 1)[1]
    return ''

def request(path, token=None, method='GET', payload=None):
    headers = {'Content-Type': 'application/json; charset=utf-8'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request('https://open.feishu.cn/open-apis' + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode('utf-8', 'replace') or '{}')
    except Exception as exc:
        return 0, {'msg': str(exc)}

def main():
    app_id, app_secret = env_value('FEISHU_APP_ID'), env_value('FEISHU_APP_SECRET')
    if not app_id or not app_secret:
        raise SystemExit('Coco credentials are missing.')
    status, auth = request('/auth/v3/tenant_access_token/internal/', method='POST', payload={'app_id': app_id, 'app_secret': app_secret})
    token = auth.get('tenant_access_token')
    if status != 200 or auth.get('code') != 0 or not token:
        raise SystemExit('Could not obtain a Coco tenant token.')
    paths = [os.path.join(APP_DIR, 'server.js')]
    material_root = os.path.join(APP_DIR, 'public/modules/materials')
    for root, _, files in os.walk(material_root):
        paths.extend(os.path.join(root, filename) for filename in files)
    urls = set()
    for path in paths:
        try:
            with open(path, encoding='utf-8', errors='ignore') as handle:
                urls.update(URL_PATTERN.findall(handle.read()))
        except OSError:
            continue
    urls = sorted(urls)
    print('=== Direct Coco document permission report ===')
    readable = denied = 0
    for source in urls:
        match = re.search(r'/(wiki|docx)/([A-Za-z0-9_-]+)$', source)
        kind, identifier = match.groups()
        title = '飞书文档'
        if kind == 'wiki':
            code, node_result = request('/wiki/v2/spaces/get_node?token=' + urllib.parse.quote(identifier), token)
            node = node_result.get('data', {}).get('node', {}) if isinstance(node_result, dict) else {}
            if code != 200 or node_result.get('code') != 0 or not node.get('obj_token'):
                denied += 1
                print(f'DENIED | {source} | {node_result.get("msg", "unknown error")}')
                continue
            title = node.get('title') or title
            identifier = node['obj_token']
        code, doc_result = request('/docx/v1/documents/' + urllib.parse.quote(identifier) + '/raw_content', token)
        if code == 200 and doc_result.get('code') == 0:
            readable += 1
            print(f'READABLE | {title} | {source}')
        else:
            denied += 1
            print(f'DENIED | {title} | {source} | {doc_result.get("msg", "unknown error")}')
    print(f'SUMMARY | readable={readable} denied={denied}')

if __name__ == '__main__':
    main()
