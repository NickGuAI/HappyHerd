#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-/etc/happyherd/daemon.env}"
INSTALL_ROOT="/usr/local/lib/happyherd"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ "$(id -u)" -eq 0 ]] || die 'install-linux-daemon-bootstrap.sh must run as root'
[[ -r "$ENV_FILE" ]] || die "daemon environment is not readable: $ENV_FILE"

install -d -o root -g root -m 0755 "$INSTALL_ROOT"
install -o root -g root -m 0755 \
    "$ROOT/scripts/start-host-daemon.sh" \
    "$INSTALL_ROOT/start-host-daemon.sh"
install -o root -g root -m 0644 \
    "$ROOT/deploy/happyherd-daemon.cron" \
    /etc/cron.d/happyherd-daemon

printf 'HappyHerd Linux daemon bootstrap installed. The Happy CLI remains independently installed and upgraded.\n'
