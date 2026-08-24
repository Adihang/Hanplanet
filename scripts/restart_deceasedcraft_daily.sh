#!/usr/bin/env bash
set -euo pipefail

# The game server is still registered under the legacy rlcraft launchd label.
SERVER_LABEL="${DECEASEDCRAFT_SERVER_LABEL:-com.hanplanet.rlcraft}"
SERVER_DIR="${DECEASEDCRAFT_SERVER_DIR:-/Users/imhanbyeol/Development/deceasedcraft}"
CONSOLE_FIFO="${DECEASEDCRAFT_CONSOLE_INPUT_PATH:-$SERVER_DIR/run/console.in}"
LOCK_DIR="${DECEASEDCRAFT_DAILY_RESTART_LOCK_DIR:-/tmp/hanplanet-deceasedcraft-daily-restart.lock}"
LAUNCHCTL_BIN="${LAUNCHCTL_BIN:-/bin/launchctl}"
LAUNCH_DOMAIN="gui/$(id -u)"
DRY_RUN="${DECEASEDCRAFT_DAILY_RESTART_DRY_RUN:-0}"

timestamp() {
  date "+%Y-%m-%dT%H:%M:%S%z"
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*"
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "another scheduled restart is already running; skipping"
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

send_console_line() {
  local command="$1"
  local writer_pid

  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run console command: $command"
    return 0
  fi

  if [[ ! -p "$CONSOLE_FIFO" ]]; then
    return 1
  fi

  printf '%s\n' "$command" > "$CONSOLE_FIFO" &
  writer_pid=$!
  for _ in $(seq 1 50); do
    if ! kill -0 "$writer_pid" 2>/dev/null; then
      if wait "$writer_pid" 2>/dev/null; then
        return 0
      fi
      return 1
    fi
    sleep 0.1
  done

  kill "$writer_pid" 2>/dev/null || true
  wait "$writer_pid" 2>/dev/null || true
  return 1
}

kickstart_server() {
  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run launchd kickstart: $SERVER_LABEL"
    return 0
  fi
  "$LAUNCHCTL_BIN" kickstart -k "$LAUNCH_DOMAIN/$SERVER_LABEL"
}

log "starting scheduled DeceasedCraft restart"

# A normal run uses the same graceful console path as the admin restart. If
# the console channel is unavailable, launchd is the recovery path.
if send_console_line "say [Hanplanet] 10초 후 서버가 재시작 합니다."; then
  sleep 1
  for remaining_seconds in 9 8 7 6 5 4 3 2 1; do
    if ! send_console_line "say [Hanplanet] ${remaining_seconds}"; then
      log "console countdown failed; requesting launchd restart"
      kickstart_server
      exit 0
    fi
    sleep 1
  done

  if send_console_line "say [Hanplanet] 서버를 재시작합니다." && send_console_line "stop"; then
    log "graceful restart requested"
    exit 0
  fi
  log "graceful stop failed; requesting launchd restart"
fi

kickstart_server
log "launchd restart requested"
