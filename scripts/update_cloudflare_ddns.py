#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = BASE_DIR / "config" / "secrets.json"
CF_API_BASE = "https://api.cloudflare.com/client/v4"
PUBLIC_IP_URLS = (
    "https://api.ipify.org",
    "https://checkip.amazonaws.com",
    "https://ifconfig.me/ip",
)


class CloudflareDdnsError(RuntimeError):
    pass


def load_secrets(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CloudflareDdnsError(f"Could not parse {path}: {exc}") from exc


def get_value(secrets: dict, key: str, default: str = "") -> str:
    value = os.environ.get(key)
    if value is None:
        value = secrets.get(key, default)
    return str(value or "").strip()


def get_int_value(secrets: dict, key: str, default: int) -> int:
    raw_value = get_value(secrets, key, str(default))
    try:
        return int(raw_value)
    except ValueError as exc:
        raise CloudflareDdnsError(f"{key} must be an integer.") from exc


def fetch_public_ipv4(timeout: int) -> str:
    last_error = None
    for url in PUBLIC_IP_URLS:
        request = urllib.request.Request(url, headers={"User-Agent": "Hanplanet-HPmail-DDNS/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                value = response.read().decode("utf-8").strip()
        except (OSError, urllib.error.URLError) as exc:
            last_error = exc
            continue
        parts = value.split(".")
        if len(parts) == 4 and all(part.isdigit() and 0 <= int(part) <= 255 for part in parts):
            return value
        last_error = CloudflareDdnsError(f"Invalid IPv4 response from {url}: {value!r}")
    raise CloudflareDdnsError(f"Could not determine public IPv4: {last_error}")


def cloudflare_request(token: str, method: str, path: str, *, query: dict | None = None, data: dict | None = None) -> dict:
    url = CF_API_BASE + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    body = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", "replace")
        raise CloudflareDdnsError(f"Cloudflare API HTTP {exc.code}: {details}") from exc
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
        raise CloudflareDdnsError(f"Cloudflare API request failed: {exc}") from exc
    if not payload.get("success"):
        raise CloudflareDdnsError(f"Cloudflare API error: {payload.get('errors') or payload}")
    return payload


def resolve_zone_id(token: str, secrets: dict, zone_name: str) -> str:
    configured = get_value(secrets, "CLOUDFLARE_ZONE_ID")
    if configured:
        return configured
    payload = cloudflare_request(token, "GET", "/zones", query={"name": zone_name, "status": "active"})
    zones = payload.get("result") or []
    if not zones:
        raise CloudflareDdnsError(f"Cloudflare zone not found: {zone_name}")
    if len(zones) > 1:
        raise CloudflareDdnsError(f"Multiple Cloudflare zones matched: {zone_name}")
    return str(zones[0]["id"])


def find_a_record(token: str, zone_id: str, record_name: str) -> dict | None:
    payload = cloudflare_request(
        token,
        "GET",
        f"/zones/{zone_id}/dns_records",
        query={"type": "A", "name": record_name, "per_page": 100},
    )
    for record in payload.get("result") or []:
        if str(record.get("name", "")).lower() == record_name.lower():
            return record
    return None


def upsert_a_record(
    token: str,
    zone_id: str,
    record_name: str,
    public_ip: str,
    ttl: int,
    *,
    dry_run: bool = False,
) -> str:
    record = find_a_record(token, zone_id, record_name)
    desired = {
        "type": "A",
        "name": record_name,
        "content": public_ip,
        "ttl": ttl,
        "proxied": False,
        "comment": "Hanplanet DDNS",
    }
    if record:
        current_ip = str(record.get("content", "")).strip()
        current_proxied = bool(record.get("proxied"))
        current_ttl = int(record.get("ttl") or 1)
        if current_ip == public_ip and not current_proxied and current_ttl == ttl:
            return f"unchanged {record_name} -> {public_ip}"
        if dry_run:
            return f"dry-run update {record_name}: {current_ip} -> {public_ip}"
        cloudflare_request(token, "PUT", f"/zones/{zone_id}/dns_records/{record['id']}", data=desired)
        return f"updated {record_name}: {current_ip} -> {public_ip}"
    if dry_run:
        return f"dry-run create {record_name} -> {public_ip}"
    cloudflare_request(token, "POST", f"/zones/{zone_id}/dns_records", data=desired)
    return f"created {record_name} -> {public_ip}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Update a Cloudflare DNS A record for Hanplanet DDNS.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH))
    parser.add_argument("--zone-name", default="")
    parser.add_argument("--record-name", default="")
    parser.add_argument("--ttl", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    secrets = load_secrets(Path(args.config))
    token = get_value(secrets, "CLOUDFLARE_API_TOKEN")
    if not token:
        raise CloudflareDdnsError("CLOUDFLARE_API_TOKEN is required in environment or config/secrets.json.")
    zone_name = args.zone_name or get_value(secrets, "CLOUDFLARE_ZONE_NAME", "hanplanet.com")
    record_name = args.record_name or get_value(secrets, "CLOUDFLARE_DDNS_RECORD_NAME", f"mail.{zone_name}")
    ttl = args.ttl or get_int_value(secrets, "CLOUDFLARE_DDNS_TTL", 300)
    public_ip = fetch_public_ipv4(timeout=10)
    zone_id = resolve_zone_id(token, secrets, zone_name)
    print(upsert_a_record(token, zone_id, record_name, public_ip, ttl, dry_run=args.dry_run))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CloudflareDdnsError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
