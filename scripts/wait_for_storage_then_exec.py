#!/usr/bin/env python3
"""Wait until required storage paths are readable, then exec the target command."""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path


def _is_path_ready(path_str: str) -> tuple[bool, str | None]:
    path = Path(path_str)
    try:
        if not path.exists():
            return False, "missing"
        if path.is_dir():
            next(path.iterdir(), None)
        else:
            with path.open("rb"):
                pass
        return True, None
    except PermissionError as exc:
        return False, f"permission:{exc}"
    except OSError as exc:
        return False, f"oserror:{exc}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Wait for required paths to become readable, then exec a command."
    )
    parser.add_argument(
        "--path",
        action="append",
        dest="paths",
        required=True,
        help="Path that must be readable before the command starts. May be repeated.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Maximum seconds to wait before failing.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=2.0,
        help="Seconds between readiness checks.",
    )
    parser.add_argument(
        "command",
        nargs=argparse.REMAINDER,
        help="Command to exec after '--'.",
    )
    args = parser.parse_args()

    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("target command is required after '--'")

    deadline = time.monotonic() + max(1, args.timeout)
    last_status: dict[str, str | None] = {}

    while True:
        pending = []
        for path_str in args.paths:
            ready, reason = _is_path_ready(path_str)
            if not ready:
                pending.append(path_str)
                last_status[path_str] = reason

        if not pending:
            os.execvp(command[0], command)

        if time.monotonic() >= deadline:
            details = ", ".join(
                f"{path} ({last_status.get(path) or 'unavailable'})"
                for path in pending
            )
            print(
                f"[wait_for_storage_then_exec] timed out waiting for: {details}",
                file=sys.stderr,
                flush=True,
            )
            return 1

        time.sleep(max(0.1, args.interval))


if __name__ == "__main__":
    raise SystemExit(main())
