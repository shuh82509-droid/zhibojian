#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

APP_DIR = "/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench"
ENV_PATH = os.path.join(APP_DIR, ".env.coco")
TARGET_NAME = "刘慧迅"
CHAT_IDS = (
    "oc_b66a4cb78495045fce0caed731d7870e",
    "oc_3f92ef62d6160399ee823e74def199e6",
    "oc_e95b6981d8491910c7291626743ed149",
)
PROJECT = {
    "project_name": "live-center-workbench",
    "project_type": "docker",
    "access_url": "https://app.fandow.top/fd-027340/live-center-workbench/",
}


def request_json(url, method="GET", headers=None, body=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {payload[:800]}") from error


def load_env(path):
    values = {}
    with open(path, encoding="utf-8-sig") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key] = value
    return values


def main():
    env = load_env(ENV_PATH)
    app_id = env.get("FEISHU_APP_ID", "")
    app_secret = env.get("FEISHU_APP_SECRET", "")
    if app_id != "cli_aafbc3a80eb8dcf4" or not app_secret:
        raise SystemExit("Coco credentials are missing or incorrect")

    _, token_payload = request_json(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/",
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
        body={"app_id": app_id, "app_secret": app_secret},
    )
    token = token_payload.get("tenant_access_token")
    if not token:
        raise SystemExit("Coco tenant token request failed")
    auth = {"Authorization": f"Bearer {token}"}

    matched_ids = set()
    for chat_id in CHAT_IDS:
        page_token = ""
        while True:
            query = {"member_id_type": "user_id", "page_size": "100"}
            if page_token:
                query["page_token"] = page_token
            url = (
                f"https://open.feishu.cn/open-apis/im/v1/chats/{chat_id}/members?"
                + urllib.parse.urlencode(query)
            )
            _, payload = request_json(url, headers=auth)
            if payload.get("code") not in (None, 0):
                raise SystemExit(f"Coco chat-member lookup failed: {payload.get('msg', 'unknown error')}")
            data = payload.get("data") or {}
            for member in data.get("items") or []:
                if str(member.get("name", "")).strip() == TARGET_NAME:
                    member_id = str(member.get("member_id", "")).strip()
                    if member_id:
                        matched_ids.add(member_id)
            if not data.get("has_more"):
                break
            page_token = str(data.get("page_token", ""))
            if not page_token:
                break

    if len(matched_ids) != 1:
        raise SystemExit(f"Expected one Feishu user named {TARGET_NAME}; found {len(matched_ids)} unique IDs")
    feishu_user_id = next(iter(matched_ids))
    print("FEISHU_USER_MATCH=unique")

    query = urllib.parse.urlencode({
        "employee_number": "FD-027340",
        "project_name": PROJECT["project_name"],
        "project_type": PROJECT["project_type"],
        "access_url": PROJECT["access_url"],
        "page": 1,
        "page_size": 20,
    })
    _, existing = request_json(f"http://127.0.0.1:11123/api/project-records?{query}")
    items = existing.get("items") or existing.get("data", {}).get("items") or []
    exact = [item for item in items if
             str(item.get("employee_number", "")).upper() == "FD-027340"
             and item.get("project_name") == PROJECT["project_name"]
             and item.get("project_type") == PROJECT["project_type"]
             and item.get("access_url") == PROJECT["access_url"]]
    if exact:
        print("PROJECT_RECORD_SYNC=skipped_unchanged")
        return

    payload = dict(PROJECT)
    payload["feishu_user_id"] = feishu_user_id
    status, created = request_json(
        "http://127.0.0.1:11123/api/project-records",
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
        body=payload,
    )
    if status != 201:
        raise SystemExit(f"Unexpected project-record status: {status}")
    if (str(created.get("employee_number", "")).upper() != "FD-027340"
            or created.get("project_name") != PROJECT["project_name"]
            or created.get("project_type") != PROJECT["project_type"]
            or created.get("access_url") != PROJECT["access_url"]):
        raise SystemExit("Created project record did not match the requested project")
    print("PROJECT_RECORD_SYNC=created")


if __name__ == "__main__":
    main()
