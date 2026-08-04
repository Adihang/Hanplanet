#!/usr/bin/env python3
"""Forward authenticated console commands from Docker to the host FIFO."""

from __future__ import annotations

import hmac
import os
import socket
import stat
import threading
from pathlib import Path


HOST = os.environ.get("PROMINENCE_CONSOLE_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("PROMINENCE_CONSOLE_BRIDGE_PORT", "25576"))
TOKEN = os.environ.get("PROMINENCE_CONSOLE_BRIDGE_TOKEN", "")
FIFO_PATH = Path(
    os.environ.get(
        "PROMINENCE_CONSOLE_INPUT_PATH",
        "/Users/imhanbyeol/Development/rlcraft/run/console.in",
    )
)
MAX_COMMAND_BYTES = 4096


def _send_response(connection: socket.socket, message: str) -> None:
    connection.sendall((message + "\n").encode("utf-8"))


def _handle_connection(connection: socket.socket) -> None:
    with connection:
        connection.settimeout(5)
        data = bytearray()
        while len(data) <= MAX_COMMAND_BYTES:
            chunk = connection.recv(min(1024, MAX_COMMAND_BYTES + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
            if b"\n" in chunk:
                break

        if len(data) > MAX_COMMAND_BYTES or b"\n" not in data:
            _send_response(connection, "ERR invalid_request")
            return

        request_line = bytes(data).split(b"\n", 1)[0].decode("utf-8", errors="strict")
        supplied_token, separator, command = request_line.partition("\t")
        if not separator or not TOKEN or not hmac.compare_digest(supplied_token, TOKEN):
            _send_response(connection, "ERR unauthorized")
            return

        command = command.strip()
        if not command or "\x00" in command or "\r" in command or "\n" in command:
            _send_response(connection, "ERR invalid_command")
            return

        try:
            fifo_stat = FIFO_PATH.stat()
            if not stat.S_ISFIFO(fifo_stat.st_mode):
                raise OSError("console_input_invalid")
            fifo_fd = os.open(FIFO_PATH, os.O_WRONLY | os.O_NONBLOCK)
            try:
                os.write(fifo_fd, (command + "\n").encode("utf-8"))
            finally:
                os.close(fifo_fd)
        except OSError:
            _send_response(connection, "ERR console_unavailable")
            return

        _send_response(connection, "OK")


def main() -> None:
    if not TOKEN:
        raise SystemExit("PROMINENCE_CONSOLE_BRIDGE_TOKEN is required")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((HOST, PORT))
        server.listen(16)
        while True:
            connection, _address = server.accept()
            thread = threading.Thread(target=_handle_connection, args=(connection,), daemon=True)
            thread.start()


if __name__ == "__main__":
    main()
