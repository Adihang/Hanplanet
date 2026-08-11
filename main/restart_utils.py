from __future__ import annotations

import os
import json
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
DOCKER_PROMINENCE_RESTART_REQUEST_PATH = Path(
    "/data/django/.hanplanet-prominence-restart-request"
)
DOCKER_MINECRAFT_RESTART_REQUEST_PATH = Path(
    "/data/django/.hanplanet-minecraft-restart-request"
)
_default_prominence_restart_state_path = (
    "/data/django/.hanplanet-prominence-restart-state.json"
    if str(os.environ.get("HANPLANET_RUNTIME", "")).strip().lower() == "docker"
    or Path("/.dockerenv").exists()
    else "/tmp/hanplanet-prominence-restart-state.json"
)
DOCKER_PROMINENCE_RESTART_STATE_PATH = Path(
    os.environ.get(
        "HANPLANET_PROMINENCE_RESTART_STATE_PATH",
        _default_prominence_restart_state_path,
    )
)
_default_minecraft_restart_state_path = (
    "/data/django/.hanplanet-minecraft-restart-state.json"
    if str(os.environ.get("HANPLANET_RUNTIME", "")).strip().lower() == "docker"
    or Path("/.dockerenv").exists()
    else "/tmp/hanplanet-minecraft-restart-state.json"
)
DOCKER_MINECRAFT_RESTART_STATE_PATH = Path(
    os.environ.get(
        "HANPLANET_MINECRAFT_RESTART_STATE_PATH",
        _default_minecraft_restart_state_path,
    )
)
PROMINENCE_RESTART_ACTIVE_PHASES = frozenset({"queued", "stopping", "starting"})
MINECRAFT_RESTART_ACTIVE_PHASES = PROMINENCE_RESTART_ACTIVE_PHASES
PROMINENCE_RESTART_STATE_MAX_AGE_SECONDS = 15 * 60
MINECRAFT_RESTART_STATE_MAX_AGE_SECONDS = PROMINENCE_RESTART_STATE_MAX_AGE_SECONDS


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


def _write_atomic_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary_path.write_text(content, encoding="utf-8")
        temporary_path.replace(path)
    finally:
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            pass


def write_prominence_restart_state(phase: str, *, error: str = "") -> dict:
    """Persist the phase shown by the admin restart progress dialog."""
    phase = str(phase or "idle").strip().lower()
    payload = {
        "phase": phase,
        "updated_at": time.time(),
    }
    if error:
        payload["error"] = str(error)[:160]
    _write_atomic_text(
        DOCKER_PROMINENCE_RESTART_STATE_PATH,
        json.dumps(payload, separators=(",", ":")),
    )
    return payload


def read_prominence_restart_state() -> dict:
    """Read the shared restart phase without exposing filesystem details."""
    try:
        payload = json.loads(
            DOCKER_PROMINENCE_RESTART_STATE_PATH.read_text(encoding="utf-8")
        )
    except (OSError, ValueError, TypeError):
        return {"phase": "idle", "updated_at": 0.0}
    if not isinstance(payload, dict):
        return {"phase": "idle", "updated_at": 0.0}

    phase = str(payload.get("phase") or "idle").strip().lower()
    try:
        updated_at = float(payload.get("updated_at") or 0.0)
    except (TypeError, ValueError):
        updated_at = 0.0
    state = {"phase": phase, "updated_at": updated_at}
    if payload.get("error"):
        state["error"] = str(payload["error"])[:160]
    return state


def prominence_restart_is_active(state: dict | None = None) -> bool:
    state = state if isinstance(state, dict) else read_prominence_restart_state()
    phase = str(state.get("phase") or "idle").strip().lower()
    try:
        updated_at = float(state.get("updated_at") or 0.0)
    except (TypeError, ValueError):
        updated_at = 0.0
    return (
        phase in PROMINENCE_RESTART_ACTIVE_PHASES
        and updated_at > 0
        and time.time() - updated_at <= PROMINENCE_RESTART_STATE_MAX_AGE_SECONDS
    )


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


def _write_prominence_console_line(command: str) -> bool:
    fifo_path = Path(
        os.environ.get(
            "PROMINENCE_CONSOLE_INPUT_PATH",
            "/Users/imhanbyeol/Development/rlcraft/run/console.in",
        )
    )
    try:
        if not fifo_path.is_fifo():
            return False
        file_descriptor = os.open(fifo_path, os.O_WRONLY | os.O_NONBLOCK)
    except OSError:
        return False

    payload = f"{command}\n".encode("utf-8")
    try:
        return os.write(file_descriptor, payload) == len(payload)
    except OSError:
        return False
    finally:
        os.close(file_descriptor)


