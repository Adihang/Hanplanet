#!/bin/sh
set -eu

custom_dir="${GITEA_CUSTOM:-/data/gitea}"
source_dir="/opt/hanplanet-gitea-custom"

sync_custom_dir() {
  name="$1"
  src="$source_dir/$name"
  dest="$custom_dir/$name"

  if [ -d "$src" ]; then
    rm -rf "$dest"
    mkdir -p "$custom_dir"
    cp -a "$src" "$dest"
  fi
}

sync_custom_dir templates
sync_custom_dir public

exec /usr/bin/entrypoint "$@"
