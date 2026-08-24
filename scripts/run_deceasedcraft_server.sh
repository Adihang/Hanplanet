#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="${DECEASEDCRAFT_SERVER_DIR:-/Users/imhanbyeol/Development/deceasedcraft}"
JAVA="${DECEASEDCRAFT_JAVA:-/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java}"
FORGE_ARGS="$SERVER_DIR/libraries/net/minecraftforge/forge/1.20.1-47.4.0/unix_args.txt"
CONSOLE_INPUT_FIFO="$SERVER_DIR/run/console.in"
CONSOLE_OUTPUT_FILE="$SERVER_DIR/run/console.out"

cd "$SERVER_DIR"
mkdir -p logs run

if [[ ! -f "$FORGE_ARGS" ]]; then
  echo "DeceasedCraft Forge arguments are not installed: $FORGE_ARGS" >&2
  exit 1
fi
if [[ ! -x "$JAVA" ]]; then
  echo "Java 21 is not installed: $JAVA" >&2
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
  @user_jvm_args.txt @"$FORGE_ARGS" nogui <&3 2>&1 | tee -a "$CONSOLE_OUTPUT_FILE"
