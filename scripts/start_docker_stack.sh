#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${HANPLANET_APP_DIR:-/Users/imhanbyeol/Development/Hanplanet}"
COLIMA_BIN="${COLIMA_BIN:-/opt/homebrew/bin/colima}"
DOCKER_BIN="${DOCKER_BIN:-/opt/homebrew/bin/docker}"
COLIMA_CPU="${COLIMA_CPU:-4}"
COLIMA_MEMORY="${COLIMA_MEMORY:-8}"
COLIMA_DISK="${COLIMA_DISK:-80}"
HDD_MOUNT="${HANPLANET_HDD_MOUNT:-/Volumes/HANPLANET_HDD}"
HDD_WAIT_SECONDS="${HANPLANET_HDD_WAIT_SECONDS:-180}"

wait_for_path() {
  local path="$1"
  local timeout="$2"
  local waited=0

  while [ ! -d "$path" ] && [ "$waited" -lt "$timeout" ]; do
    sleep 5
    waited=$((waited + 5))
  done

  [ -d "$path" ]
}

cd "$APP_DIR"

if [ -f .env ] && grep -q "$HDD_MOUNT" .env; then
  wait_for_path "$HDD_MOUNT" "$HDD_WAIT_SECONDS"
fi

if ! "$COLIMA_BIN" status >/dev/null 2>&1; then
  colima_args=(
    start
    --cpu "$COLIMA_CPU"
    --memory "$COLIMA_MEMORY"
    --disk "$COLIMA_DISK"
    --mount "$HOME:w"
  )

  if [ -d "$HDD_MOUNT" ]; then
    colima_args+=(--mount "$HDD_MOUNT:w")
  fi

  "$COLIMA_BIN" "${colima_args[@]}"
fi

"$DOCKER_BIN" compose up -d --remove-orphans
"$DOCKER_BIN" compose ps
