#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/runtime-config.sh
source "$SCRIPT_DIR/lib/runtime-config.sh"

ENV_FILE="${1:-/etc/happyherd/runtime.env}"
happyherd_load_runtime_config "$ENV_FILE"

master_secret="$(tr -d '\r\n' < "$HAPPYHERD_MASTER_SECRET_FILE")"
[[ -n "$master_secret" ]] || {
    printf 'error: master secret file is empty\n' >&2
    exit 1
}

docker rm -f "$HAPPYHERD_CONTAINER_NAME" >/dev/null 2>&1 || true

docker_args=(
    run --rm
    --name "$HAPPYHERD_CONTAINER_NAME"
    --publish "0.0.0.0:${HAPPYHERD_PORT}:3005"
    --volume "$HAPPYHERD_DATA_DIR:/data"
    --volume "$HAPPYHERD_CLI_HOME:/happyherd-cli"
    --env HOST=0.0.0.0
    --env PORT=3005
    --env DATA_DIR=/data
    --env PGLITE_DIR=/data/pglite
    --env PUBLIC_URL="$HAPPYHERD_PUBLIC_URL"
    --env HANDY_MASTER_SECRET="$master_secret"
    --env HAPPY_HOME_DIR=/happyherd-cli
    --env "HAPPY_INJECT_HTML_CONFIG={\"serverUrl\":\"$HAPPYHERD_PUBLIC_URL\",\"disableAnalytics\":true}"
)

if [[ -n "${HAPPYHERD_OPENAI_API_KEY_FILE:-}" ]]; then
    docker_args+=(
        --volume "$HAPPYHERD_OPENAI_API_KEY_FILE:/run/secrets/openai-api-key:ro"
        --env OPENAI_API_KEY_FILE=/run/secrets/openai-api-key
    )
fi

exec docker "${docker_args[@]}" "$HAPPYHERD_IMAGE"
