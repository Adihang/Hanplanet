#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit


COMBINED_RE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] '
    r'"(?P<request>[^"]*)" (?P<status>\d{3}) (?P<bytes>\S+) '
    r'"(?P<referer>[^"]*)" "(?P<ua>[^"]*)"'
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill Hanplanet JSON access logs from nginx combined access.log."
    )
    parser.add_argument("--input", default="/opt/homebrew/var/log/nginx/access.log")
    parser.add_argument("--output-dir", default="/opt/homebrew/var/log/nginx")
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    return parser.parse_args()


def parse_date(value: str):
    return datetime.strptime(value, "%Y-%m-%d").date()


def parse_combined_line(line: str):
    match = COMBINED_RE.match(line)
    if not match:
        return None

    try:
        logged_at = datetime.strptime(match.group("time"), "%d/%b/%Y:%H:%M:%S %z")
    except ValueError:
        return None

    request = match.group("request")
    request_parts = request.split()
    method = request_parts[0].upper() if request_parts else "UNKNOWN"
    target = request_parts[1] if len(request_parts) >= 2 else "/"
    try:
        split_target = urlsplit(target)
        path = split_target.path or "/"
        query = split_target.query
    except ValueError:
        path = target.split("?", 1)[0] or "/"
        query = target.split("?", 1)[1] if "?" in target else ""

    try:
        bytes_sent = int(match.group("bytes"))
    except ValueError:
        bytes_sent = 0

    request_id_seed = f"{match.group('time')}|{match.group('ip')}|{request}|{match.group('status')}"
    return {
        "logged_at": logged_at.isoformat(),
        "request_id": hashlib.md5(request_id_seed.encode("utf-8", errors="replace")).hexdigest(),
        "client_ip": match.group("ip"),
        "x_forwarded_for": "",
        "method": method,
        "path": path,
        "query": query,
        "status": int(match.group("status")),
        "request_time_s": 0,
        "upstream_time_s": "",
        "bytes_sent": bytes_sent,
        "host": "-",
        "scheme": "http",
        "user_agent": match.group("ua"),
        "referer": match.group("referer"),
    }


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    start_date = parse_date(args.start_date)
    end_date = parse_date(args.end_date)
    if end_date < start_date:
        raise SystemExit("--end-date must be greater than or equal to --start-date")

    output_dir.mkdir(parents=True, exist_ok=True)
    grouped = defaultdict(list)
    parse_errors = 0

    with input_path.open("r", encoding="utf-8", errors="replace") as handle:
        for raw_line in handle:
            payload = parse_combined_line(raw_line.rstrip("\n"))
            if payload is None:
                parse_errors += 1
                continue
            logged_date = datetime.fromisoformat(payload["logged_at"]).date()
            if start_date <= logged_date <= end_date:
                grouped[logged_date].append(payload)

    for target_date, rows in sorted(grouped.items()):
        output_path = output_dir / f"access_json_backfill_{target_date.isoformat()}.log"
        with output_path.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        print(f"{target_date}: wrote {len(rows)} rows to {output_path}")

    print(f"parse_errors={parse_errors}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
