#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_TARGET="${HAPPYHERD_AGENT_ROOT:-/usr/local/lib/happyherd-agent}"
SUPPORT_TARGET="${HAPPYHERD_AGENT_SUPPORT_ROOT:-/usr/local/lib/happyherd-agent-support}"
CLI_TARGET="${HAPPYHERD_CLI_ROOT:-/usr/local/lib/happyherd-cli}"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ "$(id -u)" -eq 0 ]] || die 'install-agent-runtime.sh must run as root'
[[ -x "$CLI_TARGET/bin/happy.mjs" ]] || \
    die 'install the Happy CLI independently before installing the governed agent'

if command -v pnpm >/dev/null 2>&1; then
    PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
    PNPM=(corepack pnpm)
else
    die 'pnpm or corepack is required'
fi

SOURCE_OWNER="$(stat -c '%U' "$ROOT")"
BUILD_USER="${SUDO_USER:-$SOURCE_OWNER}"
id "$BUILD_USER" >/dev/null 2>&1 || die "source owner is not a local user: $BUILD_USER"
[[ "$BUILD_USER" == root ]] || command -v runuser >/dev/null 2>&1 || \
    die 'runuser is required when installing from a non-root-owned checkout'
BUILD_GROUP="$(id -gn "$BUILD_USER")"
BUILD_HOME="$(getent passwd "$BUILD_USER" | cut -d: -f6)"
[[ -n "$BUILD_HOME" ]] || die "cannot determine home directory for build user: $BUILD_USER"

run_build() {
    if [[ "$BUILD_USER" == root ]]; then
        "$@"
    else
        runuser -u "$BUILD_USER" -- env HOME="$BUILD_HOME" PATH="$PATH" "$@"
    fi
}

# Build only the governed-agent component and its own package dependency. A
# root installation delegates source-tree builds to the checkout owner.
(cd "$ROOT/server" && run_build "${PNPM[@]}" --filter happy-agent --fail-if-no-match build)
(cd "$ROOT/server" && run_build "${PNPM[@]}" --filter @happyherd/happyherd-agent --fail-if-no-match build)
stage="$(mktemp -d /tmp/happyherd-agent.stage.XXXXXX)"
chown "$BUILD_USER:$BUILD_GROUP" "$stage"
cleanup() {
    rm -rf "$stage"
}
trap cleanup EXIT
(cd "$ROOT/server" && run_build "${PNPM[@]}" --ignore-scripts --filter @happyherd/happyherd-agent --fail-if-no-match \
    deploy --legacy --prod "$stage")
rm -rf "$AGENT_TARGET"
mv "$stage" "$AGENT_TARGET"
trap - EXIT

install -d -o root -g root -m 0755 \
    "$SUPPORT_TARGET/scripts" \
    "$SUPPORT_TARGET/deploy/happyherd-agent-runtime/happy-home/agentcontext" \
    "$SUPPORT_TARGET/deploy/happyherd-agent-runtime/happy-home/commanders/team-agent" \
    "$SUPPORT_TARGET/deploy/happyherd-agent-runtime/workspace"
install -o root -g root -m 0755 \
    "$ROOT/scripts/health-happyherd-agent.sh" \
    "$ROOT/scripts/prepare-happyherd-agent-runtime.sh" \
    "$ROOT/scripts/provision-happyherd-agent-account.sh" \
    "$ROOT/scripts/test-happyherd-agent-sandbox.sh" \
    "$ROOT/scripts/validate-happyherd-agent-runtime.sh" \
    "$ROOT/scripts/write-discord-token-rotation-receipt.sh" \
    "$SUPPORT_TARGET/scripts/"
install -o root -g root -m 0644 \
    "$ROOT/deploy/happyherd-agent.env.example" \
    "$ROOT/deploy/happyherd-agent-daemon.env.example" \
    "$ROOT/deploy/happyherd-agent-daemon.cron" \
    "$ROOT/deploy/happyherd-agent.service" \
    "$SUPPORT_TARGET/deploy/"
install -o root -g root -m 0644 \
    "$ROOT/deploy/happyherd-agent-runtime/agent-manifest.example.json" \
    "$ROOT/deploy/happyherd-agent-runtime/settings.template.json" \
    "$SUPPORT_TARGET/deploy/happyherd-agent-runtime/"
install -o root -g root -m 0644 \
    "$ROOT/deploy/happyherd-agent-runtime/happy-home/AGENTS.md" \
    "$SUPPORT_TARGET/deploy/happyherd-agent-runtime/happy-home/AGENTS.md"
install -o root -g root -m 0644 \
    "$ROOT/deploy/happyherd-agent-runtime/happy-home/agentcontext/USER.md" \
    "$SUPPORT_TARGET/deploy/happyherd-agent-runtime/happy-home/agentcontext/USER.md"
install -o root -g root -m 0644 \
    "$ROOT/deploy/happyherd-agent-runtime/happy-home/commanders/team-agent/COMMANDER.md" \
    "$SUPPORT_TARGET/deploy/happyherd-agent-runtime/happy-home/commanders/team-agent/COMMANDER.md"
install -o root -g root -m 0644 \
    "$ROOT/deploy/happyherd-agent-runtime/workspace/AGENTS.md" \
    "$SUPPORT_TARGET/deploy/happyherd-agent-runtime/workspace/AGENTS.md"

install -o root -g root -m 0644 \
    "$ROOT/deploy/happyherd-agent.service" \
    /etc/systemd/system/happyherd-agent.service
systemctl daemon-reload

printf 'HappyHerd governed agent installed independently at %s\n' "$AGENT_TARGET"
