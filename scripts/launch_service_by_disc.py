#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from storage_profile import (  # noqa: E402
    get_disc_mode,
    get_forgejo_repos_root,
    get_media_root,
    get_required_storage_paths,
)

HDD_VOLUME_ROOT = Path("/Volumes/HANPLANET_HDD")
HDD_MEDIA_SENTINEL = Path("HanDrive/help/list_en.md")
HDD_REPOS_SENTINEL = Path("admin")


def _is_path_ready(path: Path) -> bool:
    try:
        if not path.exists():
            return False
        if path.is_dir():
            next(path.iterdir(), None)
        else:
            with path.open("rb"):
                pass
        return True
    except (OSError, PermissionError):
        return False


def _path_resolves_to(path: Path, target: Path) -> bool:
    try:
        return path.samefile(target)
    except (OSError, RuntimeError, NotImplementedError):
        try:
            return path.resolve() == target.resolve()
        except (OSError, RuntimeError):
            return False


def _is_hdd_storage_ready() -> bool:
    media_root = get_media_root("hdd")
    repos_root = get_forgejo_repos_root("hdd")
    project_media_root = REPO_ROOT / "media"
    project_repos_root = REPO_ROOT / "forgejo" / "data" / "repos"

    probe_paths = [
        media_root / HDD_MEDIA_SENTINEL,
        repos_root / HDD_REPOS_SENTINEL,
    ]
    if not all(_is_path_ready(path) for path in probe_paths):
        return False

    if not _path_resolves_to(project_media_root, media_root):
        return False
    if not _path_resolves_to(project_repos_root, repos_root):
        return False

    return True


def _wait_for_paths(paths: list[Path], timeout: int | None = 300, interval: float = 2.0) -> None:
    if not paths:
        return
    deadline = None if timeout is None else time.monotonic() + timeout
    while True:
        pending = [path for path in paths if not _is_path_ready(path)]
        if not pending:
            return
        if deadline is not None and time.monotonic() >= deadline:
            joined = ", ".join(str(path) for path in pending)
            raise RuntimeError(f"timed out waiting for storage paths: {joined}")
        time.sleep(interval)


def _get_unready_paths(paths: list[Path]) -> list[Path]:
    return [path for path in paths if not _is_path_ready(path)]


def _ensure_ssd_paths() -> None:
    media_root = get_media_root("ssd")
    repos_root = get_forgejo_repos_root("ssd")
    for path in (media_root / "HanDrive", media_root / "uploads", repos_root):
        path.mkdir(parents=True, exist_ok=True)


def _wait_for_hdd_storage_ready(timeout: int = 60, interval: float = 2.0) -> None:
    deadline = time.monotonic() + max(1, timeout)
    while time.monotonic() < deadline:
        if _is_hdd_storage_ready():
            return
        time.sleep(interval)
    raise RuntimeError("timed out waiting for external HDD data to become readable")


def _build_gitea_runtime_config(disc_mode: str) -> Path:
    base_config_path = REPO_ROOT / "forgejo" / "custom" / "conf" / "app.ini"
    runtime_config_path = Path("/tmp/hanplanet_gitea_runtime.ini")
    config_text = base_config_path.read_text(encoding="utf-8")
    repo_root = str(get_forgejo_repos_root(disc_mode))
    config_text = re.sub(
        r"(^\[repository\]\s*$(?:\n|\r\n)(?:.*(?:\n|\r\n))*?^ROOT\s*=\s*).*$",
        rf"\1{repo_root}",
        config_text,
        count=1,
        flags=re.MULTILINE,
    )
    runtime_config_path.write_text(config_text, encoding="utf-8")
    return runtime_config_path


def _build_nginx_runtime_config(disc_mode: str) -> Path:
    base_config_path = REPO_ROOT / "nginx" / "nginx.autorun.conf"
    runtime_config_path = Path("/tmp/hanplanet_nginx_runtime.conf")
    config_text = base_config_path.read_text(encoding="utf-8")
    media_root = str(get_media_root(disc_mode)).rstrip("/") + "/"
    config_text = re.sub(
        r"(^\s*location /media/ \{\s*(?:\n|\r\n)\s*alias\s+).*(;\s*$)",
        rf"\1{media_root}\2",
        config_text,
        count=1,
        flags=re.MULTILINE,
    )
    runtime_config_path.write_text(config_text, encoding="utf-8")
    return runtime_config_path


def _exec_command(command: list[str]) -> None:
    os.execv(command[0], command)


def _is_tcp_port_listening(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", int(port))) == 0


def _wait_for_port_state(port: int, *, should_listen: bool, timeout_seconds: float) -> bool:
    deadline = time.monotonic() + max(0.1, float(timeout_seconds))
    while time.monotonic() < deadline:
        if _is_tcp_port_listening(port) == should_listen:
            return True
        time.sleep(0.1)
    return _is_tcp_port_listening(port) == should_listen


def _terminate_conflicting_gunicorn(port: int) -> None:
    if not _is_tcp_port_listening(port):
        return

    pattern = "gunicorn config.wsgi:application --bind 127.0.0.1:8000"
    try:
        subprocess.run(
            ["/usr/bin/pkill", "-TERM", "-f", pattern],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        pass

    if _wait_for_port_state(port, should_listen=False, timeout_seconds=5):
        return

    try:
        subprocess.run(
            ["/usr/bin/pkill", "-KILL", "-f", pattern],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        pass

    _wait_for_port_state(port, should_listen=False, timeout_seconds=2)


def _terminate_conflicting_nginx() -> None:
    pattern = "/opt/homebrew/opt/nginx/bin/nginx -g daemon off; -c /tmp/hanplanet_nginx_runtime.conf"
    try:
        subprocess.run(
            ["/usr/bin/pkill", "-TERM", "-f", pattern],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        pass

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if not _is_tcp_port_listening(80) and not _is_tcp_port_listening(8080):
            return
        time.sleep(0.1)

    try:
        subprocess.run(
            ["/usr/bin/pkill", "-KILL", "-f", pattern],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        pass

    _wait_for_port_state(80, should_listen=False, timeout_seconds=2)
    _wait_for_port_state(8080, should_listen=False, timeout_seconds=2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("service", choices={"gunicorn", "gitea", "celery", "nginx"})
    args = parser.parse_args()

    disc_mode = get_disc_mode()
    if disc_mode == "ssd":
        _ensure_ssd_paths()
    else:
        _wait_for_hdd_storage_ready()

    if args.service == "gunicorn":
        _terminate_conflicting_gunicorn(8000)
        _exec_command(
            [
                "/usr/bin/python3",
                "-m",
                "gunicorn",
                "config.wsgi:application",
                "--bind",
                "127.0.0.1:8000",
                "--chdir",
                str(REPO_ROOT),
                "--timeout",
                "120",
            ]
        )

    if args.service == "celery":
        _exec_command(
            [
                "/usr/bin/python3",
                "-m",
                "celery",
                "-A",
                "config",
                "worker",
                "-l",
                "info",
                "--concurrency=2",
            ]
        )

    if args.service == "nginx":
        _terminate_conflicting_nginx()
        runtime_config = _build_nginx_runtime_config(disc_mode)
        _exec_command(
            [
                "/opt/homebrew/opt/nginx/bin/nginx",
                "-g",
                "daemon off;",
                "-c",
                str(runtime_config),
            ]
        )

    runtime_config = _build_gitea_runtime_config(disc_mode)
    _exec_command(
        [
            "/opt/homebrew/bin/gitea",
            "web",
            "--work-path",
            str(REPO_ROOT / "forgejo"),
            "--config",
            str(runtime_config),
        ]
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
