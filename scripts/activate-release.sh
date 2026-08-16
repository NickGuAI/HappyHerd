#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/runtime-config.sh
source "$ROOT/scripts/lib/runtime-config.sh"

MANIFEST_PATH="${1:-}"
ENV_FILE="${2:-/etc/happyherd/runtime.env}"
SLOT="${3:-current}"
ATTEMPTS="${HAPPYHERD_ACTIVATION_ATTEMPTS:-30}"
DELAY_SECONDS="${HAPPYHERD_ACTIVATION_DELAY_SECONDS:-2}"
SERVICE_NAME="happyherd.service"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ -n "$MANIFEST_PATH" ]] || die 'usage: activate-release.sh MANIFEST [RUNTIME_ENV] [current|previous]'
[[ "$SLOT" == current || "$SLOT" == previous ]] || die 'release slot must be current or previous'
[[ "$ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || die 'HAPPYHERD_ACTIVATION_ATTEMPTS must be a positive integer'
[[ "$DELAY_SECONDS" =~ ^[0-9]+$ ]] || die 'HAPPYHERD_ACTIVATION_DELAY_SECONDS must be a non-negative integer'

for command_name in awk chmod chown curl dirname docker mktemp mv node realpath rm sleep stat systemctl; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command not found: $command_name"
done

MANIFEST_PATH="$(realpath "$MANIFEST_PATH")"
ENV_FILE="$(realpath "$ENV_FILE")"
target_image="$(node "$ROOT/scripts/verify-release-manifest.mjs" "$MANIFEST_PATH" --select "$SLOT")"

happyherd_load_runtime_config "$ENV_FILE"
"$ROOT/scripts/validate-runtime-isolation.sh" "$ENV_FILE" runtime >/dev/null
old_image="$HAPPYHERD_IMAGE"
runtime_port="$HAPPYHERD_PORT"

replace_image() {
    local image="$1"
    local env_dir tmp_file
    env_dir="$(dirname "$ENV_FILE")"
    tmp_file="$(mktemp "$env_dir/.happyherd-runtime.XXXXXX")"
    if ! awk -v image="$image" '
        BEGIN { replaced = 0 }
        /^HAPPYHERD_IMAGE=/ { print "HAPPYHERD_IMAGE=" image; replaced = 1; next }
        { print }
        END { if (replaced != 1) exit 42 }
    ' "$ENV_FILE" > "$tmp_file"; then
        rm -f "$tmp_file"
        die 'could not replace HAPPYHERD_IMAGE in runtime config'
    fi
    chmod --reference="$ENV_FILE" "$tmp_file"
    chown --reference="$ENV_FILE" "$tmp_file"
    mv -f "$tmp_file" "$ENV_FILE"
}

health_is_ready() {
    local body
    body="$(curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:${runtime_port}/health" 2>/dev/null)" || return 1
    node -e '
        const body = JSON.parse(process.argv[1]);
        if (body.status !== "ok" || body.service !== "happy-server") process.exit(1);
    ' "$body" >/dev/null 2>&1
}

wait_for_health() {
    local remaining="$ATTEMPTS"
    while ((remaining > 0)); do
        health_is_ready && return 0
        remaining=$((remaining - 1))
        sleep "$DELAY_SECONDS"
    done
    return 1
}

docker pull "$target_image" >/dev/null
replace_image "$target_image"

activation_ok=false
if "$ROOT/scripts/validate-runtime-isolation.sh" "$ENV_FILE" runtime >/dev/null && \
    systemctl restart "$SERVICE_NAME" && wait_for_health; then
    activation_ok=true
fi

if [[ "$activation_ok" == true ]]; then
    printf 'HappyHerd release active: %s (%s)\n' "$target_image" "$SLOT"
    exit 0
fi

printf 'Activation failed; restoring prior image: %s\n' "$old_image" >&2
replace_image "$old_image"
if ! systemctl restart "$SERVICE_NAME" || ! wait_for_health; then
    die 'activation failed and the prior image did not recover'
fi
die "activation failed; prior image restored: $old_image"
