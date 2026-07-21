#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="/Users/imhanbyeol/Development/minecraft"
BLUEMAP_DATA_DIR="/Volumes/HANPLANET_HDD/Hanplanet/minecraft/bluemap"
CONSOLE_INPUT_FIFO="$SERVER_DIR/run/console.in"
CONSOLE_OUTPUT_FILE="$SERVER_DIR/run/console.out"
JAVA_HOME="$SERVER_DIR/runtime/jdk-25.0.3+9/Contents/Home"
JAVA="$JAVA_HOME/bin/java"

cd "$SERVER_DIR"
mkdir -p logs run

if [[ ! -d "$BLUEMAP_DATA_DIR" ]]; then
  echo "BlueMap HDD data directory is not available: $BLUEMAP_DATA_DIR" >&2
  exit 1
fi

ln -sfn "$BLUEMAP_DATA_DIR" "$SERVER_DIR/bluemap"
rm -f "$CONSOLE_INPUT_FIFO"
mkfifo "$CONSOLE_INPUT_FIFO"
chmod 600 "$CONSOLE_INPUT_FIFO"
: > "$CONSOLE_OUTPUT_FILE"
chmod 600 "$CONSOLE_OUTPUT_FILE"
exec 3<> "$CONSOLE_INPUT_FIFO"

"$JAVA" -Djdk.lang.Process.launchMechanism=FORK -Dterminal.jline=false -Dterminal.ansi=false -Xms1G -Xmx4G -jar paper.jar --nogui <&3 2>&1 | tee -a "$CONSOLE_OUTPUT_FILE"
