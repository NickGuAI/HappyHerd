#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_PATH="${1:-}"
ENV_FILE="${2:-/etc/happyherd/runtime.env}"

[[ -n "$MANIFEST_PATH" ]] || {
    printf 'error: usage: rollback-release.sh MANIFEST [RUNTIME_ENV]\n' >&2
    exit 1
}

exec "$ROOT/scripts/activate-release.sh" "$MANIFEST_PATH" "$ENV_FILE" previous
