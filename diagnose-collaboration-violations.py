#!/usr/bin/env python3
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

BASE = "https://open.feishu.cn/open-apis"
CHAT_ID = "oc_a1f32ee1874fa98271d3bb19522abbb8"
KEYWORDS = re.compile(r"违规|处罚|警告|扣分|判罚|限流|封禁|禁播|断播|敏感词|导流|虚假宣传|夸大宣传|风险提示|申诉|整改")
NEGATIVE = re.compile(r"无违规|未违规|暂无违规|未发现违规|没有违规|0\s*次违规|零违规")


def load_env(path):
    values = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def request_json(url, *, method="GET", headers=None, data=None):
    body = None if data is None else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8", "replace")
            return response.status, json.loads(raw)
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"raw": raw[:500]}
        return error.code, payload


def compact_error(status, payload):
    return {
        "http": status,
        "code": payload.get("code"),
        "msg": str(payload.get("msg") or payload.get("message") or payload.get("raw") or "")[:500],
    }


def extract_text(raw):
    try:
        value = json.loads(raw or "{}")
    except Exception:
        return str(raw or "")
    parts = []

    def visit(item):
        if isinstance(item, list):
            for child in item:
                visit(child)
        elif isinstance(item, dict):
            for key, child in item.items():
                if key in ("text", "title") and isinstance(child, str):
                    parts.append(child)
                elif key not in ("image_key", "file_key"):
                    visit(child)

    visit(value)
    return "\n".join(dict.fromkeys(part.strip() for part in parts if part.strip()))


def main():
    env_path = sys.argv[1]
    env = load_env(env_path)
    app_id = env.get("FEISHU_APP_ID", "")
    app_secret = env.get("FEISHU_APP_SECRET", "")
    print("=== Coco direct chat diagnostic (credentials redacted) ===")
    print("CREDENTIALS | app_id=%s | app_secret=%s" % ("present" if app_id else "missing", "present" if app_secret else "missing"))
    if not app_id or not app_secret:
        print("DIAGNOSTIC_BLOCKED | missing server-side Coco credentials")
        return 2

    status, token_payload = request_json(
        BASE + "/auth/v3/tenant_access_token/internal/",
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
        data={"app_id": app_id, "app_secret": app_secret},
    )
    token = token_payload.get("tenant_access_token", "")
    if status != 200 or token_payload.get("code") != 0 or not token:
        print("TOKEN_FAIL | " + json.dumps(compact_error(status, token_payload), ensure_ascii=False))
        return 3
    print("TOKEN_OK")
    auth = {"Authorization": "Bearer " + token}

    chat_status, chat_payload = request_json(BASE + "/im/v1/chats/" + CHAT_ID, headers=auth)
    if chat_status == 200 and chat_payload.get("code") == 0:
        chat = (chat_payload.get("data") or {}).get("chat") or {}
        print("CHAT_GET_OK | name=%s" % (chat.get("name") or CHAT_ID))
    else:
        print("CHAT_GET_FAIL | " + json.dumps(compact_error(chat_status, chat_payload), ensure_ascii=False))

    list_status, list_payload = request_json(BASE + "/im/v1/chats?page_size=20", headers=auth)
    if list_status == 200 and list_payload.get("code") == 0:
        items = (list_payload.get("data") or {}).get("items") or []
        visible = any(item.get("chat_id") == CHAT_ID for item in items if isinstance(item, dict))
        print("CHAT_LIST_OK | first_page=%d | target_visible=%s" % (len(items), str(visible).lower()))
    else:
        print("CHAT_LIST_FAIL | " + json.dumps(compact_error(list_status, list_payload), ensure_ascii=False))

    all_items = []
    page_token = ""
    for _ in range(10):
        params = {
            "container_id_type": "chat",
            "container_id": CHAT_ID,
            "sort_type": "ByCreateTimeDesc",
            "page_size": "50",
        }
        if page_token:
            params["page_token"] = page_token
        url = BASE + "/im/v1/messages?" + urllib.parse.urlencode(params)
        msg_status, msg_payload = request_json(url, headers=auth)
        if msg_status != 200 or msg_payload.get("code") != 0:
            print("MESSAGES_FAIL | " + json.dumps(compact_error(msg_status, msg_payload), ensure_ascii=False))
            return 4
        data = msg_payload.get("data") or {}
        all_items.extend(data.get("items") or [])
        page_token = data.get("page_token") or ""
        if not data.get("has_more") or not page_token:
            break

    type_counts = Counter(str(item.get("msg_type") or "unknown") for item in all_items if isinstance(item, dict))
    matches = []
    text_messages = 0
    for item in all_items:
        if not isinstance(item, dict):
            continue
        text = extract_text(((item.get("body") or {}).get("content")))
        if text:
            text_messages += 1
        normalized = re.sub(r"\s+", " ", text).strip()
        if normalized and KEYWORDS.search(normalized) and not NEGATIVE.search(normalized):
            matches.append({
                "message_id": str(item.get("message_id") or "")[-12:],
                "create_time": item.get("create_time"),
                "msg_type": item.get("msg_type"),
                "preview": normalized[:180],
            })
    print("MESSAGES_OK | scanned=%d | text_bearing=%d | keyword_matches=%d" % (len(all_items), text_messages, len(matches)))
    print("MESSAGE_TYPES | " + json.dumps(dict(type_counts), ensure_ascii=False, sort_keys=True))
    for match in matches[:8]:
        print("MATCH | " + json.dumps(match, ensure_ascii=False))
    print("DIRECT_CHAT_RESULT=passed")

    live_url = "http://127.0.0.1:24500/fd-027340/live-center-workbench/modules/tasks/api/violations?refresh=1"
    live_status, live_payload = request_json(live_url)
    summary = {
        "http": live_status,
        "ok": live_payload.get("ok"),
        "source": live_payload.get("source"),
        "messagesScanned": live_payload.get("messagesScanned"),
        "rows": len(live_payload.get("rows") or []),
        "error": str(live_payload.get("error") or "")[:500],
    }
    print("CURRENT_PRODUCTION_ENDPOINT | " + json.dumps(summary, ensure_ascii=False))
    print("DIAGNOSTIC_COMPLETE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
