#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-/etc/pmai-discord-agent/bridge.env}"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ -r "$ENV_FILE" ]] || die "bridge environment is not readable: $ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
[[ "${PMAI_BRIDGE_HOST:-}" == 127.0.0.1 ]] || die 'health probe requires the loopback bridge profile'
[[ "${PMAI_BRIDGE_PORT:-}" =~ ^[0-9]+$ ]] || die 'bridge port is invalid'

payload="$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$PMAI_BRIDGE_PORT/healthz")"
PMAI_HEALTH_PAYLOAD="$payload" node <<'NODE'
const health = JSON.parse(process.env.PMAI_HEALTH_PAYLOAD);
if (health.ready !== true || !health.checks || Object.values(health.checks).some((value) => value !== true)) {
  process.exit(1);
}
NODE
printf 'PMAI Discord Agent is ready.\n'
