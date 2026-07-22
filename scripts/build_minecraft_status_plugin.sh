#!/bin/bash
set -euo pipefail

REPO_DIR="/Users/imhanbyeol/Development/Hanplanet"
SERVER_DIR="/Users/imhanbyeol/Development/minecraft"
PLUGIN_DIR="$REPO_DIR/minecraft-status-plugin"
BUILD_DIR="$PLUGIN_DIR/build"
CLASSES_DIR="$BUILD_DIR/classes"
JAR_PATH="$BUILD_DIR/MinecraftStatusBridge.jar"
PAPER_API_JAR="$SERVER_DIR/libraries/io/papermc/paper/paper-api/26.2.build.34-alpha/paper-api-26.2.build.34-alpha.jar"
JAVA_HOME="$SERVER_DIR/runtime/jdk-25.0.3+9/Contents/Home"
JAVA="$JAVA_HOME/bin/java"
JAVAC=("$JAVA" -m jdk.compiler/com.sun.tools.javac.Main)
JAR=("$JAVA" -m jdk.jartool/sun.tools.jar.Main)
CLASSPATH="$PAPER_API_JAR"

find_latest_jar() {
  local root="$1"
  local pattern="$2"
  find "$root" -type f -name "$pattern" 2>/dev/null | sort | tail -n 1
}

DEPENDENCY_JARS=(
  "$(find_latest_jar "$SERVER_DIR/libraries/net/kyori/adventure-api" "adventure-api-*.jar")"
  "$(find_latest_jar "$SERVER_DIR/libraries/net/kyori/adventure-key" "adventure-key-*.jar")"
  "$(find_latest_jar "$SERVER_DIR/libraries/net/kyori/examination-api" "examination-api-*.jar")"
  "$(find_latest_jar "$SERVER_DIR/libraries/net/kyori/examination-string" "examination-string-*.jar")"
  "$(find_latest_jar "$SERVER_DIR/libraries/com/google/guava/guava" "guava-*.jar")"
  "$(find_latest_jar "$SERVER_DIR/libraries/com/google/guava/failureaccess" "failureaccess-*.jar")"
  "$(find_latest_jar "$SERVER_DIR/libraries/net/md-5/bungeecord-chat" "bungeecord-chat-*.jar")"
  "$(find_latest_jar "$HOME/.gradle/wrapper/dists" "annotations-*.jar")"
)

for dependency in "${DEPENDENCY_JARS[@]}"; do
  if [[ -z "$dependency" || ! -f "$dependency" ]]; then
    echo "Missing compile dependency for MinecraftStatusBridge." >&2
    exit 1
  fi
  CLASSPATH="$CLASSPATH:$dependency"
done

rm -rf "$BUILD_DIR"
mkdir -p "$CLASSES_DIR"

"${JAVAC[@]}" -encoding UTF-8 -cp "$CLASSPATH" -d "$CLASSES_DIR" \
  "$PLUGIN_DIR/src/main/java/dev/minecraftstatus/bridge/MinecraftStatusBridgePlugin.java"

cp "$PLUGIN_DIR/src/main/resources/plugin.yml" "$CLASSES_DIR/plugin.yml"
cp "$REPO_DIR/static/media/icons/minecraft/items/labels_ko_kr.json" "$CLASSES_DIR/trade_item_labels_ko_kr.json"
"${JAR[@]}" --create --file "$JAR_PATH" -C "$CLASSES_DIR" .
rm -f "$SERVER_DIR/plugins/HanplanetStatus.jar"
cp "$JAR_PATH" "$SERVER_DIR/plugins/MinecraftStatusBridge.jar"

echo "$SERVER_DIR/plugins/MinecraftStatusBridge.jar"
