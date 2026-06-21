#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import socket
import struct
import tempfile
import gzip
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


SERVER_DIR = Path("/Users/imhanbyeol/Development/minecraft")
WEB_STATUS_PATH = SERVER_DIR / "web" / "status.json"
LATEST_LOG_PATH = SERVER_DIR / "logs" / "latest.log"
USERCACHE_PATH = SERVER_DIR / "usercache.json"
WHITELIST_PATH = SERVER_DIR / "whitelist.json"
OPS_PATH = SERVER_DIR / "ops.json"
LEVEL_DAT_PATH = SERVER_DIR / "world" / "level.dat"
WEATHER_DAT_PATH = (
    SERVER_DIR
    / "world"
    / "dimensions"
    / "minecraft"
    / "overworld"
    / "data"
    / "minecraft"
    / "weather.dat"
)

STATUS_HOST = "127.0.0.1"
PUBLIC_HOST = "mc.hanplanet.com"
STATUS_PORT = 25565
PROTOCOL_VERSION = 776

JOIN_RE = re.compile(r"\]: (?P<name>[A-Za-z0-9_]{1,16}) joined the game$")
LEAVE_RE = re.compile(r"\]: (?P<name>[A-Za-z0-9_]{1,16}) left the game$")
LOG_TIME_RE = re.compile(r"^\[(?P<hour>\d{2}):(?P<minute>\d{2}):(?P<second>\d{2})\]")
PAUSE_RE = re.compile(r"\]: Server empty for \d+ seconds, pausing$")
PAPER_PLUGIN_STATUS_SOURCE = "paper-plugin"


class NbtReader:
    """Small NBT reader for Minecraft's level/weather data files."""

    def __init__(self, data: bytes):
        self.data = data
        self.offset = 0

    def read(self, size: int) -> bytes:
        if self.offset + size > len(self.data):
            raise EOFError("unexpected EOF while reading NBT")
        chunk = self.data[self.offset:self.offset + size]
        self.offset += size
        return chunk

    def read_byte(self) -> int:
        return struct.unpack(">b", self.read(1))[0]

    def read_unsigned_byte(self) -> int:
        return self.read(1)[0]

    def read_short(self) -> int:
        return struct.unpack(">h", self.read(2))[0]

    def read_int(self) -> int:
        return struct.unpack(">i", self.read(4))[0]

    def read_long(self) -> int:
        return struct.unpack(">q", self.read(8))[0]

    def read_float(self) -> float:
        return struct.unpack(">f", self.read(4))[0]

    def read_double(self) -> float:
        return struct.unpack(">d", self.read(8))[0]

    def read_string(self) -> str:
        size = struct.unpack(">H", self.read(2))[0]
        return self.read(size).decode("utf-8", errors="replace")

    def read_payload(self, tag_type: int) -> Any:
        if tag_type == 0:
            return None
        if tag_type == 1:
            return self.read_byte()
        if tag_type == 2:
            return self.read_short()
        if tag_type == 3:
            return self.read_int()
        if tag_type == 4:
            return self.read_long()
        if tag_type == 5:
            return self.read_float()
        if tag_type == 6:
            return self.read_double()
        if tag_type == 7:
            return list(self.read(self.read_int()))
        if tag_type == 8:
            return self.read_string()
        if tag_type == 9:
            child_type = self.read_unsigned_byte()
            length = self.read_int()
            return [self.read_payload(child_type) for _ in range(max(0, length))]
        if tag_type == 10:
            value: dict[str, Any] = {}
            while True:
                child_type = self.read_unsigned_byte()
                if child_type == 0:
                    return value
                child_name = self.read_string()
                value[child_name] = self.read_payload(child_type)
        if tag_type == 11:
            return [self.read_int() for _ in range(max(0, self.read_int()))]
        if tag_type == 12:
            return [self.read_long() for _ in range(max(0, self.read_int()))]
        raise ValueError(f"unsupported NBT tag type: {tag_type}")


