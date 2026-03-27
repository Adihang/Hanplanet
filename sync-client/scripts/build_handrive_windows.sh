#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H=windowsgui" -o handrive.exe ./cmd/handrive
