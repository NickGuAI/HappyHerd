#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/runtime-config.sh
source "$ROOT/scripts/lib/runtime-config.sh"

ENV_FILE="${1:-$ROOT/deploy/runtime.env.example}"
MODE="${2:-template}"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

canonical_path() {
    realpath -m -- "$1"
}

resolve_account_home() {
    local account_id="$1"
    local passwd_entry account_home

    command -v getent >/dev/null 2>&1 || die 'required command not found: getent'
    passwd_entry="$(getent passwd "$account_id")" || \
        die "could not resolve operating-system account: $account_id"
    account_home="$(cut -d: -f6 <<< "$passwd_entry")"
    [[ "$account_home" == /* ]] || \
        die "operating-system account has no absolute home: $account_id"
    canonical_path "$account_home"
}

paths_overlap() {
    local left="$1"
    local right="$2"
    [[ "$left" == "$right" || "$left" == "$right/"* || "$right" == "$left/"* ]]
}

happyherd_load_runtime_config "$ENV_FILE"
effective_account_home="$(resolve_account_home "$(id -u)")"

[[ "$HAPPYHERD_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || \
    die "invalid domain: $HAPPYHERD_DOMAIN"
[[ "$HAPPYHERD_PUBLIC_URL" == "https://${HAPPYHERD_DOMAIN}" ]] || \
    die "public URL must be https://${HAPPYHERD_DOMAIN}"
[[ "$HAPPYHERD_PORT" =~ ^[0-9]+$ ]] || die "port must be numeric"
((10#$HAPPYHERD_PORT >= 1 && 10#$HAPPYHERD_PORT <= 65535)) || die "port must be between 1 and 65535"
[[ "$HAPPYHERD_CONTAINER_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || die "invalid container name"

if [[ "$MODE" == "runtime" ]]; then
    [[ "$HAPPYHERD_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || die "runtime image must be pinned by digest"
else
    [[ "$HAPPYHERD_IMAGE" == *"@sha256:"* ]] || die "image must use a digest reference"
fi

declare -A paths=(
    [data]="$(canonical_path "$HAPPYHERD_DATA_DIR")"
    [logs]="$(canonical_path "$HAPPYHERD_LOG_DIR")"
    [cli]="$(canonical_path "$HAPPYHERD_CLI_HOME")"
    [secret]="$(canonical_path "$HAPPYHERD_MASTER_SECRET_FILE")"
)

if [[ -n "${HAPPYHERD_OPENAI_API_KEY_FILE:-}" ]]; then
    paths[openai-secret]="$(canonical_path "$HAPPYHERD_OPENAI_API_KEY_FILE")"
fi

for name in "${!paths[@]}"; do
    [[ "${paths[$name]}" == /* ]] || die "$name path must be absolute"
    [[ "${paths[$name]}" != *retired-happy* ]] || die "$name path references retired retired-happy state"
done

forbidden_roots=(
    "$effective_account_home/.herd"
    "$effective_account_home/.happy"
    "$effective_account_home/.happy-server-data"
    "$effective_account_home/.retired-happy"
    "/home/.herd"
    "/home/.happy"
    "/home/.happy-server-data"
    "/home/.retired-happy"
    "/data/.herd"
)

for name in "${!paths[@]}"; do
    for forbidden in "${forbidden_roots[@]}"; do
        forbidden="$(canonical_path "$forbidden")"
        paths_overlap "${paths[$name]}" "$forbidden" && \
            die "$name path overlaps forbidden state root: $forbidden"
    done
done

runtime_names=(data logs cli)
for ((i = 0; i < ${#runtime_names[@]}; i++)); do
    for ((j = i + 1; j < ${#runtime_names[@]}; j++)); do
        left="${runtime_names[$i]}"
        right="${runtime_names[$j]}"
        paths_overlap "${paths[$left]}" "${paths[$right]}" && \
            die "$left and $right paths overlap"
    done
done

for runtime_name in "${runtime_names[@]}"; do
    paths_overlap "${paths[secret]}" "${paths[$runtime_name]}" && \
        die "master secret overlaps $runtime_name state"
    if [[ -n "${paths[openai-secret]:-}" ]]; then
        paths_overlap "${paths[openai-secret]}" "${paths[$runtime_name]}" && \
            die "OpenAI API key overlaps $runtime_name state"
    fi
done

if [[ -n "${paths[openai-secret]:-}" ]]; then
    paths_overlap "${paths[secret]}" "${paths[openai-secret]}" && \
        die "master secret and OpenAI API key paths overlap"
fi

if [[ "$MODE" == "runtime" ]]; then
    for directory in "$HAPPYHERD_DATA_DIR" "$HAPPYHERD_LOG_DIR" "$HAPPYHERD_CLI_HOME"; do
        [[ -d "$directory" ]] || die "runtime directory missing: $directory"
    done
    [[ -f "$HAPPYHERD_MASTER_SECRET_FILE" ]] || die "master secret file missing"
    permissions="$(stat -c '%a' "$HAPPYHERD_MASTER_SECRET_FILE")"
    [[ "$permissions" == "600" || "$permissions" == "400" ]] || \
        die "master secret permissions must be 600 or 400"
    [[ "$(wc -c < "$HAPPYHERD_MASTER_SECRET_FILE")" -ge 32 ]] || \
        die "master secret is too short"
    if [[ -n "${HAPPYHERD_OPENAI_API_KEY_FILE:-}" ]]; then
        [[ -f "$HAPPYHERD_OPENAI_API_KEY_FILE" ]] || die "OpenAI API key file missing"
        provider_permissions="$(stat -c '%a' "$HAPPYHERD_OPENAI_API_KEY_FILE")"
        [[ "$provider_permissions" == "600" || "$provider_permissions" == "400" ]] || \
            die "OpenAI API key permissions must be 600 or 400"
        [[ "$(wc -c < "$HAPPYHERD_OPENAI_API_KEY_FILE")" -ge 20 ]] || \
            die "OpenAI API key file is too short"
    fi
fi

printf 'HappyHerd runtime isolation verified: %s:%s\n' "$HAPPYHERD_DOMAIN" "$HAPPYHERD_PORT"
