from __future__ import annotations

import os
import socket
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


# This path lives on the persistent Django data volume in Docker Compose.  The
# host-side Docker health watchdog can see the marker through ``docker compose
# exec`` even though the Django container intentionally has no Docker socket or
# host source-tree mount.
DOCKER_STACK_DEPLOY_REQUEST_PATH = Path(
    "/data/django/.hanplanet-docker-stack-deploy-request"
)


def _is_port_listening(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def _wait_for_port_down(port: int, timeout_seconds: float = 10.0) -> None:
    """이전 프로세스가 포트를 놓을 때까지 대기. 이미 내려가 있으면 즉시 리턴."""
    deadline = time.monotonic() + max(0.1, float(timeout_seconds))
    while time.monotonic() < deadline:
        if not _is_port_listening(port):
            return
        time.sleep(0.1)


def wait_for_http_ready(url: str, timeout_seconds: int = 120, interval_seconds: float = 1.0) -> bool:
    deadline = time.monotonic() + max(1, int(timeout_seconds))
    request = Request(url, headers={"User-Agent": "Hanplanet-Healthcheck/1.0"})

    while True:
        try:
            with urlopen(request, timeout=5) as response:
                if 200 <= getattr(response, "status", 200) < 400:
                    return True
        except HTTPError as exc:
            if 200 <= exc.code < 400:
                return True
        except URLError:
            pass
        except OSError:
            pass

        if time.monotonic() >= deadline:
            return False
        time.sleep(max(0.1, float(interval_seconds)))


def request_docker_stack_deploy() -> None:
    """Queue a host-side Docker Compose rebuild/restart.

    The web process runs inside the Django container, which deliberately does
    not have access to the host Docker socket.  Writing an atomic marker to the
    persistent Django volume lets the host launchd watchdog perform the
    privileged ``docker compose up -d --build`` operation safely outside the
    request process.
    """
    marker_path = DOCKER_STACK_DEPLOY_REQUEST_PATH
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = marker_path.with_name(
        f".{marker_path.name}.{os.getpid()}.tmp"
    )
    try:
        temporary_path.write_text(
            f"requested:{time.time_ns()}:{os.getpid()}",
            encoding="utf-8",
        )
        temporary_path.replace(marker_path)
    finally:
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            # Preserve the original write/replace failure for the caller.
            pass


def restart_gunicorn_and_wait(
    *,
    timeout_seconds: int = 120,
    healthcheck_url: str = "http://127.0.0.1:8000/manifest.webmanifest",
) -> bool:
    subprocess.run(
        [
            "/bin/zsh",
            "-lc",
            "launchctl kickstart -k gui/$(id -u)/com.hanplanet.gunicorn",
        ],
        check=True,
        timeout=30,
    )
    # kickstart -k는 비동기 — 이전 프로세스가 실제로 포트를 내려놓을 때까지 대기한 후
    # 새 프로세스가 올라오길 폴링해야 이전 gunicorn을 오판하지 않는다.
    _wait_for_port_down(8000, timeout_seconds=10.0)
    return wait_for_http_ready(healthcheck_url, timeout_seconds=timeout_seconds)
