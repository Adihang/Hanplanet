#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-${HANPLANET_OFFICE_FONTS_VOLUME:-.local/office-preview-fonts}}"
TMP_DIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

download_file() {
    local url="$1"
    local output="$2"
    if [ -f "$output" ]; then
        return
    fi
    local tmp_output="${output}.tmp"
    curl -fsSL "$url" -o "$tmp_output"
    mv "$tmp_output" "$output"
}

install_pretendard_gov() {
    local target_dir="$ROOT/PretendardGOV"
    local zip_path="$TMP_DIR/PretendardGOV-1.3.9.zip"
    mkdir -p "$target_dir"
    if find "$target_dir" -type f \( -iname 'PretendardGOV-*.otf' -o -iname 'PretendardGOV-*.ttf' \) -print -quit | grep -q .; then
        return
    fi

    curl -fsSL \
        "https://github.com/orioncactus/pretendard/releases/download/v1.3.9/PretendardGOV-1.3.9.zip" \
        -o "$zip_path"
    unzip -q "$zip_path" "public/static/*.otf" "LICENSE.txt" -d "$TMP_DIR/pretendard-gov"
    find "$TMP_DIR/pretendard-gov/public/static" -type f -name "PretendardGOV-*.otf" -exec cp {} "$target_dir/" \;
    cp "$TMP_DIR/pretendard-gov/LICENSE.txt" "$target_dir/LICENSE-PretendardGOV.txt"
}

install_kopub_dotum() {
    local target_dir="$ROOT/KoPub"
    mkdir -p "$target_dir"
    download_file \
        "https://raw.githubusercontent.com/ndb796/Free-Fonts-for-Developers/master/KoPubDotumLight.ttf" \
        "$target_dir/KoPubDotumLight.ttf"
    download_file \
        "https://raw.githubusercontent.com/ndb796/Free-Fonts-for-Developers/master/KoPubDotumMedium.ttf" \
        "$target_dir/KoPubDotumMedium.ttf"
    download_file \
        "https://raw.githubusercontent.com/ndb796/Free-Fonts-for-Developers/master/KoPubDotumBold.ttf" \
        "$target_dir/KoPubDotumBold.ttf"
}

write_readme() {
    cat >"$ROOT/README.txt" <<'EOF'
Hanplanet Office preview fonts

This directory is mounted read-only into Django/Celery containers and is used
only by LibreOffice/fontconfig when converting Office files to PDF previews.

Installed by scripts/install_office_preview_fonts.sh:
- Pretendard GOV 1.3.9 from orioncactus/pretendard
- KoPub Dotum TTF files from a public redistribution mirror

Add extra .ttf/.otf/.ttc files here when PPTX/DOCX files use custom fonts.
After changing fonts, rebuild/restart the Docker Django/Celery services and
clear /data/media/.handrive-office-pdf-cache so previews are regenerated.
EOF
}

require_command curl
require_command unzip
mkdir -p "$ROOT"
install_pretendard_gov
install_kopub_dotum
write_readme

echo "Installed Office preview fonts into: $ROOT"
