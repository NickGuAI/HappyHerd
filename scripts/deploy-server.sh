#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/runtime-config.sh
source "$ROOT/scripts/lib/runtime-config.sh"

IMAGE="${1:-}"
ENV_FILE="${2:-/etc/happyherd/runtime.env}"
SERVICE="happyherd.service"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ "$(id -u)" -eq 0 ]] || die 'deploy-server.sh must run as root'
[[ -n "$IMAGE" ]] || die 'usage: deploy-server.sh REPOSITORY:TAG [RUNTIME_ENV]'
[[ "$IMAGE" =~ ^[a-z0-9.-]+(/[a-z0-9._-]+)+:[A-Za-z0-9._-]+$ ]] || \
    die 'server image must be a normal repository:tag reference'
[[ -r "$ENV_FILE" ]] || die "runtime environment is not readable: $ENV_FILE"
command -v docker >/dev/null 2>&1 || die 'docker is required'
command -v systemctl >/dev/null 2>&1 || die 'systemd is required for the central server'

# Pull exactly the operator-selected tag. This command never builds
# daemon, mobile, or agent components and never chooses a rollback target.
docker pull "$IMAGE"

runtime_temp="$(mktemp "$(dirname "$ENV_FILE")/.runtime.env.XXXXXX")"
cleanup() {
    rm -f "$runtime_temp"
}
trap cleanup EXIT

awk -v image="$IMAGE" '
    BEGIN { replaced = 0 }
    /^HAPPYHERD_IMAGE=/ { print "HAPPYHERD_IMAGE=" image; replaced += 1; next }
    { print }
    END { if (replaced != 1) exit 42 }
' "$ENV_FILE" > "$runtime_temp" || die 'runtime environment must contain exactly one HAPPYHERD_IMAGE assignment'
chmod --reference="$ENV_FILE" "$runtime_temp"
chown --reference="$ENV_FILE" "$runtime_temp"
mv -f "$runtime_temp" "$ENV_FILE"
trap - EXIT

happyherd_load_runtime_config "$ENV_FILE"
systemctl restart "$SERVICE"

health_url="http://127.0.0.1:${HAPPYHERD_PORT}/health"
ready=false
for _ in {1..60}; do
    if curl --fail --silent --show-error --max-time 3 "$health_url" >/dev/null 2>&1; then
        ready=true
        break
    fi
    sleep 1
done
[[ "$ready" == true ]] || die "server did not become ready at $health_url"

curl --fail --silent --show-error --max-time 10 "${HAPPYHERD_PUBLIC_URL}/health" >/dev/null || \
    die "public health check failed: ${HAPPYHERD_PUBLIC_URL}/health"

# The image label scopes cleanup to HappyHerd. Docker retains every image still
# referenced by a running or stopped container.
docker image prune --all --force --filter 'label=org.opencontainers.image.title=HappyHerd'

printf 'HappyHerd server deployed: %s\n' "$IMAGE"
printf 'Local health: %s\n' "$health_url"
printf 'Public health: %s/health\n' "$HAPPYHERD_PUBLIC_URL"
printf 'Manual rollback: rerun this command with a previously published tag.\n'
