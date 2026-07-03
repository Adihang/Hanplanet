#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/Users/imhanbyeol/Development/Hanplanet"
SERVER_DIR="/Users/imhanbyeol/Development/minecraft"
PLUGIN_DIR="$REPO_DIR/minecraft-movement-plugin"
BUILD_DIR="$PLUGIN_DIR/build"
CLASSES_DIR="$BUILD_DIR/classes"
JAR_PATH="$BUILD_DIR/MovementPlus.jar"
PAPER_API_JAR="$SERVER_DIR/libraries/io/papermc/paper/paper-api/26.2.build.31-alpha/paper-api-26.2.build.31-alpha.jar"
JAVA_HOME="$SERVER_DIR/runtime/jdk-25.0.3+9/Contents/Home"
JAVAC="$JAVA_HOME/bin/javac"
JAR="$JAVA_HOME/bin/jar"
CLASSPATH="$PAPER_API_JAR"

while IFS= read -r dependency; do
  CLASSPATH="$CLASSPATH:$dependency"
done < <(find "$SERVER_DIR/libraries" -type f -name "*.jar" | sort)

rm -rf "$BUILD_DIR"
mkdir -p "$CLASSES_DIR"

"$JAVAC" -encoding UTF-8 -cp "$CLASSPATH" -d "$CLASSES_DIR" \
  "$PLUGIN_DIR/src/main/java/dev/movementplus/MovementPlusPlugin.java"

cp "$PLUGIN_DIR/src/main/resources/plugin.yml" "$CLASSES_DIR/plugin.yml"
cp "$PLUGIN_DIR/src/main/resources/config.yml" "$CLASSES_DIR/config.yml"
"$JAR" --create --file "$JAR_PATH" -C "$CLASSES_DIR" .
cp "$JAR_PATH" "$SERVER_DIR/plugins/MovementPlus.jar"

echo "$SERVER_DIR/plugins/MovementPlus.jar"
