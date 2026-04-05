from __future__ import annotations

import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


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


def restart_gunicorn_and_wait(*, timeout_seconds: int = 120, healthcheck_url: str = "http://127.0.0.1/") -> bool:
    subprocess.run(
        [
            "/bin/zsh",
            "-lc",
            "launchctl kickstart -k gui/$(id -u)/com.hanplanet.gunicorn",
        ],
        check=True,
        timeout=30,
    )
    return wait_for_http_ready(healthcheck_url, timeout_seconds=timeout_seconds)
