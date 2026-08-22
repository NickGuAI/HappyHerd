#!/usr/bin/env bash
set -euo pipefail

BRIDGE_ENV="${1:-/etc/happyherd-agent/bridge.env}"
DAEMON_ENV="${2:-/etc/happyherd-agent/daemon.env}"
BRIDGE_USER=happyherd-agent-bridge
AGENT_USER=happyherd-agent-runtime
BRIDGE_KEY=/var/lib/happyherd-agent-bridge/happy-agent/agent.key
DAEMON_KEY=/var/lib/happyherd-agent-runtime/happy-home/access.key
DAEMON_SETTINGS=/var/lib/happyherd-agent-runtime/happy-home/settings.json
DAEMON_ROOT="${HAPPYHERD_CLI_ROOT:-/usr/local/lib/happyherd-cli}"
DAEMON_CLI="${HAPPYHERD_DAEMON_CLI:-$DAEMON_ROOT/bin/happy.mjs}"
DAEMON_BOOTSTRAP="${HAPPYHERD_DAEMON_BOOTSTRAP:-/usr/local/lib/happyherd/start-host-daemon.sh}"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ "$(id -u)" -eq 0 ]] || die 'HappyHerd account provisioning must run as root'
[[ -r "$BRIDGE_ENV" && -r "$DAEMON_ENV" ]] || die 'bridge and daemon environment files must be installed first'
[[ -x "$DAEMON_CLI" ]] || die 'installed HappyHerd daemon CLI is missing'
[[ ! -e "$BRIDGE_KEY" && ! -e "$DAEMON_KEY" ]] || \
    die 'dedicated HappyHerd credentials already exist; refusing to replace them'

