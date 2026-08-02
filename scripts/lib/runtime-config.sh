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

happyherd_is_runtime_key() {
    local candidate="$1"
    local key
    for key in "${HAPPYHERD_RUNTIME_KEYS[@]}"; do
        [[ "$candidate" == "$key" ]] && return 0
    done
    return 1
}

happyherd_load_runtime_config() {
    local env_file="$1"
    [[ -f "$env_file" ]] || {
        printf 'error: runtime config not found: %s\n' "$env_file" >&2
        return 1
    }

    local raw key value
    while IFS= read -r raw || [[ -n "$raw" ]]; do
        raw="${raw%$'\r'}"
        [[ -z "$raw" || "$raw" =~ ^[[:space:]]*# ]] && continue
        [[ "$raw" =~ ^([A-Z0-9_]+)=([^[:space:]]+)$ ]] || {
            printf 'error: invalid runtime config line: %s\n' "$raw" >&2
            return 1
        }
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"
        happyherd_is_runtime_key "$key" || {
            printf 'error: unknown runtime config key: %s\n' "$key" >&2
            return 1
        }
        printf -v "$key" '%s' "$value"
        export "${key?}"
    done < "$env_file"

    for key in "${HAPPYHERD_RUNTIME_KEYS[@]}"; do
        [[ -n "${!key:-}" ]] || {
            printf 'error: missing runtime config key: %s\n' "$key" >&2
            return 1
        }
    done
}
