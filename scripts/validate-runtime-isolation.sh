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

paths_overlap() {
    local left="$1"
    local right="$2"
    [[ "$left" == "$right" || "$left" == "$right/"* || "$right" == "$left/"* ]]
}

happyherd_load_runtime_config "$ENV_FILE"

[[ "$HAPPYHERD_DOMAIN" == "happyherd.gehirn.ai" ]] || die "unexpected domain: $HAPPYHERD_DOMAIN"
[[ "$HAPPYHERD_PUBLIC_URL" == "https://happyherd.gehirn.ai" ]] || die "unexpected public URL: $HAPPYHERD_PUBLIC_URL"
[[ "$HAPPYHERD_PORT" == "20015" ]] || die "HappyHerd must use reserved port 20015"
[[ "$HAPPYHERD_CONTAINER_NAME" == "happyherd" ]] || die "unexpected container name"

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

for name in "${!paths[@]}"; do
    [[ "${paths[$name]}" == /* ]] || die "$name path must be absolute"
    [[ "${paths[$name]}" != *qmherd* ]] || die "$name path references retired qmherd state"
done

forbidden_roots=(
    "$HOME/.herd"
    "$HOME/.happy"
    "$HOME/.happy-server-data"
    "$HOME/.qmherd"
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
done

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
fi

printf 'HappyHerd runtime isolation verified: %s:%s\n' "$HAPPYHERD_DOMAIN" "$HAPPYHERD_PORT"
