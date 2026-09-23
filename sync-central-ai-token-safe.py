#!/usr/bin/env python3
"""Create the live-center Jump AI env from the current central service credential."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess


SOURCE_CONTAINER = "fd-026222-wis-video-center"
TARGET_ENV = Path("/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench/.env.jump")


def source_token() -> str:
    raw = subprocess.check_output(["sudo", "docker", "inspect", SOURCE_CONTAINER], text=True, encoding="utf-8")
    environment = json.loads(raw)[0]["Config"]["Env"]
    for key in ("JUMP_LLM_TOKEN", "FANDOW_DATA_MCP_TOKEN", "FANDOM_DATA_MCP_TOKEN"):
        prefix = f"{key}="
        for item in environment:
            if item.startswith(prefix) and item[len(prefix):].strip():
                return item[len(prefix):].strip()
    raise RuntimeError(f"{SOURCE_CONTAINER} has no reusable central AI credential")


def main() -> None:
    token = source_token()
    content = "\n".join([
        f"JUMP_LLM_TOKEN={token}",
        "JUMP_LLM_URL=https://cloud.fandow.com/gpt/interface/chat/completions",
        "JUMP_LLM_APPLICATION=pingying_zhongshu",
        "JUMP_LLM_PROVIDER=deepseek",
        "JUMP_LLM_MODEL=deepseek-v4-pro",
        "JUMP_LLM_VISION_MODEL=deepseek-v4-flash-vision-exp",
        "",
    ])
    temporary = TARGET_ENV.with_name(f".{TARGET_ENV.name}.sync-{os.getpid()}")
    temporary.write_text(content, encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, TARGET_ENV)
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()[:12]
    print(f"CENTRAL_AI_TOKEN_SYNC=passed sha256={digest}")


if __name__ == "__main__":
    main()
