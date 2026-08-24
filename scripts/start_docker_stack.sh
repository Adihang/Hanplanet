#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${HANPLANET_APP_DIR:-/Users/imhanbyeol/Development/Hanplanet}"
COLIMA_BIN="${COLIMA_BIN:-/opt/homebrew/bin/colima}"
DOCKER_BIN="${DOCKER_BIN:-/opt/homebrew/bin/docker}"
COLIMA_CPU="${COLIMA_CPU:-4}"
COLIMA_MEMORY="${COLIMA_MEMORY:-8}"
COLIMA_DISK="${COLIMA_DISK:-80}"
COLIMA_START_ATTEMPTS="${COLIMA_START_ATTEMPTS:-3}"
COLIMA_RETRY_DELAY_SECONDS="${COLIMA_RETRY_DELAY_SECONDS:-10}"
HDD_MOUNT="${HANPLANET_HDD_MOUNT:-/Volumes/HANPLANET_HDD}"
HDD_WAIT_SECONDS="${HANPLANET_HDD_WAIT_SECONDS:-180}"

timestamp() {
  date "+%Y-%m-%dT%H:%M:%S%z"
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*"
}

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

start_colima() {
  local attempt
  local colima_args=(
    start
    --cpu "$COLIMA_CPU"
    --memory "$COLIMA_MEMORY"
    --disk "$COLIMA_DISK"
    --mount "$HOME:w"
  )

  if [ -d "$HDD_MOUNT" ]; then
    colima_args+=(--mount "$HDD_MOUNT:w")
  fi

  for ((attempt = 1; attempt <= COLIMA_START_ATTEMPTS; attempt += 1)); do
    log "starting Colima attempt=$attempt/$COLIMA_START_ATTEMPTS"
    if "$COLIMA_BIN" "${colima_args[@]}"; then
      return 0
    fi

    if "$COLIMA_BIN" status >/dev/null 2>&1; then
      log "Colima became available after the failed start command"
      return 0
    fi

    log "Colima start failed; clearing stale VM runtime state"
    "$COLIMA_BIN" stop --force || true

    if [ "$attempt" -lt "$COLIMA_START_ATTEMPTS" ]; then
      sleep "$COLIMA_RETRY_DELAY_SECONDS"
    fi
  done

  log "Colima failed to start after $COLIMA_START_ATTEMPTS attempts"
  return 1
}

cd "$APP_DIR"

if [ -f .env ] && grep -q "$HDD_MOUNT" .env; then
  log "waiting for required mount: $HDD_MOUNT"
  if ! wait_for_path "$HDD_MOUNT" "$HDD_WAIT_SECONDS"; then
    log "required mount did not appear within ${HDD_WAIT_SECONDS}s: $HDD_MOUNT"
    exit 1
  fi
fi

if ! "$COLIMA_BIN" status >/dev/null 2>&1; then
  # A macOS reboot can leave Lima's pid/socket files behind even though the
  # VM is no longer running. Clear that stale runtime before the first start
  # attempt so launchd does not spend a full retry cycle exposing a partial
  # Docker stack.
  log "Colima is not running; clearing stale VM runtime state"
  "$COLIMA_BIN" stop --force >/dev/null 2>&1 || true
  start_colima
fi

log "starting Docker Compose services"
# Containers with restart: unless-stopped may come back as soon as Docker
# becomes available after a reboot. Keep the old nginx instance down while
# Compose waits for Django's healthcheck, otherwise Cloudflare can observe a
# transient 502 from nginx before the upstream is ready.
existing_nginx_container="$("$DOCKER_BIN" compose ps -q nginx 2>/dev/null || true)"
if [ -n "$existing_nginx_container" ]; then
  log "stopping existing nginx until the Compose health gate is satisfied"
  "$DOCKER_BIN" compose stop nginx >/dev/null
fi
"$DOCKER_BIN" compose up -d --remove-orphans --wait --wait-timeout 180
"$DOCKER_BIN" compose ps
log "Docker Compose services started"
