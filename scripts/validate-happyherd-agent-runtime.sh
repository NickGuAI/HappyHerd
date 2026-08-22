#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT/deploy/happyherd-agent.env.example}"
MODE="${2:-template}"
BRIDGE_USER=happyherd-agent-bridge
AGENT_USER=happyherd-agent-runtime
BRIDGE_ROOT=/var/lib/happyherd-agent-bridge
AGENT_ROOT=/var/lib/happyherd-agent-runtime
DAEMON_ROOT="${HAPPYHERD_CLI_ROOT:-/usr/local/lib/happyherd-cli}"
AGENT_INSTALL_ROOT="${HAPPYHERD_AGENT_ROOT:-/usr/local/lib/happyherd-agent}"
SUPPORT_ROOT="${HAPPYHERD_AGENT_SUPPORT_ROOT:-/usr/local/lib/happyherd-agent-support}"

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
    HAPPYHERD_AGENT_DISCORD_APPLICATION_ID HAPPYHERD_AGENT_DISCORD_TOKEN_FILE \
    HAPPYHERD_AGENT_DISCORD_TOKEN_ROTATION_RECEIPT_FILE HAPPYHERD_AGENT_DISCORD_TOKEN_NOT_BEFORE \
    HAPPYHERD_AGENT_TOOL_MANIFEST_FILE HAPPYHERD_AGENT_SERVICE_API_URL \
    HAPPYHERD_AGENT_SERVICE_SIGNING_SECRET_FILE HAPPYHERD_AGENT_TRANSPORT_SECRET_FILE \
    HAPPYHERD_AGENT_MACHINE_ID HAPPYHERD_AGENT_WORKSPACE HAPPYHERD_AGENT_COMMANDER_ID \
    HAPPYHERD_AGENT_CODEX_PERMISSION_MODE HAPPYHERD_AGENT_STATE_DIR HAPPYHERD_AGENT_HOST \
    HAPPYHERD_AGENT_PORT HAPPYHERD_AGENT_BROKER_URL HAPPYHERD_AGENT_ALLOWED_GUILD_IDS \
    HAPPYHERD_AGENT_ALLOWED_CHANNEL_IDS; do
    require_value "$name"
done

[[ "$NODE_ENV" == production ]] || die 'NODE_ENV must be production'
[[ "$HAPPYHERD_AGENT_CODEX_PERMISSION_MODE" == read-only ]] || die 'agent Codex must be read-only'
[[ "$HAPPYHERD_AGENT_COMMANDER_ID" =~ ^[a-z][a-z0-9-]{0,63}$ ]] || die 'agent Commander ID is invalid'
[[ "$HAPPY_HOME_DIR" == "$BRIDGE_ROOT/happy-agent" ]] || die 'bridge Happy home is not isolated'
[[ "$HAPPYHERD_AGENT_WORKSPACE" == "$AGENT_ROOT/workspace" ]] || die 'agent workspace is not isolated'
[[ "$HAPPYHERD_AGENT_STATE_DIR" == "$BRIDGE_ROOT/state" ]] || die 'bridge state is not isolated'
[[ "$HAPPYHERD_AGENT_HOST" == 127.0.0.1 ]] || die 'bridge broker must bind to loopback'
[[ "$HAPPYHERD_AGENT_BROKER_URL" == "http://happyherd-agent-broker.localhost:$HAPPYHERD_AGENT_PORT/mcp" ]] || \
    die 'broker URL must use the sandbox-proxied loopback alias'
