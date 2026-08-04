#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${HANPLANET_APP_DIR:-/Users/imhanbyeol/Development/Hanplanet}"
DOCKER_BIN="${DOCKER_BIN:-/opt/homebrew/bin/docker}"
LAUNCHCTL_BIN="${LAUNCHCTL_BIN:-/bin/launchctl}"
DOCKER_STACK_LABEL="${HANPLANET_DOCKER_STACK_LABEL:-com.hanplanet.docker-stack}"
LOCK_DIR="${HANPLANET_DOCKER_WATCHDOG_LOCK_DIR:-/tmp/hanplanet-docker-health-watchdog.lock}"
DEPLOY_REQUEST_PATH="${HANPLANET_DOCKER_DEPLOY_REQUEST_PATH:-/data/django/.hanplanet-docker-stack-deploy-request}"
RLCRAFT_RESTART_REQUEST_PATH="${HANPLANET_RLCRAFT_RESTART_REQUEST_PATH:-/data/django/.hanplanet-prominence-restart-request}"
RLCRAFT_RESTART_STATE_PATH="${HANPLANET_RLCRAFT_RESTART_STATE_PATH:-/data/django/.hanplanet-prominence-restart-state.json}"
PROMINENCE_SERVER_DIR="${PROMINENCE_SERVER_DIR:-/Users/imhanbyeol/Development/rlcraft}"
PROMINENCE_SERVER_LABEL="${PROMINENCE_SERVER_LABEL:-com.hanplanet.rlcraft}"
PROMINENCE_SERVER_PORT="${PROMINENCE_SERVER_PORT:-25566}"
MINECRAFT_RESTART_REQUEST_PATH="${HANPLANET_MINECRAFT_RESTART_REQUEST_PATH:-/data/django/.hanplanet-minecraft-restart-request}"
MINECRAFT_RESTART_STATE_PATH="${HANPLANET_MINECRAFT_RESTART_STATE_PATH:-/data/django/.hanplanet-minecraft-restart-state.json}"
MINECRAFT_SERVER_DIR="${MINECRAFT_SERVER_DIR:-/Users/imhanbyeol/Development/minecraft-fabric}"
MINECRAFT_SERVER_LABEL="${MINECRAFT_SERVER_LABEL:-com.hanplanet.minecraft}"
MINECRAFT_SERVER_PORT="${MINECRAFT_SERVER_PORT:-25565}"
NC_BIN="${NC_BIN:-/usr/bin/nc}"
launch_domain="gui/$(id -u)"

timestamp() {
  date "+%Y-%m-%dT%H:%M:%S%z"
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*"
}

write_rlcraft_restart_state() {
  local phase="$1"
  local updated_at
  updated_at="$(date +%s)"
  "$DOCKER_BIN" compose exec -T django sh -c '
    path="$1"
    phase="$2"
    updated_at="$3"
    temporary_path="${path}.tmp.$$"
    printf '\''{"phase":"%s","updated_at":%s}\n'\'' "$phase" "$updated_at" > "$temporary_path" && mv -f "$temporary_path" "$path"
  ' sh "$RLCRAFT_RESTART_STATE_PATH" "$phase" "$updated_at" >/dev/null 2>&1 || log "could not persist Prominence II restart phase: $phase"
}

port_is_listening() {
  [ -n "$NC_BIN" ] && "$NC_BIN" -z -w 1 127.0.0.1 "$PROMINENCE_SERVER_PORT" >/dev/null 2>&1
}

