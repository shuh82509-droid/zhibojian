#!/usr/bin/env python3
"""Manage Fandow Docker deployment port ownership on the server."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path


DEFAULT_MAP_PATH = Path("/etc/fandow-deploy/port-map.json")
DEFAULT_LOCK_PATH = Path("/etc/fandow-deploy/port-map.lock")
DEFAULT_RANGES = "18000-19999,28000-29999,30000-39999"
EMPLOYEE_RE = re.compile(r"^[a-z]{2}-[0-9]+$")
APP_RE = re.compile(r"^[a-z][a-z0-9-]{1,40}$")
PROJECT_CONF_RE = re.compile(r"^(?P<employee_id>[a-z]{2}-[0-9]+)-(?P<app_name>[a-z][a-z0-9-]{1,40})\.conf$")
PROJECT_CONTAINER_RE = re.compile(r"^(?P<employee_id>[a-z]{2}-[0-9]+)-(?P<app_name>[a-z][a-z0-9-]{1,40})$")
DOCKER_HOST_PORT_RE = re.compile(r"(?:127\.0\.0\.1:|0\.0\.0\.0:|\[::\]:|:::)(\d+)->")
LOCALHOST_PORT_RE = re.compile(r"(?:127\.0\.0\.1|localhost):(\d+)")


def fail(message: str, code: int = 2) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    raise SystemExit(code)


def run(args: list[str]) -> str:
    proc = subprocess.run(args, text=True, capture_output=True)
    if proc.returncode != 0:
        return ""
    return proc.stdout


def parse_ranges(raw: str) -> list[int]:
    ports: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            start, end = int(start_s), int(end_s)
            ports.extend(range(start, end + 1))
        else:
            ports.append(int(part))
    return ports


def load_map(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return {}
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"Invalid port map JSON: {exc}")
    if not isinstance(data, dict):
        fail("Port map root must be an object.")
    return data


def ensure_map_file(path: Path) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        needs_write = not path.exists() or not path.read_text(encoding="utf-8").strip()
        if needs_write:
            atomic_write_json(path, {})
            try:
                os.chmod(path, 0o664)
            except OSError:
                pass
    except OSError as exc:
        fail(f"Could not initialize port map at {path}: {exc}")


def atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name, suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(tmp_name, path)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass


def lock_file(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+", encoding="utf-8")
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    return handle


def validate_project(employee_id: str, app_name: str) -> tuple[str, str]:
    employee_id = employee_id.lower()
    app_name = app_name.lower()
    if not EMPLOYEE_RE.fullmatch(employee_id):
        fail(f"Invalid employee id: {employee_id}")
    if not APP_RE.fullmatch(app_name):
        fail(f"Invalid app name: {app_name}")
    return employee_id, app_name


def docker_host_ports(ports_text: str) -> set[int]:
    return {int(match.group(1)) for match in DOCKER_HOST_PORT_RE.finditer(ports_text)}


def docker_inventory() -> dict[str, dict]:
    output = run(["docker", "ps", "-a", "--format", "{{.Names}}\t{{.State}}\t{{.Ports}}"])
    containers: dict[str, dict] = {}
    for line in output.splitlines():
        parts = line.split("\t", 2)
        if len(parts) == 3:
            name, state, ports = parts
        elif len(parts) == 2:
            name, ports = parts
            state = "unknown"
        else:
            continue
        containers[name] = {
            "state": state or "unknown",
            "host_ports": docker_host_ports(ports),
            "ports": ports,
        }
    return containers


def container_port_owners(containers: dict[str, dict] | None = None) -> dict[int, set[str]]:
    if containers is None:
        containers = docker_inventory()
    owners: dict[int, set[str]] = {}
    for name, details in containers.items():
        for port in details.get("host_ports", set()):
            owners.setdefault(int(port), set()).add(name)
    return owners


def nginx_proxy_ports(paths: list[Path]) -> dict[int, set[str]]:
    owners: dict[int, set[str]] = {}
    for root in paths:
        candidates = [root]
        if root.is_dir():
            candidates = list(root.rglob("*.conf"))
        for path in candidates:
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for match in LOCALHOST_PORT_RE.finditer(text):
                owners.setdefault(int(match.group(1)), set()).add(str(path))
    return owners


def nginx_project_routes(paths: list[Path]) -> list[dict]:
    routes: list[dict] = []
    for root in paths:
        candidates = [root]
        if root.is_dir():
            candidates = list(root.rglob("*.conf"))
        for path in candidates:
            if not path.is_file():
                continue
            match = PROJECT_CONF_RE.fullmatch(path.name.lower())
            if not match:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            ports = sorted({int(item.group(1)) for item in LOCALHOST_PORT_RE.finditer(text)})
            if ports:
                routes.append({
                    "employee_id": match.group("employee_id"),
                    "app_name": match.group("app_name"),
                    "path": str(path),
                    "ports": ports,
                })
    return routes


def docker_project_routes(containers: dict[str, dict]) -> list[dict]:
    routes: list[dict] = []
    for name, details in containers.items():
        match = PROJECT_CONTAINER_RE.fullmatch(name.lower())
        if not match:
            continue
        ports = sorted(int(port) for port in details.get("host_ports", set()))
        if ports:
            routes.append({
                "employee_id": match.group("employee_id"),
                "app_name": match.group("app_name"),
                "container": name,
                "container_state": details.get("state", "unknown"),
                "ports": ports,
            })
    return routes


def listener_ports() -> set[int]:
    output = run(["ss", "-ltn"])
    ports: set[int] = set()
    for line in output.splitlines():
        cols = line.split()
        if len(cols) < 4:
            continue
        local = cols[3]
        match = re.search(r":(\d+)$", local)
        if match:
            ports.add(int(match.group(1)))
    return ports


def port_is_bindable(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def map_owner(port_map: dict, port: int) -> tuple[str, str, dict] | None:
    for employee_id, apps in port_map.items():
        if not isinstance(apps, dict):
            continue
        for app_name, record in apps.items():
            if isinstance(record, dict) and int(record.get("host_port", -1)) == port:
                return employee_id, app_name, record
    return None


def choose_port(args: argparse.Namespace, port_map: dict) -> dict:
    employee_id, app_name = validate_project(args.employee_id, args.app_name)
    container = args.container or f"{employee_id}-{app_name}"
    docker_ports = container_port_owners()
    nginx_ports = nginx_proxy_ports([Path(p) for p in args.nginx_path])
    listeners = listener_ports()
    existing = port_map.get(employee_id, {}).get(app_name)
    if isinstance(existing, dict):
        existing_port = existing.get("host_port")
        if isinstance(existing_port, int):
            owner = map_owner(port_map, existing_port)
            docker_conflict = docker_ports.get(existing_port, set()) - {container}
            nginx_conflict = {
                ref for ref in nginx_ports.get(existing_port, set())
                if f"{employee_id}-{app_name}.conf" not in ref
            }
            if owner and owner[0] == employee_id and owner[1] == app_name and not docker_conflict and not nginx_conflict:
                existing.update({
                    "container": container,
                    "status": "reserved",
                    "updated_at": int(time.time()),
                })
                if args.fingerprint:
                    existing["fingerprint"] = args.fingerprint
                return existing

    for port in parse_ranges(args.port_ranges):
        docker_conflict = docker_ports.get(port, set()) - {container}
        if docker_conflict:
            continue
        nginx_conflict = {
            ref for ref in nginx_ports.get(port, set())
            if f"{employee_id}-{app_name}.conf" not in ref
        }
        if nginx_conflict:
            continue
        owner = map_owner(port_map, port)
        if owner and (owner[0], owner[1]) != (employee_id, app_name):
            continue
        if port in listeners:
            continue
        if not port_is_bindable(port):
            continue
        record = {
            "host_port": port,
            "container": container,
            "status": "reserved",
            "updated_at": int(time.time()),
        }
        if args.fingerprint:
            record["fingerprint"] = args.fingerprint
        return record
    fail("No safe host port is available in the candidate pools.")


def route_status(container: dict | None, port: int) -> str:
    if not container:
        return "broken"
    state = str(container.get("state", "unknown"))
    host_ports = container.get("host_ports", set())
    if port not in host_ports:
        return "broken"
    if state == "running":
        return "running"
    return state or "unknown"


def seed_record(port_map: dict, route: dict, source: str, containers: dict[str, dict], repair_stale: bool) -> tuple[str, dict]:
    employee_id, app_name = validate_project(route["employee_id"], route["app_name"])
    ports = route["ports"]
    if len(ports) != 1:
        return "skipped", {
            "reason": "ambiguous_ports",
            "employee_id": employee_id,
            "app_name": app_name,
            "ports": ports,
            "source": source,
        }

    host_port = int(ports[0])
    expected_container = route.get("container") or f"{employee_id}-{app_name}"
    container = containers.get(expected_container)
    status = route_status(container, host_port)
    existing_owner = map_owner(port_map, host_port)
    current = port_map.get(employee_id, {}).get(app_name)

    if existing_owner and (existing_owner[0], existing_owner[1]) != (employee_id, app_name):
        return "conflict", {
            "reason": "port_owned_by_other_project",
            "employee_id": employee_id,
            "app_name": app_name,
            "host_port": host_port,
            "existing_owner": f"{existing_owner[0]}/{existing_owner[1]}",
            "source": source,
        }

    if isinstance(current, dict):
        current_port = current.get("host_port")
        try:
            current_port_normalized = int(current_port)
        except (TypeError, ValueError):
            current_port_normalized = current_port
        if current_port_normalized == host_port:
            return "unchanged", {
                "employee_id": employee_id,
                "app_name": app_name,
                "host_port": host_port,
                "source": source,
            }
        if not repair_stale:
            return "conflict", {
                "reason": "project_has_different_port_in_map",
                "employee_id": employee_id,
                "app_name": app_name,
                "map_port": current_port,
                "discovered_port": host_port,
                "source": source,
            }

    record = {
        "host_port": host_port,
        "container": expected_container,
        "status": status,
        "source": source,
        "seeded_at": int(time.time()),
    }
    if route.get("path"):
        record["nginx_conf"] = route["path"]
    port_map.setdefault(employee_id, {})[app_name] = record
    return "added" if not current else "repaired", {
        "employee_id": employee_id,
        "app_name": app_name,
        **record,
    }


def cmd_bootstrap(args: argparse.Namespace) -> None:
    with lock_file(args.lock_path):
        ensure_map_file(args.map_path)
        port_map = load_map(args.map_path)
        containers = docker_inventory()
        results: dict[str, list[dict]] = {
            "added": [],
            "repaired": [],
            "unchanged": [],
            "conflicts": [],
            "skipped": [],
        }

        discovered: list[tuple[str, dict]] = []
        discovered.extend(("nginx", route) for route in nginx_project_routes([Path(p) for p in args.nginx_path]))
        if args.include_docker_only:
            discovered.extend(("docker", route) for route in docker_project_routes(containers))

        seen: set[tuple[str, str, int]] = set()
        for source, route in discovered:
            ports = route.get("ports", [])
            if len(ports) == 1:
                key = (route["employee_id"], route["app_name"], int(ports[0]))
                if key in seen:
                    continue
                seen.add(key)
            bucket, item = seed_record(port_map, route, source, containers, args.repair_stale)
            if bucket == "conflict":
                results["conflicts"].append(item)
            else:
                results[bucket].append(item)

        if results["added"] or results["repaired"]:
            atomic_write_json(args.map_path, port_map)

    print(json.dumps({
        "ok": True,
        "map_path": str(args.map_path),
        **results,
    }, ensure_ascii=False, indent=2))


def cmd_allocate(args: argparse.Namespace) -> None:
    with lock_file(args.lock_path):
        ensure_map_file(args.map_path)
        port_map = load_map(args.map_path)
        employee_id, app_name = validate_project(args.employee_id, args.app_name)
        record = choose_port(args, port_map)
        port_map.setdefault(employee_id, {})[app_name] = record
        atomic_write_json(args.map_path, port_map)
    print(json.dumps({"ok": True, "employee_id": employee_id, "app_name": app_name, **record}, ensure_ascii=False))


def cmd_mark(args: argparse.Namespace) -> None:
    with lock_file(args.lock_path):
        ensure_map_file(args.map_path)
        port_map = load_map(args.map_path)
        employee_id, app_name = validate_project(args.employee_id, args.app_name)
        record = port_map.get(employee_id, {}).get(app_name)
        if not isinstance(record, dict):
            fail("Project is not present in port map.")
        record["status"] = args.status
        record["updated_at"] = int(time.time())
        if args.reason:
            record["reason"] = args.reason
        if args.fingerprint:
            record["fingerprint"] = args.fingerprint
        atomic_write_json(args.map_path, port_map)
    print(json.dumps({"ok": True, "employee_id": employee_id, "app_name": app_name, **record}, ensure_ascii=False))


def cmd_release(args: argparse.Namespace) -> None:
    with lock_file(args.lock_path):
        ensure_map_file(args.map_path)
        port_map = load_map(args.map_path)
        employee_id, app_name = validate_project(args.employee_id, args.app_name)
        record = port_map.get(employee_id, {}).get(app_name)
        if not isinstance(record, dict):
            print(json.dumps({"ok": True, "action": "already_absent", "employee_id": employee_id, "app_name": app_name}, ensure_ascii=False))
            return
        record["status"] = "released"
        record["released_at"] = int(time.time())
        record["reason"] = args.reason or "released"
        atomic_write_json(args.map_path, port_map)
    print(json.dumps({"ok": True, "action": "released", "employee_id": employee_id, "app_name": app_name, **record}, ensure_ascii=False))


def cmd_show(args: argparse.Namespace) -> None:
    ensure_map_file(args.map_path)
    port_map = load_map(args.map_path)
    if args.employee_id and args.app_name:
        employee_id, app_name = validate_project(args.employee_id, args.app_name)
        record = port_map.get(employee_id, {}).get(app_name)
        print(json.dumps({"ok": True, "employee_id": employee_id, "app_name": app_name, "record": record}, ensure_ascii=False, indent=2))
        return
    print(json.dumps({"ok": True, "port_map": port_map}, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage Fandow port ownership map.")
    parser.add_argument("--map-path", type=Path, default=DEFAULT_MAP_PATH)
    parser.add_argument("--lock-path", type=Path, default=DEFAULT_LOCK_PATH)
    sub = parser.add_subparsers(dest="command", required=True)

    bootstrap = sub.add_parser("bootstrap")
    bootstrap.add_argument("--nginx-path", action="append", default=["/etc/nginx/lightdeploy-locations"])
    bootstrap.add_argument("--include-docker-only", action="store_true")
    bootstrap.add_argument("--repair-stale", action="store_true")
    bootstrap.set_defaults(func=cmd_bootstrap)

    allocate = sub.add_parser("allocate")
    allocate.add_argument("--employee-id", required=True)
    allocate.add_argument("--app-name", required=True)
    allocate.add_argument("--container")
    allocate.add_argument("--fingerprint")
    allocate.add_argument("--port-ranges", default=DEFAULT_RANGES)
    allocate.add_argument("--nginx-path", action="append", default=["/etc/nginx"])
    allocate.set_defaults(func=cmd_allocate)

    mark = sub.add_parser("mark")
    mark.add_argument("--employee-id", required=True)
    mark.add_argument("--app-name", required=True)
    mark.add_argument("--status", required=True, choices=["reserved", "running", "failed", "broken", "released"])
    mark.add_argument("--reason")
    mark.add_argument("--fingerprint")
    mark.set_defaults(func=cmd_mark)

    release = sub.add_parser("release")
    release.add_argument("--employee-id", required=True)
    release.add_argument("--app-name", required=True)
    release.add_argument("--reason")
    release.set_defaults(func=cmd_release)

    show = sub.add_parser("show")
    show.add_argument("--employee-id")
    show.add_argument("--app-name")
    show.set_defaults(func=cmd_show)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
