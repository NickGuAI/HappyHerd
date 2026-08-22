#!/usr/bin/env bash

HAPPYHERD_RUNTIME_KEYS=(
    HAPPYHERD_DOMAIN
    HAPPYHERD_PUBLIC_URL
    HAPPYHERD_PORT
    HAPPYHERD_DATA_DIR
    HAPPYHERD_LOG_DIR
    HAPPYHERD_CLI_HOME
    HAPPYHERD_MASTER_SECRET_FILE
    HAPPYHERD_CONTAINER_NAME
    HAPPYHERD_IMAGE
)

happyherd_load_runtime_config() {
    local env_file="$1"
    [[ -f "$env_file" ]] || {
        printf 'error: runtime config not found: %s\n' "$env_file" >&2
        return 1
    }

    local key
    for key in "${HAPPYHERD_RUNTIME_KEYS[@]}" HAPPYHERD_OPENAI_API_KEY_FILE; do
        unset "$key"
    done

    set -a
    # This is a root-owned operator configuration file, not an untrusted input.
    # shellcheck disable=SC1090
    source "$env_file"
    set +a

    for key in "${HAPPYHERD_RUNTIME_KEYS[@]}"; do
        [[ -n "${!key:-}" ]] || {
            printf 'error: missing runtime config key: %s\n' "$key" >&2
            return 1
        }
    done

}
