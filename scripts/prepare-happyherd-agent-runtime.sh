#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_ROOT="${HAPPYHERD_CLI_ROOT:-/usr/local/lib/happyherd-cli}"
BRIDGE_USER=happyherd-agent-bridge
AGENT_USER=happyherd-agent-runtime
CONFIG_ROOT=/etc/happyherd-agent
BRIDGE_ROOT=/var/lib/happyherd-agent-bridge
AGENT_ROOT=/var/lib/happyherd-agent-runtime

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ "$(id -u)" -eq 0 ]] || die 'runtime preparation must run as root'

missing_sandbox_dependencies=()
for command_name in bwrap socat; do
    command -v "$command_name" >/dev/null 2>&1 || missing_sandbox_dependencies+=("$command_name")
done
if [[ "${#missing_sandbox_dependencies[@]}" -gt 0 ]]; then
    command -v dnf >/dev/null 2>&1 || \
        die "missing HappyHerd sandbox dependencies: ${missing_sandbox_dependencies[*]}"
    dnf install -y bubblewrap socat
fi
command -v bwrap >/dev/null 2>&1 || die 'bubblewrap installation did not provide bwrap'
command -v socat >/dev/null 2>&1 || die 'socat installation did not complete'
[[ -x "$DAEMON_ROOT/tools/unpacked/rg" ]] || die 'Happy CLI bundled ripgrep is missing or not executable'

ensure_system_user() {
    local user_name="$1"
    local user_home="$2"
    if id "$user_name" >/dev/null 2>&1; then
        [[ "$(getent passwd "$user_name" | cut -d: -f6)" == "$user_home" ]] || \
            die "$user_name has an unexpected home directory"
        return
    fi
    useradd --system --user-group --home-dir "$user_home" --create-home --shell /usr/sbin/nologin "$user_name"
}

ensure_system_user "$BRIDGE_USER" "$BRIDGE_ROOT"
ensure_system_user "$AGENT_USER" "$AGENT_ROOT"
[[ "$(id -u "$BRIDGE_USER")" != "$(id -u "$AGENT_USER")" ]] || die 'bridge and agent users must be distinct'

install -d -o root -g root -m 0751 "$CONFIG_ROOT"
install -d -o "$BRIDGE_USER" -g "$BRIDGE_USER" -m 0700 \
    "$CONFIG_ROOT/secrets" \
    "$BRIDGE_ROOT" \
    "$BRIDGE_ROOT/happy-agent" \
    "$BRIDGE_ROOT/state"
install -d -o "$AGENT_USER" -g "$AGENT_USER" -m 0700 \
    "$AGENT_ROOT" \
    "$AGENT_ROOT/.local" \
    "$AGENT_ROOT/.local/bin" \
    "$AGENT_ROOT/codex-home" \
    "$AGENT_ROOT/happy-home" \
    "$AGENT_ROOT/happy-home/agentcontext" \
    "$AGENT_ROOT/happy-home/agentcontext/rules" \
    "$AGENT_ROOT/happy-home/agentcontext/rules/learnings" \
    "$AGENT_ROOT/happy-home/commanders" \
    "$AGENT_ROOT/happy-home/commanders/team-agent" \
    "$AGENT_ROOT/workspace"

install -o "$AGENT_USER" -g "$AGENT_USER" -m 0600 \
    "$ROOT/deploy/happyherd-agent-runtime/happy-home/AGENTS.md" \
    "$AGENT_ROOT/happy-home/AGENTS.md"
install -o "$AGENT_USER" -g "$AGENT_USER" -m 0600 \
    "$ROOT/deploy/happyherd-agent-runtime/happy-home/agentcontext/USER.md" \
    "$AGENT_ROOT/happy-home/agentcontext/USER.md"
install -o "$AGENT_USER" -g "$AGENT_USER" -m 0600 \
    "$ROOT/deploy/happyherd-agent-runtime/happy-home/agentcontext/rules/learnings/CHAT_FILE_SURFACE.md" \
    "$AGENT_ROOT/happy-home/agentcontext/rules/learnings/CHAT_FILE_SURFACE.md"
install -o "$AGENT_USER" -g "$AGENT_USER" -m 0600 \
    "$ROOT/deploy/happyherd-agent-runtime/happy-home/commanders/team-agent/COMMANDER.md" \
    "$AGENT_ROOT/happy-home/commanders/team-agent/COMMANDER.md"
install -o "$AGENT_USER" -g "$AGENT_USER" -m 0600 \
    "$ROOT/deploy/happyherd-agent-runtime/workspace/AGENTS.md" \
    "$AGENT_ROOT/workspace/AGENTS.md"

if [[ ! -e "$AGENT_ROOT/happy-home/CLAUDE.md" ]]; then
    ln -s AGENTS.md "$AGENT_ROOT/happy-home/CLAUDE.md"
    chown -h "$AGENT_USER:$AGENT_USER" "$AGENT_ROOT/happy-home/CLAUDE.md"
fi
[[ -L "$AGENT_ROOT/happy-home/CLAUDE.md" && "$(readlink "$AGENT_ROOT/happy-home/CLAUDE.md")" == AGENTS.md ]] || \
    die 'HappyHerd CLAUDE.md must be the canonical AGENTS.md mirror'

if [[ ! -e "$AGENT_ROOT/happy-home/settings.json" ]]; then
    install -o "$AGENT_USER" -g "$AGENT_USER" -m 0600 \
        "$ROOT/deploy/happyherd-agent-runtime/settings.template.json" \
        "$AGENT_ROOT/happy-home/settings.json"
fi

if [[ ! -e "$CONFIG_ROOT/bridge.env" ]]; then
    install -o root -g "$BRIDGE_USER" -m 0640 \
        "$ROOT/deploy/happyherd-agent.env.example" \
        "$CONFIG_ROOT/bridge.env"
fi
if [[ ! -e "$CONFIG_ROOT/daemon.env" ]]; then
    install -o root -g "$AGENT_USER" -m 0640 \
        "$ROOT/deploy/happyherd-agent-daemon.env.example" \
        "$CONFIG_ROOT/daemon.env"
fi
if [[ ! -e "$CONFIG_ROOT/agent-manifest.json" ]]; then
    install -o root -g "$BRIDGE_USER" -m 0640 \
        "$ROOT/deploy/happyherd-agent-runtime/agent-manifest.example.json" \
        "$CONFIG_ROOT/agent-manifest.json"
fi

install -o root -g root -m 0644 \
    "$ROOT/deploy/happyherd-agent-daemon.cron" \
    /etc/cron.d/happyherd-agent-daemon
install -o root -g root -m 0644 \
    "$ROOT/deploy/happyherd-agent.service" \
    /etc/systemd/system/happyherd-agent.service
systemctl daemon-reload

printf 'HappyHerd Agent runtime prepared. Install fresh credentials and replace all bridge.env placeholders before enablement.\n'
