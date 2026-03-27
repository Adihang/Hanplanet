#!/usr/bin/python3

from __future__ import annotations

from datetime import datetime
from pathlib import Path


TARGET_DIR = Path("/Volumes/HANPLANET_HDD/Hanplanet")
TARGET_FILE = TARGET_DIR / "time.txt"
LOG_FILE = Path("/tmp/com.hanplanet.external-hdd-keepalive.log")


def log(message: str) -> None:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with LOG_FILE.open("a", encoding="utf-8") as handle:
        handle.write(f"{timestamp} {message}\n")


def read_current_value() -> int:
    if not TARGET_FILE.exists():
        return 0

    try:
        existing_value = TARGET_FILE.read_text(encoding="utf-8").strip()
    except OSError as exc:
        log(f"failed to read {TARGET_FILE}: {exc}")
        return 0

    return int(existing_value) if existing_value.isdigit() else 0


def main() -> int:
    if not TARGET_DIR.is_dir():
        log(f"target directory missing: {TARGET_DIR}")
        return 0

    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    next_value = read_current_value() + 1
    TARGET_FILE.write_text(f"{next_value}\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
