#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/runtime-config.sh
source "$SCRIPT_DIR/lib/runtime-config.sh"

ENV_FILE="${1:-/etc/happyherd/runtime.env}"
happyherd_load_runtime_config "$ENV_FILE"

docker stop --time 30 "$HAPPYHERD_CONTAINER_NAME" >/dev/null 2>&1 || true