def _send_prominence_restart_countdown() -> bool:
    if not _write_prominence_console_line(
        "say [Hanplanet] 10초 후 서버가 재시작 합니다."
    ):
        return False
    time.sleep(1)
    for remaining_seconds in range(9, 0, -1):
        if not _write_prominence_console_line(f"say [Hanplanet] {remaining_seconds}"):
            return False
        time.sleep(1)
    return _write_prominence_console_line("say [Hanplanet] 서버를 재시작합니다.")


def request_prominence_server_restart() -> str:
    """Restart only the Prominence II server through its host process manager."""
    if prominence_restart_is_active():
        return "in_progress"

    write_prominence_restart_state("queued")
    is_docker = (
        str(os.environ.get("HANPLANET_RUNTIME", "") or "").strip().lower() == "docker"
        or Path("/.dockerenv").exists()
    )
    if is_docker:
        _write_atomic_text(
            DOCKER_PROMINENCE_RESTART_REQUEST_PATH,
            f"requested:{time.time_ns()}:{os.getpid()}",
        )
        return "queued"

    write_prominence_restart_state("stopping")
    _send_prominence_restart_countdown()

    try:
        subprocess.run(
            [
                "/bin/zsh",
                "-lc",
                "launchctl kickstart -k gui/$(id -u)/com.hanplanet.rlcraft",
            ],
            check=True,
            timeout=20,
        )
    except Exception:
        write_prominence_restart_state("failed", error="launchd_request_failed")
        raise
    write_prominence_restart_state("starting")
    return "started"


def write_minecraft_restart_state(phase: str, *, error: str = "") -> dict:
    """Persist the phase shown by the Minecraft admin restart dialog."""
    phase = str(phase or "idle").strip().lower()
    payload = {"phase": phase, "updated_at": time.time()}
    if error:
        payload["error"] = str(error)[:160]
    _write_atomic_text(
        DOCKER_MINECRAFT_RESTART_STATE_PATH,
        json.dumps(payload, separators=(",", ":")),
    )
    return payload


def read_minecraft_restart_state() -> dict:
    """Read Minecraft restart progress without exposing filesystem details."""
    try:
        payload = json.loads(
            DOCKER_MINECRAFT_RESTART_STATE_PATH.read_text(encoding="utf-8")
        )
    except (OSError, ValueError, TypeError):
        return {"phase": "idle", "updated_at": 0.0}
    if not isinstance(payload, dict):
        return {"phase": "idle", "updated_at": 0.0}
    phase = str(payload.get("phase") or "idle").strip().lower()
    try:
        updated_at = float(payload.get("updated_at") or 0.0)
    except (TypeError, ValueError):
        updated_at = 0.0
    state = {"phase": phase, "updated_at": updated_at}
    if payload.get("error"):
        state["error"] = str(payload["error"])[:160]
    return state


def minecraft_restart_is_active(state: dict | None = None) -> bool:
    state = state if isinstance(state, dict) else read_minecraft_restart_state()
    phase = str(state.get("phase") or "idle").strip().lower()
    try:
        updated_at = float(state.get("updated_at") or 0.0)
    except (TypeError, ValueError):
        updated_at = 0.0
    return (
        phase in MINECRAFT_RESTART_ACTIVE_PHASES
        and updated_at > 0
        and time.time() - updated_at <= MINECRAFT_RESTART_STATE_MAX_AGE_SECONDS
    )


def request_minecraft_server_restart() -> str:
    """Restart only the Minecraft server through Docker watchdog or launchd."""
    if minecraft_restart_is_active():
        return "in_progress"

    write_minecraft_restart_state("queued")
    is_docker = (
        str(os.environ.get("HANPLANET_RUNTIME", "") or "").strip().lower() == "docker"
        or Path("/.dockerenv").exists()
    )
    if is_docker:
        _write_atomic_text(
            DOCKER_MINECRAFT_RESTART_REQUEST_PATH,
            f"requested:{time.time_ns()}:{os.getpid()}",
        )
        return "queued"

    try:
        subprocess.run(
            [
                "/bin/zsh",
                "-lc",
                "launchctl kickstart -k gui/$(id -u)/com.hanplanet.minecraft",
            ],
            check=True,
            timeout=20,
        )
    except Exception:
        write_minecraft_restart_state("failed", error="launchd_request_failed")
        raise
    write_minecraft_restart_state("starting")
    return "started"


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
