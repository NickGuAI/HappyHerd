#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-/etc/happyherd-agent/bridge.env}"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ -r "$ENV_FILE" ]] || die "bridge environment is not readable: $ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
[[ "${HAPPYHERD_AGENT_HOST:-}" == 127.0.0.1 ]] || die 'health probe requires the loopback bridge profile'
[[ "${HAPPYHERD_AGENT_PORT:-}" =~ ^[0-9]+$ ]] || die 'bridge port is invalid'

payload="$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$HAPPYHERD_AGENT_PORT/healthz")"
HAPPYHERD_AGENT_HEALTH_PAYLOAD="$payload" node <<'NODE'
const health = JSON.parse(process.env.HAPPYHERD_AGENT_HEALTH_PAYLOAD);
if (health.ready !== true || !health.checks || Object.values(health.checks).some((value) => value !== true)) {
  process.exit(1);
}
NODE
printf 'HappyHerd Agent is ready.\n'
