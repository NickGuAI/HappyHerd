#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATOR="$ROOT/scripts/validate-pmai-discord-agent-runtime.sh"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pmai-discord-runtime-test.XXXXXX")"

cleanup() {
    rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
    printf 'pmai-discord-runtime-contract: %s\n' "$*" >&2
    exit 1
}

"$VALIDATOR" "$ROOT/deploy/pmai-discord-agent.env.example" template >/dev/null

cp "$ROOT/deploy/pmai-discord-agent.env.example" "$TMP_ROOT/bad-personal.env"
sed -i 's#PMAI_AGENT_WORKSPACE=/var/lib/pmai-happyherd-agent/workspace#PMAI_AGENT_WORKSPACE=/home/ec2-user/App#' "$TMP_ROOT/bad-personal.env"
if "$VALIDATOR" "$TMP_ROOT/bad-personal.env" template >/dev/null 2>&1; then
    fail 'validator accepted Nick personal workspace'
fi

cp "$ROOT/deploy/pmai-discord-agent.env.example" "$TMP_ROOT/bad-secret.env"
printf 'DISCORD_TOKEN=plaintext-is-forbidden\n' >> "$TMP_ROOT/bad-secret.env"
if "$VALIDATOR" "$TMP_ROOT/bad-secret.env" template >/dev/null 2>&1; then
    fail 'validator accepted an inline token'
fi

grep -Fq 'User=pmai-discord-bridge' "$ROOT/deploy/pmai-discord-agent.service" || fail 'bridge unit lacks its dedicated user'
grep -Fq 'pmai-happyherd-agent' "$ROOT/deploy/pmai-happyherd-daemon.cron" || fail 'daemon boot entry lacks its dedicated user'
grep -Fq 'PMAI_CODEX_PERMISSION_MODE=read-only' "$ROOT/deploy/pmai-discord-agent.env.example" || fail 'bridge does not lock Codex read-only'
grep -Fq 'PMAI_DISCORD_TOKEN_ROTATION_RECEIPT_FILE=' "$ROOT/deploy/pmai-discord-agent.env.example" || fail 'token rotation receipt is not required'
grep -Fq 'PMAI_BROKER_URL=http://pmai-broker.localhost:3210/mcp' "$ROOT/deploy/pmai-discord-agent.env.example" || fail 'bridge does not use the sandbox broker alias'
grep -Fq 'release-bundled ripgrep is missing' "$ROOT/scripts/prepare-pmai-discord-agent-runtime.sh" || fail 'runtime preparation does not require bundled ripgrep'
grep -Fq 'release-bundled ripgrep is unusable' "$ROOT/scripts/validate-pmai-discord-agent-runtime.sh" || fail 'runtime validator does not execute bundled ripgrep as the agent user'
grep -Fq 'command -v rg' "$ROOT/scripts/test-pmai-discord-agent-sandbox.sh" || fail 'sandbox canary does not preflight ripgrep'
grep -Fq 'provision-pmai-happy-account.sh' "$ROOT/docs/runtime-isolation.md" || fail 'dedicated HappyHerd account provisioning is undocumented'
[[ -x "$ROOT/scripts/provision-pmai-happy-account.sh" ]] || fail 'dedicated HappyHerd account provisioner is missing'

node - "$ROOT/deploy/pmai-discord-agent-runtime/settings.template.json" <<'NODE'
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
  || settings.sandboxConfig.workspaceRoot !== '/var/lib/pmai-happyherd-agent/workspace'
  || settings.sandboxConfig.allowLocalBinding !== false
  || !sameStrings(settings.sandboxConfig.customWritePaths, [])
  || !sameStrings(settings.sandboxConfig.extraWritePaths, [])
  || !sameStrings(settings.sandboxConfig.denyReadPaths, [
    '/home/ec2-user',
    '/root',
    '/etc/pmai-discord-agent',
    '/var/lib/pmai-discord-bridge',
    '/var/lib/pmai-happyherd-agent/happy-home',
  ])
  || !sameStrings(settings.sandboxConfig.allowedDomains, [
    '*.openai.com',
    'chatgpt.com',
    '*.chatgpt.com',
    'pmai-broker.localhost',
  ])
  || !sameStrings(settings.sandboxConfig.deniedDomains, [])
) process.exit(1);
NODE

printf 'PMAI Discord runtime contract tests passed.\n'
