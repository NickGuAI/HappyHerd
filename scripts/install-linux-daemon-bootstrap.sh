#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-/etc/happyherd/daemon.env}"
RUN_USER="${2:-${SUDO_USER:-}}"
INSTALL_ROOT="/usr/local/lib/happyherd"
CRON_FILE="/etc/cron.d/happyherd-daemon"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ "$(id -u)" -eq 0 ]] || die 'install-linux-daemon-bootstrap.sh must run as root'
[[ -r "$ENV_FILE" ]] || die "daemon environment is not readable: $ENV_FILE"
[[ -n "$RUN_USER" ]] || \
    die 'usage: install-linux-daemon-bootstrap.sh [ENV_FILE] RUN_USER (or invoke through sudo)'
[[ "$RUN_USER" =~ ^[a-z_][a-z0-9_-]*\$?$ ]] || die "invalid daemon run user: $RUN_USER"
id "$RUN_USER" >/dev/null 2>&1 || die "daemon run user does not exist: $RUN_USER"

rendered_cron="$(mktemp /tmp/happyherd-daemon.cron.XXXXXX)"
cleanup() {
    rm -f "$rendered_cron"
}
trap cleanup EXIT
awk -v run_user="$RUN_USER" '
    { gsub(/__HAPPYHERD_DAEMON_USER__/, run_user); print }
' "$ROOT/deploy/happyherd-daemon.cron" > "$rendered_cron"
grep -Fq '__HAPPYHERD_DAEMON_USER__' "$rendered_cron" && \
    die 'daemon cron user placeholder was not rendered'

install -d -o root -g root -m 0755 "$INSTALL_ROOT"
install -o root -g root -m 0755 \
    "$ROOT/scripts/start-host-daemon.sh" \
    "$INSTALL_ROOT/start-host-daemon.sh"
install -o root -g root -m 0644 \
    "$rendered_cron" \
    "$CRON_FILE"

printf 'HappyHerd Linux daemon bootstrap installed for %s. The Happy CLI remains independently installed and upgraded.\n' "$RUN_USER"
