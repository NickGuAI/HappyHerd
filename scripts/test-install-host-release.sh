#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/scripts/install-host-release.sh"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-host-release-test.XXXXXX")"

cleanup() {
    rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
    printf 'host-release-contract: %s\n' "$*" >&2
    exit 1
}

SOURCE_SHA="$(git -C "$ROOT" rev-parse HEAD)"
ARTIFACT_DIR="$TMP_ROOT/artifacts"
PAYLOAD="$TMP_ROOT/payload"
RELEASE_ROOT="$TMP_ROOT/releases"
CURRENT_LINK="$TMP_ROOT/current"
DAEMON_FILENAME='happyherd-daemon-x64-linux.tar.gz'
BRIDGE_FILENAME='happyherd-agent-x64-linux.tar.gz'

mkdir -p "$ARTIFACT_DIR" "$PAYLOAD/daemon/bin" "$PAYLOAD/daemon/tools/unpacked" "$PAYLOAD/happyherd-agent/dist"
printf '#!/usr/bin/env node\n' > "$PAYLOAD/daemon/bin/happy.mjs"
chmod 0755 "$PAYLOAD/daemon/bin/happy.mjs"
printf '#!/usr/bin/env sh\nexit 0\n' > "$PAYLOAD/daemon/tools/unpacked/rg"
chmod 0755 "$PAYLOAD/daemon/tools/unpacked/rg"
ln -s ../tools/unpacked/rg "$PAYLOAD/daemon/bin/rg"
printf 'export async function startHappyHerdAgent() {}\n' > "$PAYLOAD/happyherd-agent/dist/index.mjs"
tar -czf "$ARTIFACT_DIR/$DAEMON_FILENAME" -C "$PAYLOAD" daemon
tar -czf "$ARTIFACT_DIR/$BRIDGE_FILENAME" -C "$PAYLOAD" happyherd-agent
(
    cd "$ARTIFACT_DIR"
    sha256sum "$DAEMON_FILENAME" "$BRIDGE_FILENAME" > SHA256SUMS
)

SOURCE_SHA="$SOURCE_SHA" DAEMON_FILENAME="$DAEMON_FILENAME" BRIDGE_FILENAME="$BRIDGE_FILENAME" ARTIFACT_DIR="$ARTIFACT_DIR" \
    node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const filename = process.env.DAEMON_FILENAME;
const bridgeFilename = process.env.BRIDGE_FILENAME;
const manifest = {
    schemaVersion: 1,
    product: 'HappyHerd',
    source: { happyHerdSha: process.env.SOURCE_SHA },
    artifacts: [filename, bridgeFilename].map((artifactFilename) => ({
        filename: artifactFilename,
        bytes: fs.statSync(path.join(process.env.ARTIFACT_DIR, artifactFilename)).size,
    })),
};
fs.writeFileSync(
    path.join(process.env.ARTIFACT_DIR, 'build-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
);
NODE

"$INSTALLER" "$ARTIFACT_DIR" "$RELEASE_ROOT" "$CURRENT_LINK" >/dev/null

TARGET="$RELEASE_ROOT/$SOURCE_SHA"
[[ "$(realpath "$CURRENT_LINK")" == "$TARGET" ]] || fail 'current link does not identify the immutable source release'
[[ "$(stat -Lc '%a' "$CURRENT_LINK")" == 755 ]] || fail 'release root is not traversable by the daemon service account'
[[ -x "$CURRENT_LINK/daemon/bin/happy.mjs" ]] || fail 'daemon entrypoint is not executable'
[[ -x "$CURRENT_LINK/daemon/bin/rg" ]] || fail 'daemon sandbox ripgrep is not executable'
[[ -f "$CURRENT_LINK/happyherd-agent/dist/index.mjs" ]] || fail 'HappyHerd Agent entrypoint is missing'
[[ -x "$CURRENT_LINK/scripts/run-container.sh" ]] || fail 'complete release omitted the server launcher'
[[ -x "$CURRENT_LINK/scripts/activate-release.sh" ]] || fail 'complete release omitted the release activator'
[[ -x "$CURRENT_LINK/scripts/start-host-daemon.sh" ]] || fail 'complete release omitted the detached daemon bootstrap'
[[ -f "$CURRENT_LINK/deploy/happyherd-daemon.cron" ]] || fail 'complete release omitted the daemon boot entry'
[[ -f "$CURRENT_LINK/deploy/happyherd-agent.service" ]] || fail 'complete release omitted the HappyHerd Agent unit'
[[ ! -e "$CURRENT_LINK/deploy/happyherd-daemon.service" ]] || fail 'release retained the host daemon systemd unit'

if "$INSTALLER" "$ARTIFACT_DIR" "$RELEASE_ROOT" "$CURRENT_LINK" >/dev/null 2>&1; then
    fail 'installer overwrote an existing immutable release'
fi

printf 'Host release installation contract tests passed.\n'
