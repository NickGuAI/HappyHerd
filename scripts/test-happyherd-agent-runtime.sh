#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATOR="$ROOT/scripts/validate-happyherd-agent-runtime.sh"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-agent-runtime-test.XXXXXX")"

cleanup() {
    rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
    printf 'happyherd-agent-runtime-contract: %s\n' "$*" >&2
    exit 1
}

"$VALIDATOR" "$ROOT/deploy/happyherd-agent.env.example" template >/dev/null

cp "$ROOT/deploy/happyherd-agent.env.example" "$TMP_ROOT/bad-personal.env"
sed -i 's#HAPPYHERD_AGENT_WORKSPACE=/var/lib/happyherd-agent-runtime/workspace#HAPPYHERD_AGENT_WORKSPACE=/home/example-user/App#' "$TMP_ROOT/bad-personal.env"
if "$VALIDATOR" "$TMP_ROOT/bad-personal.env" template >/dev/null 2>&1; then
    fail 'validator accepted a personal workspace'
fi

cp "$ROOT/deploy/happyherd-agent.env.example" "$TMP_ROOT/bad-secret.env"
printf 'DISCORD_TOKEN=plaintext-is-forbidden\n' >> "$TMP_ROOT/bad-secret.env"
if "$VALIDATOR" "$TMP_ROOT/bad-secret.env" template >/dev/null 2>&1; then
    fail 'validator accepted an inline token'
fi

grep -Fq 'User=happyherd-agent-bridge' "$ROOT/deploy/happyherd-agent.service" || fail 'bridge unit lacks its dedicated user'
grep -Fq 'happyherd-agent-runtime' "$ROOT/deploy/happyherd-agent-daemon.cron" || fail 'daemon boot entry lacks its dedicated user'
grep -Fq 'HAPPYHERD_AGENT_CODEX_PERMISSION_MODE=read-only' "$ROOT/deploy/happyherd-agent.env.example" || fail 'bridge does not lock Codex read-only'
grep -Fq 'HAPPYHERD_AGENT_DISCORD_TOKEN_ROTATION_RECEIPT_FILE=' "$ROOT/deploy/happyherd-agent.env.example" || fail 'token rotation receipt is not required'
grep -Fq 'HAPPYHERD_AGENT_BROKER_URL=http://happyherd-agent-broker.localhost:3210/mcp' "$ROOT/deploy/happyherd-agent.env.example" || fail 'bridge does not use the sandbox broker alias'
grep -Fq 'Happy CLI bundled ripgrep is missing' "$ROOT/scripts/prepare-happyherd-agent-runtime.sh" || fail 'runtime preparation does not require CLI-bundled ripgrep'
grep -Fq 'Happy CLI bundled ripgrep is unusable' "$ROOT/scripts/validate-happyherd-agent-runtime.sh" || fail 'runtime validator does not execute CLI-bundled ripgrep as the agent user'
grep -Fq 'command -v rg' "$ROOT/scripts/test-happyherd-agent-sandbox.sh" || fail 'sandbox canary does not preflight ripgrep'
grep -Fq 'provision-happyherd-agent-account.sh' "$ROOT/docs/runtime-isolation.md" || fail 'dedicated HappyHerd account provisioning is undocumented'
grep -Fq 'HAPPYHERD_AGENT_TOOL_MANIFEST_FILE=' "$ROOT/deploy/happyherd-agent.env.example" || fail 'tool manifest is not configured'
[[ -f "$ROOT/deploy/happyherd-agent-runtime/agent-manifest.example.json" ]] || fail 'generic tool manifest example is missing'
[[ -x "$ROOT/scripts/provision-happyherd-agent-account.sh" ]] || fail 'dedicated HappyHerd account provisioner is missing'
[[ -f "$ROOT/deploy/happyherd-agent-runtime/happy-home/agentcontext/rules/learnings/CHAT_FILE_SURFACE.md" ]] || fail 'chat file surface SOP template is missing'
grep -Fq 'agentcontext/rules/learnings/CHAT_FILE_SURFACE.md' "$ROOT/scripts/prepare-happyherd-agent-runtime.sh" || fail 'runtime preparation does not install the chat file surface SOP'
grep -Fq 'agentcontext/rules/learnings/CHAT_FILE_SURFACE.md' "$ROOT/scripts/validate-happyherd-agent-runtime.sh" || fail 'runtime validation does not require the chat file surface SOP'

node - "$ROOT/deploy/happyherd-agent-runtime/settings.template.json" <<'NODE'
const fs = require('node:fs');
const settings = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sameStrings = (actual, expected) => (
  Array.isArray(actual)
  && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
);
if (
  !settings.sandboxConfig?.enabled
  || settings.sandboxConfig.sessionIsolation !== 'custom'
  || settings.sandboxConfig.networkMode !== 'custom'
  || settings.sandboxConfig.workspaceRoot !== '/var/lib/happyherd-agent-runtime/workspace'
  || settings.sandboxConfig.allowLocalBinding !== false
  || !sameStrings(settings.sandboxConfig.customWritePaths, [])
  || !sameStrings(settings.sandboxConfig.extraWritePaths, [])
  || !sameStrings(settings.sandboxConfig.denyReadPaths, [
    '/home',
    '/root',
    '/etc/happyherd-agent',
    '/var/lib/happyherd-agent-bridge',
    '/var/lib/happyherd-agent-runtime/happy-home',
  ])
  || !sameStrings(settings.sandboxConfig.allowedDomains, [
    '*.openai.com',
    'chatgpt.com',
    '*.chatgpt.com',
    'happyherd-agent-broker.localhost',
  ])
  || !sameStrings(settings.sandboxConfig.deniedDomains, [])
) process.exit(1);
NODE

printf 'HappyHerd Agent runtime contract tests passed.\n'
