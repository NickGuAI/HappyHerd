#!/usr/bin/env bash
set -euo pipefail

SOURCE_SHA="${1:-}"
RELEASE_ROOT="${2:-/opt/happyherd/releases}"
CURRENT_LINK="${3:-/opt/happyherd/current}"
BRIDGE_ENV="${4:-/etc/happyherd-agent/bridge.env}"
DAEMON_ENV="${5:-/etc/happyherd-agent/daemon.env}"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ "$(id -u)" -eq 0 ]] || die 'rollback must run as root'
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || \
    die 'usage: rollback-happyherd-agent.sh SOURCE_SHA [RELEASE_ROOT] [CURRENT_LINK] [BRIDGE_ENV] [DAEMON_ENV]'
target="$RELEASE_ROOT/$SOURCE_SHA"
[[ -d "$target" && ! -L "$target" ]] || die 'target release must be an immutable directory'
[[ -x "$target/daemon/bin/happy.mjs" ]] || die 'target daemon artifact is missing'
[[ -f "$target/happyherd-agent/dist/index.mjs" ]] || die 'target bridge artifact is missing'
[[ -x "$target/scripts/start-host-daemon.sh" ]] || die 'target daemon bootstrap is missing'
[[ -x "$target/scripts/validate-happyherd-agent-runtime.sh" ]] || die 'target runtime validator is missing'
[[ -x "$target/scripts/health-happyherd-agent.sh" ]] || die 'target health probe is missing'
node - "$target/build-manifest.json" "$SOURCE_SHA" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (manifest.source?.happyHerdSha !== process.argv[3]) process.exit(1);
NODE

# Validate the live non-secret configuration against the target's contract
# before disrupting the current bridge. Daemon identity can only be checked
# after the release symlink has switched and the detached daemon has handed off.
HAPPYHERD_AGENT_RELEASE="$target" \
    "$target/scripts/validate-happyherd-agent-runtime.sh" "$BRIDGE_ENV" template

previous="$(readlink -f "$CURRENT_LINK")"
[[ -d "$previous" ]] || die 'current release link does not resolve to a release directory'
[[ "$previous" != "$target" ]] || die 'target release is already current'
link_stage="$(dirname "$CURRENT_LINK")/.happyherd-agent-current.$SOURCE_SHA.$$"
cleanup() {
    rm -f "$link_stage"
}
trap cleanup EXIT

switch_current() {
    local release="$1"
    rm -f "$link_stage"
    ln -s "$release" "$link_stage" || return 1
    mv -Tf "$link_stage" "$CURRENT_LINK"
}

restore_previous() {
    local original_error="$1"
    local restore_failed=0

    if ! switch_current "$previous"; then
        restore_failed=1
    elif ! runuser -u happyherd-agent-runtime -- \
        "$previous/scripts/start-host-daemon.sh" "$DAEMON_ENV"; then
        restore_failed=1
    fi
    if ! systemctl start happyherd-agent.service; then
        restore_failed=1
    fi

    if [[ "$restore_failed" -eq 0 ]]; then
        die "$original_error; restored previous release"
    fi
    die "$original_error; automatic restoration also failed"
}

systemctl stop happyherd-agent.service
switch_current "$target" || restore_previous 'release symlink switch failed'

if ! runuser -u happyherd-agent-runtime -- "$CURRENT_LINK/scripts/start-host-daemon.sh" "$DAEMON_ENV"; then
    restore_previous 'daemon handoff failed'
fi
if ! HAPPYHERD_AGENT_RELEASE="$target" \
    "$CURRENT_LINK/scripts/validate-happyherd-agent-runtime.sh" "$BRIDGE_ENV" runtime; then
    restore_previous 'target runtime validation failed'
fi

systemctl start happyherd-agent.service || restore_previous 'bridge restart failed'
if ! "$CURRENT_LINK/scripts/health-happyherd-agent.sh" "$BRIDGE_ENV"; then
    restore_previous 'target health verification failed'
fi
printf 'HappyHerd Agent rolled back to %s. In-flight provider sessions were not terminated.\n' "$SOURCE_SHA"
