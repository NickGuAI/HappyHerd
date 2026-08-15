#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT/deploy/pmai-discord-agent.env.example}"
MODE="${2:-template}"
BRIDGE_USER=pmai-discord-bridge
AGENT_USER=pmai-happyherd-agent
BRIDGE_ROOT=/var/lib/pmai-discord-bridge
AGENT_ROOT=/var/lib/pmai-happyherd-agent
RELEASE_ROOT="${PMAI_HAPPYHERD_RELEASE:-/opt/happyherd/current}"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

require_value() {
    local name="$1"
    [[ -n "${!name:-}" ]] || die "$name is required"
}

[[ "$MODE" == template || "$MODE" == runtime ]] || die 'mode must be template or runtime'
[[ -r "$ENV_FILE" ]] || die "bridge environment is not readable: $ENV_FILE"

if grep -Eq '^[A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD|PRIVATE_KEY)=' "$ENV_FILE"; then
    die 'secret values must not appear directly in the bridge environment'
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for name in \
    NODE_ENV HAPPY_SERVER_URL HAPPY_HOME_DIR \
    PMAI_DISCORD_APPLICATION_ID PMAI_DISCORD_TOKEN_FILE \
    PMAI_DISCORD_TOKEN_ROTATION_RECEIPT_FILE PMAI_ACCESS_API_URL \
    PMAI_SERVICE_SIGNING_SECRET_FILE PMAI_BRIDGE_TRANSPORT_SECRET_FILE \
    PMAI_HAPPY_MACHINE_ID PMAI_AGENT_WORKSPACE PMAI_COMMANDER_ID \
    PMAI_CODEX_PERMISSION_MODE PMAI_BRIDGE_STATE_DIR PMAI_BRIDGE_HOST \
    PMAI_BRIDGE_PORT PMAI_BROKER_URL PMAI_ALLOWED_GUILD_IDS \
    PMAI_ALLOWED_CHANNEL_IDS; do
    require_value "$name"
done

[[ "$NODE_ENV" == production ]] || die 'NODE_ENV must be production'
[[ "$PMAI_CODEX_PERMISSION_MODE" == read-only ]] || die 'PMAI Codex must be read-only'
[[ "$PMAI_COMMANDER_ID" == pmai-team-agent ]] || die 'unexpected PMAI Commander'
[[ "$HAPPY_HOME_DIR" == "$BRIDGE_ROOT/happy-agent" ]] || die 'bridge Happy home is not isolated'
[[ "$PMAI_AGENT_WORKSPACE" == "$AGENT_ROOT/workspace" ]] || die 'agent workspace is not isolated'
[[ "$PMAI_BRIDGE_STATE_DIR" == "$BRIDGE_ROOT/state" ]] || die 'bridge state is not isolated'
[[ "$PMAI_BRIDGE_HOST" == 127.0.0.1 ]] || die 'bridge broker must bind to loopback'
[[ "$PMAI_BROKER_URL" == "http://pmai-broker.localhost:$PMAI_BRIDGE_PORT/mcp" ]] || \
    die 'broker URL must use the sandbox-proxied loopback alias'
