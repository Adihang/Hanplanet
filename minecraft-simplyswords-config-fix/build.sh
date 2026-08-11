#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER_ROOT="${PROMINENCE_SERVER_DIR:-/Users/imhanbyeol/Development/rlcraft}"
BUILD="$ROOT/build"
CLASS_DIR="$BUILD/classes"
OUT="$BUILD/hanplanet-simplyswords-config-fix-1.0.0.jar"

rm -rf "$CLASS_DIR" "$OUT"
mkdir -p "$CLASS_DIR"

MINECRAFT="$SERVER_ROOT/.fabric/remappedJars/minecraft-1.20.1-0.19.3/server-intermediary.jar"
MIXIN="$SERVER_ROOT/libraries/net/fabricmc/sponge-mixin/0.17.3+mixin.0.8.7/sponge-mixin-0.17.3+mixin.0.8.7.jar"
GSON="$SERVER_ROOT/libraries/com/google/code/gson/gson/2.10/gson-2.10.jar"
SIMPLY_SWORDS="$SERVER_ROOT/mods/simplyswords-1.56.0-1.20.1.jar"

for file in "$MINECRAFT" "$MIXIN" "$GSON" "$SIMPLY_SWORDS"; do
  [[ -f "$file" ]] || { echo "Missing dependency: $file" >&2; exit 1; }
done

javac \
  -encoding UTF-8 \
  -proc:none \
  -cp "$MINECRAFT:$MIXIN:$GSON:$SIMPLY_SWORDS" \
  -d "$CLASS_DIR" \
  $(find "$ROOT/src/main/java" -name '*.java' -print)

cp -R "$ROOT/src/main/resources/." "$CLASS_DIR/"
jar --create --file "$OUT" -C "$CLASS_DIR" .
printf '%s\n' "$OUT"
