#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-isolation.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

write_config() {
    local target="$1"
    local data_dir="$2"
    local log_dir="$3"
    local cli_home="$4"
    local secret_file="$5"
    local image_digest
    image_digest="$(printf 'a%.0s' {1..64})"

    printf '%s\n' \
        'HAPPYHERD_DOMAIN=happyherd.gehirn.ai' \
        'HAPPYHERD_PUBLIC_URL=https://happyherd.gehirn.ai' \
        'HAPPYHERD_PORT=20015' \
        "HAPPYHERD_DATA_DIR=$data_dir" \
        "HAPPYHERD_LOG_DIR=$log_dir" \
        "HAPPYHERD_CLI_HOME=$cli_home" \
        "HAPPYHERD_MASTER_SECRET_FILE=$secret_file" \
        'HAPPYHERD_CONTAINER_NAME=happyherd' \
        "HAPPYHERD_IMAGE=ghcr.io/nickguai/happyherd@sha256:$image_digest" \
        > "$target"
}

expect_rejected() {
    local env_file="$1"
    if "$ROOT/scripts/validate-runtime-isolation.sh" "$env_file" template >/dev/null 2>&1; then
        printf 'error: unsafe config was accepted: %s\n' "$env_file" >&2
        exit 1
    fi
}

write_config \
    "$TMP_ROOT/safe.env" \
    "$TMP_ROOT/data" \
    "$TMP_ROOT/logs" \
    "$TMP_ROOT/cli" \
    "$TMP_ROOT/secret"
"$ROOT/scripts/validate-runtime-isolation.sh" "$TMP_ROOT/safe.env" template >/dev/null
mkdir -p "$TMP_ROOT/data" "$TMP_ROOT/logs" "$TMP_ROOT/cli"
printf 'test-only-secret-material-0123456789\n' > "$TMP_ROOT/secret"
chmod 0600 "$TMP_ROOT/secret"
"$ROOT/scripts/validate-runtime-isolation.sh" "$TMP_ROOT/safe.env" runtime >/dev/null

write_config "$TMP_ROOT/herd.env" "$HOME/.herd/happyherd" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/herd.env"

write_config "$TMP_ROOT/happy.env" "$TMP_ROOT/data" "$TMP_ROOT/logs" "$HOME/.happy" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/happy.env"

write_config "$TMP_ROOT/qmherd.env" "$TMP_ROOT/qmherd-data" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/qmherd.env"

write_config "$TMP_ROOT/overlap.env" "$TMP_ROOT/state" "$TMP_ROOT/state/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/overlap.env"

printf 'Runtime isolation contract tests passed.\n'