[[ "$HAPPYHERD_AGENT_SERVICE_API_URL" == https://* ]] || die 'service API must use HTTPS'
[[ "$HAPPY_SERVER_URL" == https://* ]] || die 'HappyHerd server must use HTTPS'
[[ "${HAPPYHERD_AGENT_AUTHORIZATION_PATH:-/api/internal/discord/authorize}" == /api/internal/discord/authorize ]] || \
    die 'unexpected service authorization path'
[[ "$HAPPYHERD_AGENT_TOOL_MANIFEST_FILE" == /etc/happyherd-agent/agent-manifest.json ]] || \
    die 'tool manifest must use the protected agent configuration path'
node -e 'const value=Date.parse(process.argv[1]); if(!Number.isFinite(value)) process.exit(1)' \
    "$HAPPYHERD_AGENT_DISCORD_TOKEN_NOT_BEFORE" || die 'Discord token cutoff must be an ISO-8601 timestamp'

for candidate in "$HAPPY_HOME_DIR" "$HAPPYHERD_AGENT_WORKSPACE" "$HAPPYHERD_AGENT_STATE_DIR"; do
    case "$candidate" in
        /home/*|*/.happy|*/.happy/*|*/.happyherd|*/.happyherd/*|*/.herd|*/.herd/*|*/App|*/App/*)
            die "personal runtime path is forbidden: $candidate"
            ;;
    esac
done

declare -A secret_paths=()
for path in \
    "$HAPPYHERD_AGENT_DISCORD_TOKEN_FILE" \
    "$HAPPYHERD_AGENT_DISCORD_TOKEN_ROTATION_RECEIPT_FILE" \
    "$HAPPYHERD_AGENT_SERVICE_SIGNING_SECRET_FILE" \
    "$HAPPYHERD_AGENT_TRANSPORT_SECRET_FILE"; do
    [[ "$path" == /etc/happyherd-agent/secrets/* ]] || die "secret path escapes its store: $path"
    [[ -z "${secret_paths[$path]:-}" ]] || die 'secret files must be distinct'
    secret_paths[$path]=1
done

if [[ "$MODE" == template ]]; then
    node - "$ROOT/deploy/happyherd-agent-runtime/agent-manifest.example.json" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (
  manifest?.schemaVersion !== 1
  || !/^[a-z][a-z0-9-]{0,63}$/.test(manifest.id ?? '')
  || !Array.isArray(manifest.tools)
  || manifest.tools.length === 0
) process.exit(1);
NODE
    printf 'HappyHerd Agent runtime template verified.\n'
    exit 0
fi

[[ "$(id -u)" -eq 0 ]] || die 'runtime validation must run as root'
command -v bwrap >/dev/null 2>&1 || die 'bubblewrap is required for the agent Codex sandbox'
command -v socat >/dev/null 2>&1 || die 'socat is required for sandbox network mediation'
[[ -x "$DAEMON_ROOT/tools/unpacked/rg" ]] || die 'Happy CLI bundled ripgrep is required by the agent Codex sandbox runtime'
for user_name in "$BRIDGE_USER" "$AGENT_USER"; do
    id "$user_name" >/dev/null 2>&1 || die "service user is missing: $user_name"
done
[[ "$(id -u "$BRIDGE_USER")" != "$(id -u "$AGENT_USER")" ]] || die 'service users must be distinct'

for value in \
    "$HAPPYHERD_AGENT_DISCORD_APPLICATION_ID" "$HAPPYHERD_AGENT_MACHINE_ID" \
    "$HAPPYHERD_AGENT_ALLOWED_GUILD_IDS" "$HAPPYHERD_AGENT_ALLOWED_CHANNEL_IDS" \
    "$HAPPYHERD_AGENT_ID"; do
    [[ "$value" != *replace-with* ]] || die 'bridge environment still contains placeholders'
done

[[ -f "$HAPPYHERD_AGENT_TOOL_MANIFEST_FILE" && ! -L "$HAPPYHERD_AGENT_TOOL_MANIFEST_FILE" ]] || \
    die 'tool manifest is missing or is not a regular file'
[[ "$(stat -c '%a:%U' "$HAPPYHERD_AGENT_TOOL_MANIFEST_FILE")" == '640:root' ]] || \
    die 'tool manifest must be mode 0640 and owned by root'

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

for directory in "$BRIDGE_ROOT" "$HAPPY_HOME_DIR" "$HAPPYHERD_AGENT_STATE_DIR"; do
    [[ -d "$directory" ]] || die "bridge directory is missing: $directory"
    [[ "$(stat -c '%U' "$directory")" == "$BRIDGE_USER" ]] || die "bridge directory has the wrong owner: $directory"
done
for directory in "$AGENT_ROOT" "$AGENT_ROOT/codex-home" "$AGENT_ROOT/happy-home" "$HAPPYHERD_AGENT_WORKSPACE"; do
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
    PATH="$DAEMON_ROOT/bin:$DAEMON_ROOT/tools/unpacked:$AGENT_ROOT/.local/bin:/usr/local/bin:/usr/bin:/bin" \
    SHELL=/bin/bash \
    codex --version >/dev/null 2>&1; then
    die 'dedicated Codex executable is missing or unusable'
fi
if ! runuser -u "$AGENT_USER" -- env -i \
    HOME="$AGENT_ROOT" \
    PATH="$DAEMON_ROOT/bin:$DAEMON_ROOT/tools/unpacked:/usr/local/bin:/usr/bin:/bin" \
    rg --version >/dev/null 2>&1; then
    die 'Happy CLI bundled ripgrep is unusable by the dedicated agent'
fi

export HAPPYHERD_AGENT_VALIDATION_AGENT_KEY="$HAPPY_HOME_DIR/agent.key"
export HAPPYHERD_AGENT_VALIDATION_DAEMON_KEY="$AGENT_ROOT/happy-home/access.key"
export HAPPYHERD_AGENT_VALIDATION_DAEMON_ROOT="$DAEMON_ROOT"
node <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const daemonRoot = process.env.HAPPYHERD_AGENT_VALIDATION_DAEMON_ROOT;
const tweetnacl = require(path.join(daemonRoot, 'node_modules/tweetnacl'));

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

const agent = JSON.parse(fs.readFileSync(process.env.HAPPYHERD_AGENT_VALIDATION_AGENT_KEY, 'utf8'));
const daemon = JSON.parse(fs.readFileSync(process.env.HAPPYHERD_AGENT_VALIDATION_DAEMON_KEY, 'utf8'));
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
unset HAPPYHERD_AGENT_VALIDATION_AGENT_KEY HAPPYHERD_AGENT_VALIDATION_DAEMON_KEY \
    HAPPYHERD_AGENT_VALIDATION_DAEMON_ROOT

for path in \
    "$AGENT_ROOT/happy-home/AGENTS.md" \
    "$AGENT_ROOT/happy-home/agentcontext/USER.md" \
    "$AGENT_ROOT/happy-home/commanders/$HAPPYHERD_AGENT_COMMANDER_ID/COMMANDER.md" \
    "$HAPPYHERD_AGENT_WORKSPACE/AGENTS.md"; do
    [[ -f "$path" && "$(stat -c '%U' "$path")" == "$AGENT_USER" ]] || die "runtime context is missing or misowned: $path"
done

export HAPPYHERD_AGENT_VALIDATION_TOKEN_FILE="$HAPPYHERD_AGENT_DISCORD_TOKEN_FILE"
export HAPPYHERD_AGENT_VALIDATION_RECEIPT_FILE="$HAPPYHERD_AGENT_DISCORD_TOKEN_ROTATION_RECEIPT_FILE"
export HAPPYHERD_AGENT_VALIDATION_APPLICATION_ID="$HAPPYHERD_AGENT_DISCORD_APPLICATION_ID"
export HAPPYHERD_AGENT_VALIDATION_TOKEN_NOT_BEFORE="$HAPPYHERD_AGENT_DISCORD_TOKEN_NOT_BEFORE"
node <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const token = fs.readFileSync(process.env.HAPPYHERD_AGENT_VALIDATION_TOKEN_FILE, 'utf8').trim();
const receipt = JSON.parse(fs.readFileSync(process.env.HAPPYHERD_AGENT_VALIDATION_RECEIPT_FILE, 'utf8'));
const notBefore = Date.parse(process.env.HAPPYHERD_AGENT_VALIDATION_TOKEN_NOT_BEFORE);
const rotatedAt = Date.parse(receipt.rotatedAt);
const hash = crypto.createHash('sha256').update(token).digest('hex');
if (
  receipt.schemaVersion !== 1
  || receipt.applicationId !== process.env.HAPPYHERD_AGENT_VALIDATION_APPLICATION_ID
  || !Number.isFinite(rotatedAt)
  || !Number.isFinite(notBefore)
  || rotatedAt < notBefore
  || rotatedAt > Date.now() + 300000
  || receipt.tokenSha256 !== hash
) process.exit(1);
NODE
unset HAPPYHERD_AGENT_VALIDATION_TOKEN_FILE HAPPYHERD_AGENT_VALIDATION_RECEIPT_FILE \
    HAPPYHERD_AGENT_VALIDATION_APPLICATION_ID HAPPYHERD_AGENT_VALIDATION_TOKEN_NOT_BEFORE

export HAPPYHERD_AGENT_VALIDATION_SETTINGS="$AGENT_ROOT/happy-home/settings.json"
export HAPPYHERD_AGENT_VALIDATION_MACHINE_ID="$HAPPYHERD_AGENT_MACHINE_ID"
export HAPPYHERD_AGENT_VALIDATION_WORKSPACE="$HAPPYHERD_AGENT_WORKSPACE"
node <<'NODE'
const fs = require('node:fs');
const settings = JSON.parse(fs.readFileSync(process.env.HAPPYHERD_AGENT_VALIDATION_SETTINGS, 'utf8'));
const sandbox = settings.sandboxConfig;
const sameStrings = (actual, expected) => (
  Array.isArray(actual)
  && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
);
if (
  settings.machineId !== process.env.HAPPYHERD_AGENT_VALIDATION_MACHINE_ID
  || !sandbox?.enabled
  || sandbox.workspaceRoot !== process.env.HAPPYHERD_AGENT_VALIDATION_WORKSPACE
  || sandbox.sessionIsolation !== 'custom'
  || sandbox.networkMode !== 'custom'
  || sandbox.allowLocalBinding !== false
  || !sameStrings(sandbox.customWritePaths, [])
  || !sameStrings(sandbox.extraWritePaths, [])
  || !sameStrings(sandbox.allowedDomains, [
    '*.openai.com',
    'chatgpt.com',
    '*.chatgpt.com',
    'happyherd-agent-broker.localhost',
  ])
  || !sameStrings(sandbox.deniedDomains, [])
  || !sameStrings(sandbox.denyReadPaths, [
    '/home',
    '/root',
    '/etc/happyherd-agent',
    '/var/lib/happyherd-agent-bridge',
    '/var/lib/happyherd-agent-runtime/happy-home',
  ])
) process.exit(1);
NODE
unset HAPPYHERD_AGENT_VALIDATION_SETTINGS HAPPYHERD_AGENT_VALIDATION_MACHINE_ID HAPPYHERD_AGENT_VALIDATION_WORKSPACE

[[ -f "$AGENT_INSTALL_ROOT/dist/index.mjs" ]] || die 'installed bridge package is missing'
[[ -x "$DAEMON_ROOT/bin/happy.mjs" ]] || die 'installed Happy CLI is missing'
[[ -x "$DAEMON_ROOT/bin/happyherd-agent-codex-policy.mjs" ]] || die 'agent Codex policy hook is missing'

daemon_state="$AGENT_ROOT/happy-home/daemon.state.json"
[[ -f "$daemon_state" ]] || die 'dedicated HappyHerd daemon state is missing'
daemon_pid="$(node -e "const s=require(process.argv[1]); if(!Number.isInteger(s.pid))process.exit(1); process.stdout.write(String(s.pid))" "$daemon_state")"
daemon_port="$(node -e "const s=require(process.argv[1]); if(!Number.isInteger(s.httpPort)||s.httpPort<1||s.httpPort>65535)process.exit(1); process.stdout.write(String(s.httpPort))" "$daemon_state")"
[[ -d "/proc/$daemon_pid" ]] || die 'dedicated HappyHerd daemon is not running'
daemon_health="$(curl --fail --silent --show-error --max-time 3 \
    -H 'content-type: application/json' \
    --data '{}' \
    "http://127.0.0.1:$daemon_port/list")" || die 'dedicated HappyHerd daemon control endpoint is not ready'
HAPPYHERD_AGENT_DAEMON_HEALTH="$daemon_health" node <<'NODE'
const health = JSON.parse(process.env.HAPPYHERD_AGENT_DAEMON_HEALTH);
if (!health || !Array.isArray(health.children)) process.exit(1);
NODE
unset daemon_health HAPPYHERD_AGENT_DAEMON_HEALTH

runuser -u "$AGENT_USER" -- env \
    PATH="$DAEMON_ROOT/bin:$DAEMON_ROOT/tools/unpacked:/usr/local/bin:/usr/bin:/bin" \
    HAPPYHERD_CLI_ROOT="$DAEMON_ROOT" \
    "$SUPPORT_ROOT/scripts/test-happyherd-agent-sandbox.sh" runtime

printf 'HappyHerd Agent runtime verified.\n'