def read_nbt(path: Path) -> dict[str, Any]:
    compressed_data = path.read_bytes()
    data = gzip.decompress(compressed_data)
    reader = NbtReader(data)
    root_type = reader.read_unsigned_byte()
    if root_type != 10:
        raise ValueError("root NBT tag is not a compound")
    reader.read_string()
    root = reader.read_payload(root_type)
    return root if isinstance(root, dict) else {}


def format_minecraft_time(ticks: int) -> str:
    day_ticks = ticks % 24000
    total_minutes = int(((day_ticks + 6000) % 24000) * 1440 / 24000)
    hours = total_minutes // 60
    minutes = total_minutes % 60
    return f"{hours:02d}:{minutes:02d}"


def parse_log_timestamp(line: str) -> float | None:
    match = LOG_TIME_RE.match(line)
    if not match:
        return None
    now = datetime.now().astimezone()
    candidate = now.replace(
        hour=int(match.group("hour")),
        minute=int(match.group("minute")),
        second=int(match.group("second")),
        microsecond=0,
    )
    if candidate > now + timedelta(hours=1):
        candidate -= timedelta(days=1)
    return candidate.timestamp()


def read_pause_state(server_online: bool, online_count: int) -> tuple[bool, float | None]:
    if not server_online or online_count > 0 or not LATEST_LOG_PATH.exists():
        return False, None

    last_pause_line = -1
    last_pause_at: float | None = None
    last_activity_line = -1

    try:
        with LATEST_LOG_PATH.open("r", encoding="utf-8", errors="replace") as log_file:
            for line_number, line in enumerate(log_file):
                if JOIN_RE.search(line) or LEAVE_RE.search(line):
                    last_activity_line = line_number
                    continue
                if PAUSE_RE.search(line):
                    last_pause_line = line_number
                    last_pause_at = parse_log_timestamp(line)
    except OSError:
        return False, None

    if last_pause_line < 0 or last_pause_line <= last_activity_line:
        return False, None
    return True, last_pause_at


def read_world_status(server_online: bool, paused: bool = False, paused_at: float | None = None) -> dict[str, Any]:
    try:
        level_root = read_nbt(LEVEL_DAT_PATH)
        level_data = level_root.get("Data", level_root)
        time_ticks = int(level_data.get("Time"))
        if server_online:
            effective_timestamp = paused_at if paused and paused_at is not None else datetime.now(timezone.utc).timestamp()
            elapsed_seconds = max(0, effective_timestamp - LEVEL_DAT_PATH.stat().st_mtime)
            time_ticks += int(elapsed_seconds * 20)
    except (OSError, EOFError, ValueError, TypeError, gzip.BadGzipFile):
        time_ticks = 0

    try:
        weather_root = read_nbt(WEATHER_DAT_PATH)
        weather_data = weather_root.get("data", weather_root.get("Data", weather_root))
        raining = bool(weather_data.get("raining"))
        thundering = bool(weather_data.get("thundering"))
        weather = "thunder" if thundering else "rain" if raining else "clear"
    except (OSError, EOFError, ValueError, TypeError, gzip.BadGzipFile):
        weather = "unknown"

    return {
        "timeTicks": time_ticks,
        "timeLabel": format_minecraft_time(time_ticks),
        "weather": weather,
        "paused": paused,
    }


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _read_varint(sock: socket.socket) -> int:
    value = 0
    shift = 0
    for _ in range(5):
        chunk = sock.recv(1)
        if not chunk:
            raise EOFError("unexpected EOF while reading varint")
        byte = chunk[0]
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value
        shift += 7
    raise ValueError("varint too long")


