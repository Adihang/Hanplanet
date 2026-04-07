#!/usr/bin/env python3
"""Periodic health check: restart gunicorn if the site returns 502 or media files return 503."""
from __future__ import annotations

import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from main.restart_utils import restart_gunicorn_and_wait  # noqa: E402

SITE_URL = "https://www.hanplanet.com/"
# Sentinel file on HDD — probing it catches gunicorn workers that started before HDD was ready.
MEDIA_SENTINEL_URL = "https://www.hanplanet.com/media/healthcheck.txt"
COOLDOWN_FILE = Path("/tmp/hanplanet_healthcheck_restart.ts")
COOLDOWN_SECONDS = 180  # don't restart more than once every 3 minutes


def _probe(url: str, bad_statuses: set[int]) -> str | None:
    """Return a reason string if the URL responds with a bad status, else None."""
    request = Request(url, headers={"User-Agent": "Hanplanet-Healthcheck/1.0"})
    try:
        with urlopen(request, timeout=10) as response:
            status = getattr(response, "status", 200)
            if status in bad_statuses:
                return f"HTTP {status}"
            return None
    except HTTPError as exc:
        if exc.code in bad_statuses:
            return f"HTTP {exc.code}"
        return None
    except (URLError, OSError) as exc:
        return f"connection error: {exc}"


def _in_cooldown() -> bool:
    try:
        ts = float(COOLDOWN_FILE.read_text())
        return (time.time() - ts) < COOLDOWN_SECONDS
    except (OSError, ValueError):
        return False


def _mark_restart() -> None:
    COOLDOWN_FILE.write_text(str(time.time()))


def main() -> int:
    reasons: list[str] = []

    # 502: gunicorn is down entirely
    if reason := _probe(SITE_URL, {502}):
        reasons.append(f"main site ({reason})")

    # 503: gunicorn is up but can't read HDD storage (started before HDD was ready)
    if reason := _probe(MEDIA_SENTINEL_URL, {503}):
        reasons.append(f"media sentinel ({reason})")

    if not reasons:
        return 0

    print(f"[healthcheck] issues: {', '.join(reasons)}", flush=True)

    if _in_cooldown():
        print("[healthcheck] restart skipped — cooldown active", flush=True)
        return 0

    print("[healthcheck] restarting gunicorn...", flush=True)
    _mark_restart()
    ok = restart_gunicorn_and_wait(timeout_seconds=180)
    if ok:
        print("[healthcheck] gunicorn restarted and is ready", flush=True)
        return 0

    print("[healthcheck] gunicorn did not become ready in time", file=sys.stderr, flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