wait_for_prominence_restart() {
  local was_listening="$1"
  local deadline
  local log_tail
  deadline=$(( $(date +%s) + 180 ))

  if [ "$was_listening" = "true" ]; then
    while port_is_listening && [ "$(date +%s)" -lt "$deadline" ]; do
      sleep 1
    done
  fi

  while [ "$(date +%s)" -lt "$deadline" ]; do
    if port_is_listening; then
      log_tail="$(tail -n 600 "$PROMINENCE_SERVER_DIR/logs/latest.log" 2>/dev/null || true)"
      if printf '%s\n' "$log_tail" | grep -q 'Done ('; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

write_minecraft_restart_state() {
  local phase="$1"
  local updated_at
  updated_at="$(date +%s)"
  "$DOCKER_BIN" compose exec -T django sh -c '
    path="$1"
    phase="$2"
    updated_at="$3"
    temporary_path="${path}.tmp.$$"
    printf '\''{"phase":"%s","updated_at":%s}\n'\'' "$phase" "$updated_at" > "$temporary_path" && mv -f "$temporary_path" "$path"
  ' sh "$MINECRAFT_RESTART_STATE_PATH" "$phase" "$updated_at" >/dev/null 2>&1 || log "could not persist Minecraft restart phase: $phase"
}

minecraft_port_is_listening() {
  [ -n "$NC_BIN" ] && "$NC_BIN" -z -w 1 127.0.0.1 "$MINECRAFT_SERVER_PORT" >/dev/null 2>&1
}

wait_for_minecraft_restart() {
  local was_listening="$1"
  local deadline
  local log_tail
  deadline=$(( $(date +%s) + 180 ))

  if [ "$was_listening" = "true" ]; then
    while minecraft_port_is_listening && [ "$(date +%s)" -lt "$deadline" ]; do
      sleep 1
    done
  fi

  while [ "$(date +%s)" -lt "$deadline" ]; do
    if minecraft_port_is_listening; then
      log_tail="$(tail -n 600 "$MINECRAFT_SERVER_DIR/logs/latest.log" 2>/dev/null || true)"
      if printf '%s\n' "$log_tail" | grep -q 'Done ('; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "previous watchdog run is still active; skipping"
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -d "$APP_DIR" ]; then
  log "app directory not found: $APP_DIR"
  exit 0
fi

cd "$APP_DIR"

if [ ! -x "$DOCKER_BIN" ]; then
  DOCKER_BIN="$(command -v docker || true)"
fi

if [ -z "$DOCKER_BIN" ]; then
  log "docker binary not found"
  exit 0
fi

if [ ! -x "$NC_BIN" ]; then
  NC_BIN="$(command -v nc || true)"
fi

if ! "$DOCKER_BIN" compose ps >/dev/null 2>&1; then
  log "docker compose ps is unavailable; requesting Docker stack startup"
  if ! "$LAUNCHCTL_BIN" kickstart "$launch_domain/$DOCKER_STACK_LABEL"; then
    log "failed to request Docker stack startup"
  fi
  exit 0
fi

services="$("$DOCKER_BIN" compose ps --services 2>/dev/null || true)"

if [ -z "$services" ]; then
  log "no compose services found"
  exit 0
fi

restart_services=""
checked_count=0
starting_count=0
unhealthy_count=0
failed=0

# Django cannot access launchctl from its container. A superuser-only RLC
# control request is written to the persistent Django volume, then consumed
# here by the host watchdog. Prefer the server console stop command so the
# world is saved before launchd's KeepAlive starts it again.
rlcraft_restart_token="$("$DOCKER_BIN" compose exec -T django sh -c 'cat "$1"' sh "$RLCRAFT_RESTART_REQUEST_PATH" 2>/dev/null || true)"
if [ -n "$rlcraft_restart_token" ]; then
  rlcraft_fifo="$PROMINENCE_SERVER_DIR/run/console.in"
  restart_requested=false
  was_listening=false
  if port_is_listening; then
    was_listening=true
  fi
  write_rlcraft_restart_state "stopping"
  if [ -p "$rlcraft_fifo" ]; then
    printf 'stop\n' > "$rlcraft_fifo" &
    fifo_writer_pid=$!
    for _ in $(seq 1 50); do
      if ! kill -0 "$fifo_writer_pid" 2>/dev/null; then
        wait "$fifo_writer_pid" 2>/dev/null || true
        restart_requested=true
        break
      fi
      sleep 0.1
    done
    if ! $restart_requested; then
      kill "$fifo_writer_pid" 2>/dev/null || true
      wait "$fifo_writer_pid" 2>/dev/null || true
    fi
  fi

  if ! $restart_requested; then
    log "Prominence II console channel unavailable; requesting launchd restart"
    if "$LAUNCHCTL_BIN" kickstart -k "gui/$(id -u)/$PROMINENCE_SERVER_LABEL"; then
      restart_requested=true
    else
      log "Prominence II launchd restart request failed"
      failed=1
    fi
  fi

  if $restart_requested; then
    write_rlcraft_restart_state "starting"
    if "$DOCKER_BIN" compose exec -T django sh -c '[ "$(cat "$1" 2>/dev/null)" = "$2" ] && rm -f "$1"' sh "$RLCRAFT_RESTART_REQUEST_PATH" "$rlcraft_restart_token"; then
      log "Prominence II restart request completed"
      if wait_for_prominence_restart "$was_listening"; then
        write_rlcraft_restart_state "ready"
        log "Prominence II restart completed"
      else
        write_rlcraft_restart_state "failed"
        log "Prominence II restart did not become ready before timeout"
        failed=1
      fi
    else
      log "Prominence II restart started but request marker could not be cleared; retrying next cycle"
      write_rlcraft_restart_state "failed"
      failed=1
    fi
  fi
fi

# Django cannot access launchctl from its container. A superuser-only Minecraft
# control request is written to the persistent Django volume, then consumed
# here by the host watchdog. Stop through the server FIFO so the world is saved
# before launchd's KeepAlive starts the service again.
minecraft_restart_token="$($DOCKER_BIN compose exec -T django sh -c 'cat "$1"' sh "$MINECRAFT_RESTART_REQUEST_PATH" 2>/dev/null || true)"
if [ -n "$minecraft_restart_token" ]; then
  minecraft_fifo="$MINECRAFT_SERVER_DIR/run/console.in"
  restart_requested=false
  was_listening=false
  if minecraft_port_is_listening; then
    was_listening=true
  fi
  write_minecraft_restart_state "stopping"
  if [ -p "$minecraft_fifo" ]; then
    printf 'stop\n' > "$minecraft_fifo" &
    fifo_writer_pid=$!
    for _ in $(seq 1 50); do
      if ! kill -0 "$fifo_writer_pid" 2>/dev/null; then
        wait "$fifo_writer_pid" 2>/dev/null || true
        restart_requested=true
        break
      fi
      sleep 0.1
    done
    if ! $restart_requested; then
      kill "$fifo_writer_pid" 2>/dev/null || true
      wait "$fifo_writer_pid" 2>/dev/null || true
    fi
  fi

  if ! $restart_requested; then
    log "Minecraft console channel unavailable; requesting launchd restart"
    if "$LAUNCHCTL_BIN" kickstart -k "gui/$(id -u)/$MINECRAFT_SERVER_LABEL"; then
      restart_requested=true
    else
      log "Minecraft launchd restart request failed"
      failed=1
    fi
  fi

  if $restart_requested; then
    write_minecraft_restart_state "starting"
    if "$DOCKER_BIN" compose exec -T django sh -c '[ "$(cat "$1" 2>/dev/null)" = "$2" ] && rm -f "$1"' sh "$MINECRAFT_RESTART_REQUEST_PATH" "$minecraft_restart_token"; then
      log "Minecraft restart request completed"
      if wait_for_minecraft_restart "$was_listening"; then
        write_minecraft_restart_state "ready"
        log "Minecraft restart completed"
      else
        write_minecraft_restart_state "failed"
        log "Minecraft restart did not become ready before timeout"
        failed=1
      fi
    else
      log "Minecraft restart started but request marker could not be cleared; retrying next cycle"
      write_minecraft_restart_state "failed"
      failed=1
    fi
  fi
fi

# Django cannot access the host Docker socket by design.  The superuser-only
# maintenance button leaves this marker on the persistent Django volume; this
# host-side watchdog owns the rebuild and service replacement. Keep the marker
# token so a second click during a build is not accidentally discarded.
deploy_request_token="$("$DOCKER_BIN" compose exec -T django sh -c 'cat "$1"' sh "$DEPLOY_REQUEST_PATH" 2>/dev/null || true)"
if [ -n "$deploy_request_token" ]; then
  log "static/resource deployment requested; rebuilding Django, Celery, and Nginx services"
  if "$DOCKER_BIN" compose up -d --build django celery celery-beat nginx; then
    if "$DOCKER_BIN" compose exec -T django sh -c '[ "$(cat "$1" 2>/dev/null)" = "$2" ] && rm -f "$1"' sh "$DEPLOY_REQUEST_PATH" "$deploy_request_token"; then
      log "static/resource deployment completed"
    else
      log "deployment completed but request marker changed or could not be cleared; retrying next cycle"
      failed=1
    fi
  else
    log "static/resource deployment failed; request marker retained for retry"
    failed=1
  fi
fi

for service in $services; do
  container_ids="$("$DOCKER_BIN" compose ps -q "$service" 2>/dev/null || true)"

  if [ -z "$container_ids" ]; then
    continue
  fi

  for container_id in $container_ids; do
    health="$("$DOCKER_BIN" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || true)"
    state="$("$DOCKER_BIN" inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"

    if [ -z "$health" ]; then
      health="inspect-failed"
    fi

    if [ -z "$state" ]; then
      state="inspect-failed"
    fi

    if [ "$health" = "none" ]; then
      continue
    fi

    checked_count=$((checked_count + 1))

    case "$health" in
      healthy)
        ;;
      starting)
        starting_count=$((starting_count + 1))
        log "service=$service container=${container_id:0:12} state=$state health=starting; waiting"
        ;;
      unhealthy)
        unhealthy_count=$((unhealthy_count + 1))
        log "service=$service container=${container_id:0:12} state=$state health=unhealthy; scheduling restart"
        case " $restart_services " in
          *" $service "*)
            ;;
          *)
            restart_services="${restart_services:+$restart_services }$service"
            ;;
        esac
        ;;
      *)
        log "service=$service container=${container_id:0:12} state=$state health=$health; no automatic action"
        ;;
    esac
  done
done

for service in $restart_services; do
  log "restarting service=$service"
  if "$DOCKER_BIN" compose restart "$service"; then
    log "restarted service=$service"
  else
    log "failed to restart service=$service"
    failed=1
  fi
done

if [ "$checked_count" -eq 0 ]; then
  log "no running compose services with docker healthchecks"
elif [ -z "$restart_services" ]; then
  log "checked=$checked_count starting=$starting_count unhealthy=0"
else
  log "checked=$checked_count starting=$starting_count unhealthy=$unhealthy_count restarted=$restart_services"
fi

exit "$failed"
