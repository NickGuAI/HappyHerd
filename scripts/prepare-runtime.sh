#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/runtime-config.sh
source "$ROOT/scripts/lib/runtime-config.sh"

ENV_FILE="${1:-/etc/happyherd/runtime.env}"
[[ "$(id -u)" -eq 0 ]] || {
    printf 'error: prepare-runtime.sh must run as root\n' >&2
    exit 1
}

happyherd_load_runtime_config "$ENV_FILE"

install -d -m 0750 "$HAPPYHERD_DATA_DIR" "$HAPPYHERD_LOG_DIR" "$HAPPYHERD_CLI_HOME"
install -d -m 0750 "$(dirname "$HAPPYHERD_MASTER_SECRET_FILE")"

if [[ ! -f "$HAPPYHERD_MASTER_SECRET_FILE" ]]; then
    umask 077
    openssl rand -hex 32 > "$HAPPYHERD_MASTER_SECRET_FILE"
fi
chmod 0600 "$HAPPYHERD_MASTER_SECRET_FILE"

"$ROOT/scripts/validate-runtime-isolation.sh" "$ENV_FILE" runtime
printf 'HappyHerd runtime directories and secret are ready.\n'
