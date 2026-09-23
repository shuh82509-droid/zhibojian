#!/usr/bin/env python3
"""Verify Fandow Docker deployments after Nginx reload."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


def run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, capture_output=True)


def fail(message: str, details: dict | None = None, code: int = 2) -> None:
    payload = {"ok": False, "error": message}
    if details:
        payload.update(details)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    raise SystemExit(code)


def ensure_dir(path: Path, label: str) -> None:
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        fail(f"Could not initialize {label}.", {"path": str(path), "detail": str(exc)})


def docker_status(container: str) -> str:
    proc = run(["docker", "inspect", container, "--format", "{{.State.Status}}"])
    if proc.returncode != 0:
        fail("Container inspect failed.", {"container": container, "stderr": proc.stderr.strip()})
    return proc.stdout.strip()


def docker_ports(container: str) -> str:
    proc = run(["docker", "port", container])
    if proc.returncode != 0:
        return ""
    return proc.stdout.strip()


def owns_localhost_port(ports: str, host_port: int) -> bool:
    return re.search(rf"(?:^|\s|->)127\.0\.0\.1:{host_port}(?:\s|$)", ports) is not None


def fetch_url(url: str, retries: int, delay: float) -> tuple[str, int]:
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "fandow-deploy-check/1.0"})
            with urllib.request.urlopen(request, timeout=20) as response:
                body = response.read(1024 * 1024).decode("utf-8", errors="replace")
                return body, response.getcode()
        except urllib.error.HTTPError as exc:
            last_error = f"HTTP {exc.code}: {exc.read(500).decode('utf-8', errors='replace')}"
        except urllib.error.URLError as exc:
            last_error = str(exc.reason)
        if attempt < retries:
            time.sleep(delay)
    fail("Public URL verification failed.", {"url": url, "last_error": last_error})


def page_title(html: str) -> str:
    match = TITLE_RE.search(html)
    if not match:
        return ""
    return re.sub(r"\s+", " ", match.group(1)).strip()


def verify_fingerprint(html: str, fingerprint: str | None, regex: bool) -> dict:
    title = page_title(html)
    if not fingerprint:
        return {"fingerprint_checked": False, "title": title}
    if regex:
        matched = re.search(fingerprint, html, re.S) is not None
    else:
        matched = fingerprint in html or fingerprint in title
    if not matched:
        fail("Content fingerprint mismatch.", {
            "expected_fingerprint": fingerprint,
            "title": title,
            "fingerprint_regex": regex,
        })
    return {"fingerprint_checked": True, "title": title, "fingerprint": fingerprint}


def rollback(args: argparse.Namespace, reason: str) -> dict:
    results: dict[str, object] = {"rollback": True, "reason": reason, "actions": []}
    nginx_conf = Path(args.nginx_conf) if args.nginx_conf else None
    if nginx_conf and nginx_conf.exists():
        backup_dir = Path(args.backup_dir)
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / f"{nginx_conf.name}.{int(time.time())}.bak"
        nginx_conf.replace(backup)
        results["actions"].append({"action": "backup_nginx_conf", "backup": str(backup)})
        if run(["nginx", "-t"]).returncode == 0:
            run(["nginx", "-s", "reload"])
            results["actions"].append({"action": "nginx_reload"})
    if args.container:
        run(["docker", "rm", "-f", args.container])
        results["actions"].append({"action": "docker_rm", "container": args.container})
    if args.port_manager and args.employee_id and args.app_name:
        proc = run([
            sys.executable,
            args.port_manager,
            "mark",
            "--employee-id", args.employee_id,
            "--app-name", args.app_name,
            "--status", "failed",
            "--reason", reason,
        ])
        results["actions"].append({"action": "mark_failed", "returncode": proc.returncode})
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify a Fandow deployment.")
    parser.add_argument("--container", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--host-port", type=int, required=True)
    parser.add_argument("--fingerprint")
    parser.add_argument("--fingerprint-regex", action="store_true")
    parser.add_argument("--employee-id")
    parser.add_argument("--app-name")
    parser.add_argument("--nginx-conf")
    parser.add_argument("--rollback", action="store_true")
    parser.add_argument("--backup-dir", default="/etc/nginx/backups")
    parser.add_argument("--port-manager", default="/usr/local/fandow-deploy/port-manager.py")
    parser.add_argument("--retries", type=int, default=5)
    parser.add_argument("--delay", type=float, default=2.0)
    args = parser.parse_args()

    ensure_dir(Path(args.backup_dir), "Nginx backup directory")

    try:
        status = docker_status(args.container)
        if status != "running":
            fail("Container is not running.", {"container": args.container, "status": status})
        ports = docker_ports(args.container)
        if not owns_localhost_port(ports, args.host_port):
            fail("Container port mapping does not include the expected localhost host port.", {
                "container": args.container,
                "host_port": args.host_port,
                "ports": ports,
            })
        html, status_code = fetch_url(args.url, args.retries, args.delay)
        fingerprint_result = verify_fingerprint(html, args.fingerprint, args.fingerprint_regex)
    except SystemExit as exc:
        if args.rollback:
            rollback_result = rollback(args, "post_deploy_check_failed")
            print(json.dumps(rollback_result, ensure_ascii=False, indent=2))
        raise exc

    result = {
        "ok": True,
        "container": args.container,
        "status": status,
        "host_port": args.host_port,
        "url": args.url,
        "status_code": status_code,
        **fingerprint_result,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
