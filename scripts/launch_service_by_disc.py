#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
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


def _wait_for_paths(paths: list[Path], timeout: int = 300, interval: float = 2.0) -> None:
    if not paths:
        return
    deadline = time.monotonic() + timeout
    while True:
        pending = [path for path in paths if not _is_path_ready(path)]
        if not pending:
            return
        if time.monotonic() >= deadline:
            joined = ", ".join(str(path) for path in pending)
            raise RuntimeError(f"timed out waiting for storage paths: {joined}")
        time.sleep(interval)


def _ensure_ssd_paths() -> None:
    media_root = get_media_root("ssd")
    repos_root = get_forgejo_repos_root("ssd")
    for path in (media_root / "HanDrive", media_root / "uploads", repos_root):
        path.mkdir(parents=True, exist_ok=True)


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("service", choices={"gunicorn", "gitea", "celery", "nginx"})
    args = parser.parse_args()

    disc_mode = get_disc_mode()
    if disc_mode == "ssd":
        _ensure_ssd_paths()
    else:
        _wait_for_paths(get_required_storage_paths(disc_mode))

    if args.service == "gunicorn":
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
