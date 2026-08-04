#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${PROMINENCE_SOURCE_DIR:-/Users/imhanbyeol/Development/prominence-downloads}"
OUTPUT_DIR="${PROMINENCE_OUTPUT_DIR:-/Volumes/HANPLANET_HDD/Hanplanet/media/minecraft}"
CLIENT_ZIP="$SOURCE_DIR/Prominence_II_Hasturian_Era_v3.9.27.zip"
SERVER_ZIP="$SOURCE_DIR/Prominence_II_Hasturian_Era_Server_Pack_v3.9.27.zip"
KO_RESOURCE_ZIP="$SOURCE_DIR/Prominence_II_v3.9.27_ko_resourcepack.zip"
KO_OVERRIDES_ZIP="$SOURCE_DIR/Prominence_II_v3.9.27_ko_overrides.zip"
ARCHITECTURY_ENTRY="mods/architectury-9.2.14-fabric.jar"
FABRIC_API_ENTRY="mods/fabric-api-0.92.7+1.20.1.jar"
README_SOURCE="$(cd "$(dirname "$0")/.." && pwd)/docs/prominence_ii_client_pack_readme.txt"
OUTPUT_ZIP="$OUTPUT_DIR/Hanplanet_Prominence_II_v3.9.27_ko.zip"
WORK_DIR="$(mktemp -d /tmp/hanplanet-prominence-ii.XXXXXX)"

for required_file in "$CLIENT_ZIP" "$SERVER_ZIP" "$KO_RESOURCE_ZIP" "$KO_OVERRIDES_ZIP" "$README_SOURCE"; do
    if [[ ! -f "$required_file" ]]; then
        echo "Required source file is missing: $required_file" >&2
        exit 1
    fi
done

mkdir -p "$OUTPUT_DIR" "$WORK_DIR/client/overrides/mods" "$WORK_DIR/client/overrides/resourcepacks"
unzip -q "$CLIENT_ZIP" -d "$WORK_DIR/client"
unzip -q -o "$KO_OVERRIDES_ZIP" -d "$WORK_DIR/client/overrides"
unzip -p "$SERVER_ZIP" "$ARCHITECTURY_ENTRY" > "$WORK_DIR/client/overrides/$ARCHITECTURY_ENTRY"
test -s "$WORK_DIR/client/overrides/$ARCHITECTURY_ENTRY"
unzip -p "$SERVER_ZIP" "$FABRIC_API_ENTRY" > "$WORK_DIR/client/overrides/$FABRIC_API_ENTRY"
test -s "$WORK_DIR/client/overrides/$FABRIC_API_ENTRY"
cp "$KO_RESOURCE_ZIP" "$WORK_DIR/client/overrides/resourcepacks/Prominence_II_3.9.27_Korean.zip"
cp "$README_SOURCE" "$WORK_DIR/client/HANPLANET_KOREAN_INSTALL.txt"

# Enable Korean by default while preserving the official pack's normal vanilla
# resource pack.
printf '%s\n' \
    'lang:ko_kr' \
    'resourcePacks:["vanilla","file/Prominence_II_3.9.27_Korean.zip"]' \
    > "$WORK_DIR/client/overrides/options.txt"

rm -f "$OUTPUT_ZIP"
(cd "$WORK_DIR/client" && zip -qr "$OUTPUT_ZIP" .)
shasum -a 256 "$OUTPUT_ZIP"
ls -lh "$OUTPUT_ZIP"
