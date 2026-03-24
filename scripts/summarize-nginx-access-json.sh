#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/Users/imhanbyeol/Development/Hanplanet}"
PYTHON_BIN="${PYTHON_BIN:-/usr/bin/python3}"
export PYTHONPATH="${PYTHONPATH:-$PROJECT_DIR/.venv/lib/python3.9/site-packages}"
MANAGE_PY="${MANAGE_PY:-$PROJECT_DIR/manage.py}"
TOP_N="${TOP_N:-10}"
SLOW_N="${SLOW_N:-20}"
LOG_DIR="${LOG_DIR:-}"
SUMMARY_DIR="${SUMMARY_DIR:-}"

if date -v-1d '+%Y-%m-%d' >/dev/null 2>&1; then
    DEFAULT_TARGET_DATE="$(date -v-1d '+%Y-%m-%d')"
elif date -d 'yesterday' '+%Y-%m-%d' >/dev/null 2>&1; then
    DEFAULT_TARGET_DATE="$(date -d 'yesterday' '+%Y-%m-%d')"
else
    echo "Cannot compute yesterday date with this 'date' command." >&2
    exit 1
fi

TARGET_DATE="${TARGET_DATE:-$DEFAULT_TARGET_DATE}"

if [[ ! -x "$PYTHON_BIN" ]]; then
    echo "Python binary not found: $PYTHON_BIN" >&2
    exit 1
fi

if [[ ! -f "$MANAGE_PY" ]]; then
    echo "manage.py not found: $MANAGE_PY" >&2
    exit 1
fi

cd "$PROJECT_DIR"
cmd_args=(
    summarize_access_logs
    --date "$TARGET_DATE"
    --top-n "$TOP_N"
    --slow-n "$SLOW_N"
)

if [[ -n "$LOG_DIR" ]]; then
    cmd_args+=(--log-dir "$LOG_DIR")
fi

if [[ -n "$SUMMARY_DIR" ]]; then
    cmd_args+=(--summary-dir "$SUMMARY_DIR")
fi

"$PYTHON_BIN" "$MANAGE_PY" "${cmd_args[@]}"
