#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from main.restart_utils import restart_gunicorn_and_wait  # noqa: E402


def main() -> int:
    ok = restart_gunicorn_and_wait(timeout_seconds=180)
    if not ok:
        print("gunicorn did not become ready in time.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