[[ "$PMAI_ACCESS_API_URL" == https://* ]] || die 'PMAI Access API must use HTTPS'
[[ "$HAPPY_SERVER_URL" == https://happyherd.gehirn.ai ]] || die 'unexpected HappyHerd production server'
[[ "${PMAI_AUTHORIZATION_PATH:-/api/internal/discord/authorize}" == /api/internal/discord/authorize ]] || \
    die 'unexpected PMAI authorization path'

for candidate in "$HAPPY_HOME_DIR" "$PMAI_AGENT_WORKSPACE" "$PMAI_BRIDGE_STATE_DIR"; do
    case "$candidate" in
        /home/ec2-user/*|*/.happy|*/.happy/*|*/.happyherd|*/.happyherd/*|*/.herd|*/.herd/*|*/App|*/App/*)
            die "personal runtime path is forbidden: $candidate"
            ;;
    esac
done

declare -A secret_paths=()
for path in \
    "$PMAI_DISCORD_TOKEN_FILE" \
    "$PMAI_DISCORD_TOKEN_ROTATION_RECEIPT_FILE" \
    "$PMAI_SERVICE_SIGNING_SECRET_FILE" \
    "$PMAI_BRIDGE_TRANSPORT_SECRET_FILE"; do
    [[ "$path" == /etc/pmai-discord-agent/secrets/* ]] || die "secret path escapes its store: $path"
    [[ -z "${secret_paths[$path]:-}" ]] || die 'secret files must be distinct'
    secret_paths[$path]=1
done

if [[ "$MODE" == template ]]; then
    printf 'PMAI Discord runtime template verified.\n'
    exit 0
fi

[[ "$(id -u)" -eq 0 ]] || die 'runtime validation must run as root'
command -v bwrap >/dev/null 2>&1 || die 'bubblewrap is required for the PMAI Codex sandbox'
command -v socat >/dev/null 2>&1 || die 'socat is required for sandbox network mediation'
for user_name in "$BRIDGE_USER" "$AGENT_USER"; do
    id "$user_name" >/dev/null 2>&1 || die "service user is missing: $user_name"
done
[[ "$(id -u "$BRIDGE_USER")" != "$(id -u "$AGENT_USER")" ]] || die 'service users must be distinct'

for value in \
    "$PMAI_DISCORD_APPLICATION_ID" "$PMAI_HAPPY_MACHINE_ID" \
    "$PMAI_ALLOWED_GUILD_IDS" "$PMAI_ALLOWED_CHANNEL_IDS"; do
    [[ "$value" != *replace-with* ]] || die 'bridge environment still contains placeholders'
done

check_secret_file() {
    local path="$1"
    [[ -f "$path" && ! -L "$path" ]] || die "secret file is missing or not regular: $path"
    [[ "$(stat -c '%a' "$path")" == 600 ]] || die "secret file must be mode 0600: $path"
    [[ "$(stat -c '%U' "$path")" == "$BRIDGE_USER" ]] || die "secret file has the wrong owner: $path"
    [[ -s "$path" ]] || die "secret file is empty: $path"
}
for path in "${!secret_paths[@]}"; do
    check_secret_file "$path"
done

for directory in "$BRIDGE_ROOT" "$HAPPY_HOME_DIR" "$PMAI_BRIDGE_STATE_DIR"; do
    [[ -d "$directory" ]] || die "bridge directory is missing: $directory"
    [[ "$(stat -c '%U' "$directory")" == "$BRIDGE_USER" ]] || die "bridge directory has the wrong owner: $directory"
done
for directory in "$AGENT_ROOT" "$AGENT_ROOT/codex-home" "$AGENT_ROOT/happy-home" "$PMAI_AGENT_WORKSPACE"; do
    [[ -d "$directory" ]] || die "agent directory is missing: $directory"
    [[ "$(stat -c '%U' "$directory")" == "$AGENT_USER" ]] || die "agent directory has the wrong owner: $directory"
done

[[ -f "$HAPPY_HOME_DIR/agent.key" ]] || die 'bridge Happy account key is missing'
[[ "$(stat -c '%a:%U' "$HAPPY_HOME_DIR/agent.key")" == "600:$BRIDGE_USER" ]] || die 'bridge Happy account key has unsafe permissions'
[[ -f "$AGENT_ROOT/happy-home/access.key" ]] || die 'daemon Happy account key is missing'
[[ "$(stat -c '%a:%U' "$AGENT_ROOT/happy-home/access.key")" == "600:$AGENT_USER" ]] || die 'daemon Happy account key has unsafe permissions'
[[ -f "$AGENT_ROOT/codex-home/auth.json" ]] || die 'dedicated Codex authentication is missing'
[[ "$(stat -c '%a:%U' "$AGENT_ROOT/codex-home/auth.json")" == "600:$AGENT_USER" ]] || die 'Codex authentication has unsafe permissions'
if ! runuser -u "$AGENT_USER" -- env -i \
    HOME="$AGENT_ROOT" \
    CODEX_HOME="$AGENT_ROOT/codex-home" \
    PATH="$AGENT_ROOT/.local/bin:/usr/local/bin:/usr/bin:/bin" \
    SHELL=/bin/bash \
    codex --version >/dev/null 2>&1; then
    die 'dedicated Codex executable is missing or unusable'
fi

export PMAI_VALIDATION_AGENT_KEY="$HAPPY_HOME_DIR/agent.key"
export PMAI_VALIDATION_DAEMON_KEY="$AGENT_ROOT/happy-home/access.key"
export PMAI_VALIDATION_RELEASE_ROOT="$RELEASE_ROOT"
node <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const releaseRoot = process.env.PMAI_VALIDATION_RELEASE_ROOT;
const tweetnacl = require(path.join(releaseRoot, 'daemon/node_modules/tweetnacl'));

const decode32 = (value, label) => {
  if (typeof value !== 'string') throw new Error(`${label} is missing`);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32) throw new Error(`${label} is not 32 bytes`);
  return decoded;
};
const deriveContentPublicKey = (secret) => {
  const hmac = (key, data) => crypto.createHmac('sha512', key).update(data).digest();
  const root = hmac(Buffer.from('Happy EnCoder Master Seed'), secret);
  const child = hmac(root.subarray(32), Buffer.concat([Buffer.from([0]), Buffer.from('content')]));
  const seed = crypto.createHash('sha512').update(child.subarray(0, 32)).digest().subarray(0, 32);
  return Buffer.from(tweetnacl.box.keyPair.fromSecretKey(seed).publicKey);
};

const agent = JSON.parse(fs.readFileSync(process.env.PMAI_VALIDATION_AGENT_KEY, 'utf8'));
const daemon = JSON.parse(fs.readFileSync(process.env.PMAI_VALIDATION_DAEMON_KEY, 'utf8'));
if (typeof agent.token !== 'string' || !agent.token || typeof daemon.token !== 'string' || !daemon.token) {
  throw new Error('HappyHerd credentials have no bearer token');
}
if (agent.token === daemon.token) {
  throw new Error('bridge and daemon must use separately issued HappyHerd client tokens');
}
const agentPublicKey = deriveContentPublicKey(decode32(agent.secret, 'bridge account secret'));
const daemonPublicKey = daemon.secret
  ? deriveContentPublicKey(decode32(daemon.secret, 'daemon account secret'))
  : decode32(daemon.encryption?.publicKey, 'daemon account public key');
if (!crypto.timingSafeEqual(agentPublicKey, daemonPublicKey)) {
  throw new Error('bridge and daemon are not linked to the same dedicated HappyHerd account');
}
NODE
unset PMAI_VALIDATION_AGENT_KEY PMAI_VALIDATION_DAEMON_KEY PMAI_VALIDATION_RELEASE_ROOT

for path in \
    "$AGENT_ROOT/happy-home/AGENTS.md" \
    "$AGENT_ROOT/happy-home/agentcontext/USER.md" \
    "$AGENT_ROOT/happy-home/commanders/pmai-team-agent/COMMANDER.md" \
    "$PMAI_AGENT_WORKSPACE/AGENTS.md"; do
    [[ -f "$path" && "$(stat -c '%U' "$path")" == "$AGENT_USER" ]] || die "runtime context is missing or misowned: $path"
done

export PMAI_VALIDATION_TOKEN_FILE="$PMAI_DISCORD_TOKEN_FILE"
export PMAI_VALIDATION_RECEIPT_FILE="$PMAI_DISCORD_TOKEN_ROTATION_RECEIPT_FILE"
export PMAI_VALIDATION_APPLICATION_ID="$PMAI_DISCORD_APPLICATION_ID"
node <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const token = fs.readFileSync(process.env.PMAI_VALIDATION_TOKEN_FILE, 'utf8').trim();
const receipt = JSON.parse(fs.readFileSync(process.env.PMAI_VALIDATION_RECEIPT_FILE, 'utf8'));
const incident = Date.parse('2026-08-15T00:00:00.000Z');
const rotatedAt = Date.parse(receipt.rotatedAt);
const hash = crypto.createHash('sha256').update(token).digest('hex');
if (
  receipt.schemaVersion !== 1
  || receipt.applicationId !== process.env.PMAI_VALIDATION_APPLICATION_ID
  || !Number.isFinite(rotatedAt)
  || rotatedAt <= incident
  || rotatedAt > Date.now() + 300000
  || receipt.tokenSha256 !== hash
) process.exit(1);
NODE
unset PMAI_VALIDATION_TOKEN_FILE PMAI_VALIDATION_RECEIPT_FILE PMAI_VALIDATION_APPLICATION_ID

export PMAI_VALIDATION_SETTINGS="$AGENT_ROOT/happy-home/settings.json"
export PMAI_VALIDATION_MACHINE_ID="$PMAI_HAPPY_MACHINE_ID"
export PMAI_VALIDATION_WORKSPACE="$PMAI_AGENT_WORKSPACE"
node <<'NODE'
const fs = require('node:fs');
const settings = JSON.parse(fs.readFileSync(process.env.PMAI_VALIDATION_SETTINGS, 'utf8'));
const sandbox = settings.sandboxConfig;
const sameStrings = (actual, expected) => (
  Array.isArray(actual)
  && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
);
if (
  settings.machineId !== process.env.PMAI_VALIDATION_MACHINE_ID
  || !sandbox?.enabled
  || sandbox.workspaceRoot !== process.env.PMAI_VALIDATION_WORKSPACE
  || sandbox.sessionIsolation !== 'custom'
  || sandbox.networkMode !== 'custom'
  || sandbox.allowLocalBinding !== false
  || !sameStrings(sandbox.customWritePaths, [])
  || !sameStrings(sandbox.extraWritePaths, [])
  || !sameStrings(sandbox.allowedDomains, [
    '*.openai.com',
    'chatgpt.com',
    '*.chatgpt.com',
    'pmai-broker.localhost',
  ])
  || !sameStrings(sandbox.deniedDomains, [])
  || !sameStrings(sandbox.denyReadPaths, [
    '/home/ec2-user',
    '/root',
    '/etc/pmai-discord-agent',
    '/var/lib/pmai-discord-bridge',
    '/var/lib/pmai-happyherd-agent/happy-home',
  ])
) process.exit(1);
NODE
unset PMAI_VALIDATION_SETTINGS PMAI_VALIDATION_MACHINE_ID PMAI_VALIDATION_WORKSPACE

[[ -f "$RELEASE_ROOT/pmai-discord-agent/dist/index.mjs" ]] || die 'installed bridge release is missing'
[[ -x "$RELEASE_ROOT/daemon/bin/happy.mjs" ]] || die 'installed daemon release is missing'
[[ -x "$RELEASE_ROOT/daemon/bin/pmai-codex-policy.mjs" ]] || die 'PMAI Codex policy hook is missing'
[[ -f "$RELEASE_ROOT/build-manifest.json" ]] || die 'installed release manifest is missing'

daemon_state="$AGENT_ROOT/happy-home/daemon.state.json"
[[ -f "$daemon_state" ]] || die 'dedicated HappyHerd daemon state is missing'
daemon_pid="$(node -e "const s=require(process.argv[1]); if(!Number.isInteger(s.pid))process.exit(1); process.stdout.write(String(s.pid))" "$daemon_state")"
daemon_port="$(node -e "const s=require(process.argv[1]); if(!Number.isInteger(s.httpPort)||s.httpPort<1||s.httpPort>65535)process.exit(1); process.stdout.write(String(s.httpPort))" "$daemon_state")"
[[ -d "/proc/$daemon_pid" ]] || die 'dedicated HappyHerd daemon is not running'
daemon_health="$(curl --fail --silent --show-error --max-time 3 \
    -H 'content-type: application/json' \
    --data '{}' \
    "http://127.0.0.1:$daemon_port/list")" || die 'dedicated HappyHerd daemon control endpoint is not ready'
PMAI_DAEMON_HEALTH="$daemon_health" node <<'NODE'
const health = JSON.parse(process.env.PMAI_DAEMON_HEALTH);
if (!health || !Array.isArray(health.children)) process.exit(1);
NODE
unset daemon_health PMAI_DAEMON_HEALTH
node - "$RELEASE_ROOT/build-manifest.json" "$daemon_state" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const state = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const sourceSha = manifest.source?.happyHerdSha;
if (
  !/^[0-9a-f]{40}$/.test(sourceSha ?? '')
  || typeof state.startedWithCliVersion !== 'string'
  || !state.startedWithCliVersion.endsWith(`+happyherd.${sourceSha.slice(0, 12)}`)
) process.exit(1);
NODE

runuser -u "$AGENT_USER" -- env PMAI_HAPPYHERD_RELEASE="$RELEASE_ROOT" \
    "$RELEASE_ROOT/scripts/test-pmai-discord-agent-sandbox.sh" runtime

printf 'PMAI Discord runtime verified.\n'
