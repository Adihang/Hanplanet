#!/usr/bin/python3

from __future__ import annotations

from datetime import datetime
from pathlib import Path


TARGET_VOLUME = Path("/Volumes/HANPLANET_HDD")
LOG_FILE = Path("/tmp/com.hanplanet.external-hdd-keepalive.log")


def log(message: str) -> None:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with LOG_FILE.open("a", encoding="utf-8") as handle:
        handle.write(f"{timestamp} {message}\n")


def cleanup_ds_store_files() -> None:
    removed_count = 0
    for ds_store_path in TARGET_VOLUME.rglob(".DS_Store"):
        try:
            ds_store_path.unlink()
            removed_count += 1
        except OSError as exc:
            log(f"failed to remove {ds_store_path}: {exc}")
    if removed_count:
        log(f"removed {removed_count} .DS_Store files from {TARGET_VOLUME}")


def main() -> int:
    if not TARGET_VOLUME.is_dir():
        log(f"target volume missing: {TARGET_VOLUME}")
        return 0

    cleanup_ds_store_files()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
