#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-/etc/happyherd/runtime.env}"
INSTALL_ROOT="/usr/local/lib/happyherd"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ "$(id -u)" -eq 0 ]] || die 'install-server-service.sh must run as root'
[[ -r "$ENV_FILE" ]] || die "runtime environment is not readable: $ENV_FILE"

install -d -o root -g root -m 0755 "$INSTALL_ROOT/lib"
install -o root -g root -m 0755 \
    "$ROOT/scripts/run-container.sh" \
    "$ROOT/scripts/stop-container.sh" \
    "$ROOT/scripts/prepare-runtime.sh" \
    "$INSTALL_ROOT/"
install -o root -g root -m 0644 \
    "$ROOT/scripts/lib/runtime-config.sh" \
    "$INSTALL_ROOT/lib/runtime-config.sh"
install -o root -g root -m 0644 \
    "$ROOT/deploy/happyherd.service" \
    /etc/systemd/system/happyherd.service

"$INSTALL_ROOT/prepare-runtime.sh" "$ENV_FILE"
systemctl daemon-reload
systemctl enable happyherd.service >/dev/null

printf 'HappyHerd server service installed at %s. Deploy an image with scripts/deploy-server.sh.\n' "$INSTALL_ROOT"
