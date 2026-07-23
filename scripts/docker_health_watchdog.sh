#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${HANPLANET_APP_DIR:-/Users/imhanbyeol/Development/Hanplanet}"
DOCKER_BIN="${DOCKER_BIN:-/opt/homebrew/bin/docker}"
LAUNCHCTL_BIN="${LAUNCHCTL_BIN:-/bin/launchctl}"
DOCKER_STACK_LABEL="${HANPLANET_DOCKER_STACK_LABEL:-com.hanplanet.docker-stack}"
LOCK_DIR="${HANPLANET_DOCKER_WATCHDOG_LOCK_DIR:-/tmp/hanplanet-docker-health-watchdog.lock}"
DEPLOY_REQUEST_PATH="${HANPLANET_DOCKER_DEPLOY_REQUEST_PATH:-/data/django/.hanplanet-docker-stack-deploy-request}"

timestamp() {
  date "+%Y-%m-%dT%H:%M:%S%z"
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*"
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

if ! "$DOCKER_BIN" compose ps >/dev/null 2>&1; then
  launch_domain="gui/$(id -u)"
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
