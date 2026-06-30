#!/bin/sh
set -eu

cd /app

mkdir -p \
    "${DJANGO_DATA_DIR:-/data/django}" \
    "${HANPLANET_MEDIA_ROOT:-/data/media}" \
    "${HPMAIL_STORAGE_ROOT:-/data/mail}" \
    "${HANPLANET_GITHUB_REPO_CACHE_ROOT:-/data/github-repo-cache}" \
    "${HANPLANET_FORGEJO_REPOS_ROOT:-/data/forgejo-repos}" \
    "${DATA_BACKUP_ROOT:-/data/backups}" \
    /app/staticfiles

if [ -n "${BUMPERCAR_SPIKY_SETTINGS_PATH:-}" ] \
    && [ ! -f "$BUMPERCAR_SPIKY_SETTINGS_PATH" ] \
    && [ -f /app/config/bumpercar_spiky_settings.json ]; then
    mkdir -p "$(dirname "$BUMPERCAR_SPIKY_SETTINGS_PATH")"
    cp /app/config/bumpercar_spiky_settings.json "$BUMPERCAR_SPIKY_SETTINGS_PATH"
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    python manage.py migrate --noinput
fi

if [ "${COLLECTSTATIC_ON_START:-true}" = "true" ]; then
    python manage.py collectstatic --noinput
fi

if [ "$#" -gt 0 ]; then
    exec "$@"
fi

exec gunicorn config.wsgi:application \
    --bind "${GUNICORN_BIND:-0.0.0.0:8000}" \
    --workers "${GUNICORN_WORKERS:-3}" \
    --timeout "${GUNICORN_TIMEOUT:-360}" \
    --access-logfile - \
    --error-logfile -
