#!/usr/bin/env python3
"""Atomically reuse the current central video-center MCP credential without printing it."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess


SOURCE_CONTAINER = "fd-026222-wis-video-center"
TARGET_ENV = Path("/home/fandow-deploy/fandow-apps/runtime/fd-027340/data-center/.env")
KEY = "FANDOW_DATA_MCP_TOKEN"


def source_token() -> str:
    raw = subprocess.check_output(
        ["sudo", "docker", "inspect", SOURCE_CONTAINER],
        text=True,
        encoding="utf-8",
    )
    containers = json.loads(raw)
    environment = containers[0]["Config"]["Env"]
    prefix = f"{KEY}="
    for item in environment:
        if item.startswith(prefix):
            value = item[len(prefix):].strip()
            if value:
                return value
    raise RuntimeError(f"{SOURCE_CONTAINER} does not expose a configured {KEY}")


def main() -> None:
    token = source_token()
    original = TARGET_ENV.read_text(encoding="utf-8")
    lines = original.splitlines()
    replacement = f"{KEY}={token}"
    found = False
    updated: list[str] = []
    for line in lines:
        if line.startswith(f"{KEY}="):
            if not found:
                updated.append(replacement)
                found = True
            continue
        updated.append(line)
    if not found:
        updated.append(replacement)

    target_text = "\n".join(updated) + "\n"
    temporary = TARGET_ENV.with_name(f".{TARGET_ENV.name}.token-sync-{os.getpid()}")
    temporary.write_text(target_text, encoding="utf-8")
    os.chmod(temporary, TARGET_ENV.stat().st_mode & 0o777)
    os.replace(temporary, TARGET_ENV)
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()[:12]
    print(f"DATA_MCP_TOKEN_SYNC=passed sha256={digest}")


if __name__ == "__main__":
    main()