def _read_exact(sock: socket.socket, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise EOFError("unexpected EOF while reading packet")
        data.extend(chunk)
    return bytes(data)


def fetch_server_status() -> tuple[bool, dict[str, Any]]:
    with socket.create_connection((STATUS_HOST, STATUS_PORT), timeout=3) as sock:
        host_bytes = PUBLIC_HOST.encode("utf-8")
        handshake = (
            _varint(0)
            + _varint(PROTOCOL_VERSION)
            + _varint(len(host_bytes))
            + host_bytes
            + struct.pack(">H", STATUS_PORT)
            + _varint(1)
        )
        sock.sendall(_varint(len(handshake)) + handshake)
        sock.sendall(b"\x01\x00")
        _read_varint(sock)
        _read_varint(sock)
        json_length = _read_varint(sock)
        return True, json.loads(_read_exact(sock, json_length).decode("utf-8"))


def read_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def read_existing_status_payload() -> dict[str, Any]:
    try:
        payload = json.loads(WEB_STATUS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def should_keep_paper_plugin_status() -> bool:
    payload = read_existing_status_payload()
    if payload.get("source") != PAPER_PLUGIN_STATUS_SOURCE:
        return False

    try:
        server_online, _status = fetch_server_status()
    except (OSError, EOFError, ValueError, json.JSONDecodeError):
        return False
    return server_online


def read_known_players() -> dict[str, dict[str, str]]:
    players: dict[str, dict[str, str]] = {}
    for path in (USERCACHE_PATH, WHITELIST_PATH, OPS_PATH):
        for entry in read_json_list(path):
            name = str(entry.get("name", "")).strip()
            if not name:
                continue
            key = name.lower()
            players.setdefault(
                key,
                {
                    "name": name,
                    "uuid": str(entry.get("uuid", "")).strip(),
                },
            )
    return players


def read_online_players_from_log() -> set[str]:
    online: set[str] = set()
    if not LATEST_LOG_PATH.exists():
        return online
    try:
        with LATEST_LOG_PATH.open("r", encoding="utf-8", errors="replace") as log_file:
            for line in log_file:
                joined = JOIN_RE.search(line)
                if joined:
                    online.add(joined.group("name").lower())
                    continue
                left = LEAVE_RE.search(line)
                if left:
                    online.discard(left.group("name").lower())
    except OSError:
        return set()
    return online


def build_status() -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    players = read_known_players()
    online_names = read_online_players_from_log()

    server_online = False
    status: dict[str, Any] = {}
    try:
        server_online, status = fetch_server_status()
    except (OSError, EOFError, ValueError, json.JSONDecodeError):
        server_online = False
        status = {}

    status_players = status.get("players") if isinstance(status, dict) else {}
    if not isinstance(status_players, dict):
        status_players = {}

    for sample in status_players.get("sample") or []:
        if not isinstance(sample, dict):
            continue
        name = str(sample.get("name", "")).strip()
        if not name:
            continue
        key = name.lower()
        online_names.add(key)
        players.setdefault(key, {"name": name, "uuid": str(sample.get("id", "")).strip()})

    for key in online_names:
        players.setdefault(key, {"name": key, "uuid": ""})

    player_rows = [
        {
            "name": player["name"],
            "online": key in online_names,
        }
        for key, player in players.items()
    ]
    player_rows.sort(key=lambda item: (not item["online"], item["name"].lower()))

    online_count = int(status_players.get("online") or len(online_names))
    paused, paused_at = read_pause_state(server_online, online_count)
    description = status.get("description") if isinstance(status, dict) else ""
    return {
        "generatedAt": generated_at,
        "serverOnline": server_online,
        "version": status.get("version", {}) if isinstance(status, dict) else {},
        "motd": description,
        "world": read_world_status(server_online, paused, paused_at),
        "onlineCount": online_count,
        "maxPlayers": int(status_players.get("max") or 0),
        "players": player_rows,
    }


def write_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temp_file:
        json.dump(payload, temp_file, ensure_ascii=False, separators=(",", ":"))
        temp_file.write("\n")
        temp_name = temp_file.name
    os.replace(temp_name, path)


def main() -> int:
    if should_keep_paper_plugin_status():
        return 0
    write_atomic(WEB_STATUS_PATH, build_status())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
