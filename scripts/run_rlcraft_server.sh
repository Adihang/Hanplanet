#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="${PROMINENCE_SERVER_DIR:-/Users/imhanbyeol/Development/rlcraft}"
JAVA="${PROMINENCE_JAVA:-/usr/bin/java}"
CONSOLE_INPUT_FIFO="$SERVER_DIR/run/console.in"
CONSOLE_OUTPUT_FILE="$SERVER_DIR/run/console.out"

cd "$SERVER_DIR"
mkdir -p logs run

if [[ ! -f "$SERVER_DIR/fabric-server-launcher.jar" ]]; then
  echo "Prominence II Fabric launcher is not installed: $SERVER_DIR/fabric-server-launcher.jar" >&2
  exit 1
fi
if [[ -e "$CONSOLE_INPUT_FIFO" && ! -p "$CONSOLE_INPUT_FIFO" ]]; then
  echo "Console input path is not a FIFO: $CONSOLE_INPUT_FIFO" >&2
  exit 1
fi
if [[ ! -p "$CONSOLE_INPUT_FIFO" ]]; then
  mkfifo "$CONSOLE_INPUT_FIFO"
fi
chmod 600 "$CONSOLE_INPUT_FIFO"
: > "$CONSOLE_OUTPUT_FILE"
chmod 600 "$CONSOLE_OUTPUT_FILE"
exec 3<> "$CONSOLE_INPUT_FIFO"

exec "$JAVA" -Dlog4j2.formatMsgNoLookups=true -Dterminal.jline=false -Dterminal.ansi=false \
  -Xms6G -Xmx8G \
  -jar fabric-server-launcher.jar nogui <&3 2>&1 | tee -a "$CONSOLE_OUTPUT_FILE"