set -a
# shellcheck disable=SC1090
source "$BRIDGE_ENV"
set +a
[[ "${HAPPY_SERVER_URL:-}" == https://* ]] || die 'HAPPY_SERVER_URL must use HTTPS'

export HAPPYHERD_AGENT_PROVISION_HAPPY_SERVER_URL="$HAPPY_SERVER_URL"
export HAPPYHERD_AGENT_PROVISION_BRIDGE_KEY="$BRIDGE_KEY"
export HAPPYHERD_AGENT_PROVISION_DAEMON_KEY="$DAEMON_KEY"
export HAPPYHERD_AGENT_PROVISION_DAEMON_ROOT="$DAEMON_ROOT"
node <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const tweetnacl = require(`${process.env.HAPPYHERD_AGENT_PROVISION_DAEMON_ROOT}/node_modules/tweetnacl`);

const serverUrl = new URL(process.env.HAPPYHERD_AGENT_PROVISION_HAPPY_SERVER_URL);
if (serverUrl.protocol !== 'https:' || serverUrl.username || serverUrl.password) {
  throw new Error('Dedicated HappyHerd account endpoint must be credential-free HTTPS');
}
const secret = crypto.randomBytes(32);
const signing = tweetnacl.sign.keyPair.fromSeed(secret);

const issueToken = async () => {
  const challenge = crypto.randomBytes(32);
  const signature = tweetnacl.sign.detached(challenge, signing.secretKey);
  const response = await fetch(new URL('/v1/auth', serverUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-happy-client': 'happyherd-agent-provisioner/1',
    },
    body: JSON.stringify({
      publicKey: Buffer.from(signing.publicKey).toString('base64'),
      challenge: challenge.toString('base64'),
      signature: Buffer.from(signature).toString('base64'),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HappyHerd account token issuance failed with HTTP ${response.status}`);
  const body = await response.json();
  if (body?.success !== true || typeof body.token !== 'string' || !body.token) {
    throw new Error('HappyHerd account token response is invalid');
  }
  return body.token;
};

const writeAtomicExclusive = (target, value) => {
  const temp = path.join(path.dirname(target), `.credential-${process.pid}-${crypto.randomUUID()}.tmp`);
  const descriptor = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (fs.existsSync(target)) {
    fs.unlinkSync(temp);
    throw new Error(`Credential target appeared during provisioning: ${target}`);
  }
  fs.renameSync(temp, target);
};

(async () => {
  const createdTargets = [];
  const bridgeToken = await issueToken();
  const daemonToken = await issueToken();
  if (bridgeToken === daemonToken) throw new Error('HappyHerd issued duplicate client tokens');
  const encodedSecret = secret.toString('base64');
  try {
    writeAtomicExclusive(process.env.HAPPYHERD_AGENT_PROVISION_BRIDGE_KEY, {
      token: bridgeToken,
      secret: encodedSecret,
    });
    createdTargets.push(process.env.HAPPYHERD_AGENT_PROVISION_BRIDGE_KEY);
    writeAtomicExclusive(process.env.HAPPYHERD_AGENT_PROVISION_DAEMON_KEY, {
      token: daemonToken,
      secret: encodedSecret,
    });
    createdTargets.push(process.env.HAPPYHERD_AGENT_PROVISION_DAEMON_KEY);
  } catch (error) {
    for (const target of createdTargets) {
      try { fs.unlinkSync(target); } catch {}
    }
    throw error;
  }
})().catch((error) => {
  process.stderr.write(`Dedicated HappyHerd account provisioning failed: ${error.message}\n`);
  process.exit(1);
});
NODE
unset HAPPYHERD_AGENT_PROVISION_HAPPY_SERVER_URL HAPPYHERD_AGENT_PROVISION_BRIDGE_KEY \
    HAPPYHERD_AGENT_PROVISION_DAEMON_KEY HAPPYHERD_AGENT_PROVISION_DAEMON_ROOT

chown "$BRIDGE_USER:$BRIDGE_USER" "$BRIDGE_KEY"
chmod 0600 "$BRIDGE_KEY"
chown "$AGENT_USER:$AGENT_USER" "$DAEMON_KEY"
chmod 0600 "$DAEMON_KEY"

runuser -u "$AGENT_USER" -- env -i \
    HOME=/var/lib/happyherd-agent-runtime \
    HAPPY_SERVER_URL="$HAPPY_SERVER_URL" \
    HAPPY_WEBAPP_URL="$HAPPY_SERVER_URL" \
    HAPPY_HOME_DIR=/var/lib/happyherd-agent-runtime/happy-home \
    PATH="$DAEMON_ROOT/bin:$DAEMON_ROOT/tools/unpacked:/usr/local/bin:/usr/bin:/bin" \
    SHELL=/bin/bash \
    /usr/bin/node "$DAEMON_CLI" auth login

machine_id="$(node -e "const s=require(process.argv[1]); if(typeof s.machineId!=='string'||!s.machineId)process.exit(1); process.stdout.write(s.machineId)" "$DAEMON_SETTINGS")"
export HAPPYHERD_AGENT_PROVISION_BRIDGE_ENV="$BRIDGE_ENV"
export HAPPYHERD_AGENT_PROVISION_MACHINE_ID="$machine_id"
node <<'NODE'
const fs = require('node:fs');
const path = process.env.HAPPYHERD_AGENT_PROVISION_BRIDGE_ENV;
const lines = fs.readFileSync(path, 'utf8').split('\n');
let replacements = 0;
const updated = lines.map((line) => {
  if (!line.startsWith('HAPPYHERD_AGENT_MACHINE_ID=')) return line;
  replacements += 1;
  return `HAPPYHERD_AGENT_MACHINE_ID=${process.env.HAPPYHERD_AGENT_PROVISION_MACHINE_ID}`;
});
if (replacements !== 1) throw new Error('bridge environment must contain one HAPPYHERD_AGENT_MACHINE_ID assignment');
fs.writeFileSync(path, updated.join('\n'));
NODE
unset HAPPYHERD_AGENT_PROVISION_BRIDGE_ENV HAPPYHERD_AGENT_PROVISION_MACHINE_ID

runuser -u "$AGENT_USER" -- "$DAEMON_BOOTSTRAP" "$DAEMON_ENV"
printf 'Dedicated HappyHerd Agent account, machine, and daemon provisioned without personal credentials.\n'
