#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-/etc/happyherd/daemon.env}"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ -r "$ENV_FILE" ]] || die "host daemon environment is not readable: $ENV_FILE"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DAEMON_CLI="${HAPPYHERD_DAEMON_CLI:-}"
if [[ -z "$DAEMON_CLI" ]]; then
    DAEMON_CLI="$(command -v happyherd || true)"
fi
[[ -n "$DAEMON_CLI" && -x "$DAEMON_CLI" ]] || \
    die 'HappyHerd CLI is not installed; set HAPPYHERD_DAEMON_CLI or install happyherd on PATH'

# A fresh host uses the same local-first setting as the user installer. Existing
# settings and explicit environment overrides remain authoritative.
if [[ -z "${HAPPY_SERVER_URL:-}" ]]; then
    HAPPY_HOME="${HAPPY_HOME_DIR:-$HOME/.happyherd}"
    HAPPY_HOME="${HAPPY_HOME/#\~/$HOME}"
    NODE_BIN="$(command -v node || true)"
    [[ -n "$NODE_BIN" ]] || die 'node is required to initialize normal Happy settings'
    "$NODE_BIN" - "$HAPPY_HOME/settings.json" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const settingsPath = process.argv[2];
let settings = {};
if (fs.existsSync(settingsPath)) settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
if (typeof settings.serverUrl !== 'string' || settings.serverUrl.length === 0) {
  settings.serverUrl = 'http://127.0.0.1:3005';
  settings.webappUrl = 'http://127.0.0.1:3005';
} else if (typeof settings.webappUrl !== 'string' || settings.webappUrl.length === 0) {
  settings.webappUrl = settings.serverUrl;
} else {
  process.exit(0);
}
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
const temporary = `${settingsPath}.tmp-${process.pid}`;
fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, settingsPath);
NODE
fi

# This is intentionally the upstream detached lifecycle. The bootstrap exits
# after readiness is confirmed, leaving the daemon and provider sessions out of
# a HappyHerd-owned service cgroup.
"$DAEMON_CLI" daemon start
