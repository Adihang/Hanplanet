#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/Users/imhanbyeol/Development/Hanplanet"
SERVER_DIR="${MINECRAFT_FABRIC_SERVER_DIR:-/Users/imhanbyeol/Development/minecraft-fabric}"
JAVA_HOME="${MINECRAFT_JAVA_HOME:-/Users/imhanbyeol/Development/minecraft/runtime/jdk-25.0.3+9/Contents/Home}"
MOD_DIR="$REPO_DIR/minecraft-sapling-replant"
BUILD_DIR="$MOD_DIR/build"
CLASSES_DIR="$BUILD_DIR/classes"
JAR_PATH="$BUILD_DIR/hanplanet-sapling-replant-1.0.0.jar"

if [[ ! -x "$JAVA_HOME/bin/javac" || ! -f "$SERVER_DIR/versions/26.2/server-26.2.jar" ]]; then
  echo "Fabric 26.2 server or JDK 25 was not found." >&2
  exit 1
fi

find "$CLASSES_DIR" -type f -delete 2>/dev/null || true
mkdir -p "$CLASSES_DIR"

CLASSPATH="$SERVER_DIR/versions/26.2/server-26.2.jar"
while IFS= read -r dependency; do
  CLASSPATH="$CLASSPATH:$dependency"
done < <(find "$SERVER_DIR/libraries" "$SERVER_DIR/.fabric/processedMods" "$SERVER_DIR/mods" -type f -name '*.jar' 2>/dev/null | sort)

"$JAVA_HOME/bin/javac" -encoding UTF-8 -cp "$CLASSPATH" -d "$CLASSES_DIR" \
  "$MOD_DIR/src/main/java/dev/hanplanet/saplingreplant/SaplingReplant.java"
cp "$MOD_DIR/src/main/resources/fabric.mod.json" "$CLASSES_DIR/fabric.mod.json"
"$JAVA_HOME/bin/jar" --create --file "$JAR_PATH" -C "$CLASSES_DIR" .
mkdir -p "$SERVER_DIR/mods"
cp "$JAR_PATH" "$SERVER_DIR/mods/hanplanet-sapling-replant-1.0.0.jar"
echo "$SERVER_DIR/mods/hanplanet-sapling-replant-1.0.0.jar"
