#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_ROOT="$ROOT/server"
HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
SHORT_SHA="$(git -C "$ROOT" rev-parse --short=12 HEAD)"
UPSTREAM_SHA="$(git -C "$ROOT" rev-parse 'happy-upstream-base-2026-08-02^{commit}')"
SOURCE_DATE_EPOCH="$(git -C "$ROOT" show -s --format=%ct HEAD)"
COMMIT_TIMESTAMP="$(git -C "$ROOT" show -s --format=%cI HEAD)"
PUBLIC_URL="${HAPPYHERD_PUBLIC_URL:-https://happyherd.gehirn.ai}"
OUT_DIR="${1:-$ROOT/.artifacts/$SHORT_SHA}"
if [[ "$OUT_DIR" != /* ]]; then
    OUT_DIR="$ROOT/$OUT_DIR"
fi
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-artifacts.XXXXXX")"

cleanup() {
    rm -rf "$STAGE"
}
trap cleanup EXIT

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

stable_archive() {
    local source_name="$1"
    local output_name="$2"
    tar \
        --sort=name \
        --mtime="@$SOURCE_DATE_EPOCH" \
        --owner=0 \
        --group=0 \
        --numeric-owner \
        --format=gnu \
        -cf - \
        -C "$STAGE" \
        "$source_name" | gzip -n > "$OUT_DIR/$output_name"
}

for command_name in git node pnpm bun tar gzip sha256sum find readlink; do
    require_command "$command_name"
done

PNPM_VERSION="$(cd "$SERVER_ROOT" && pnpm --version)"
[[ "$PNPM_VERSION" == "10.11.0" ]] || die "pnpm 10.11.0 is required"
[[ "$(bun --version)" == "1.3.11" ]] || die "bun 1.3.11 is required"
[[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=normal)" ]] || \
    die "release artifacts must be built from a clean worktree"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR" "$STAGE/web" "$STAGE/ios" "$STAGE/server" "$STAGE/daemon" "$STAGE/pmai-discord-agent"

export APP_ENV=production
export CI=1
export EXPO_NO_TELEMETRY=1
export EXPO_PUBLIC_HAPPY_SERVER_URL="$PUBLIC_URL"
export HAPPY_BUILD_COMMIT_SHA="$HEAD_SHA"
export HAPPY_BUILD_COMMIT_TIMESTAMP="$COMMIT_TIMESTAMP"

cd "$SERVER_ROOT"

pnpm --filter happy-app --fail-if-no-match exec expo export \
    --platform web \
    --output-dir "$STAGE/web"

pnpm --filter happy-app --fail-if-no-match exec expo export \
    --platform ios \
    --output-dir "$STAGE/ios"

pnpm --filter happy-server-self-host --fail-if-no-match build
cp -a packages/happy-server-self-host/bin "$STAGE/server/bin"
cp -a packages/happy-server-self-host/dist "$STAGE/server/dist"
cp -a packages/happy-server-self-host/prisma "$STAGE/server/prisma"
cp packages/happy-server-self-host/index.cjs "$STAGE/server/index.cjs"
cp packages/happy-server-self-host/package.json "$STAGE/server/package.json"
cp packages/happy-server-self-host/README.md "$STAGE/server/README.md"

pnpm --filter happy --fail-if-no-match build

# pnpm 10.11 produces the correct pruned lockfile and package payload here, but
# exits before installing when the source workspace uses overrides. Keep that
# fail-closed behavior explicit: only the known configuration mismatch may be
# repaired, and the final install remains frozen, offline, and lockfile-backed.
daemon_deploy_log="$STAGE/daemon-deploy.log"
set +e
pnpm --frozen-lockfile --offline --filter happy --fail-if-no-match deploy \
    --prod "$STAGE/daemon" >"$daemon_deploy_log" 2>&1
daemon_deploy_status=$?
set -e
if [[ "$daemon_deploy_status" -ne 0 ]] && \
    ! grep -Fq 'ERR_PNPM_LOCKFILE_CONFIG_MISMATCH' "$daemon_deploy_log"; then
    cat "$daemon_deploy_log" >&2
    die 'pnpm could not create the locked daemon deployment payload'
fi
[[ -f "$STAGE/daemon/package.json" ]] || die 'daemon deployment package is missing'
[[ -f "$STAGE/daemon/pnpm-lock.yaml" ]] || die 'daemon deployment lockfile is missing'

export DAEMON_STAGE="$STAGE/daemon"
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const daemonStage = process.env.DAEMON_STAGE;
const serverRoot = process.cwd();
const rootPackage = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));
const daemonPackagePath = path.join(daemonStage, 'package.json');
const daemonLockPath = path.join(daemonStage, 'pnpm-lock.yaml');
const overrides = rootPackage.pnpm?.overrides;

if (!overrides || Object.keys(overrides).length === 0) {
    throw new Error('source workspace pnpm overrides are missing');
}

const daemonPackage = JSON.parse(fs.readFileSync(daemonPackagePath, 'utf8'));
daemonPackage.pnpm = { ...daemonPackage.pnpm, overrides };
fs.writeFileSync(daemonPackagePath, `${JSON.stringify(daemonPackage, null, 2)}\n`);

const yaml = require(require.resolve('yaml', { paths: [serverRoot] }));
const daemonLock = yaml.parse(fs.readFileSync(daemonLockPath, 'utf8'));
daemonLock.overrides = overrides;
fs.writeFileSync(daemonLockPath, yaml.stringify(daemonLock, { lineWidth: 0 }));
NODE

(
    cd "$STAGE/daemon"
    # `pnpm deploy` writes the exact pruned production lockfile, which can
    # reference tarballs that a warm workspace install never placed in the
    # content store. Fetch that frozen closure explicitly, then materialize it
    # offline so the archive cannot resolve or drift during installation.
    pnpm --config.prefer-symlinked-executables=true \
        fetch --prod --frozen-lockfile --ignore-scripts
    pnpm \
        --config.inject-workspace-packages=true \
        --config.prefer-symlinked-executables=true \
        install --prod --frozen-lockfile --offline --ignore-scripts
)

# pnpm metadata and generated shell shims can contain absolute build-host paths.
# Symlinked executables keep the archive relocatable; .modules.yaml is not used
# at runtime and is deliberately excluded.
rm -f "$STAGE/daemon/node_modules/.modules.yaml"

while IFS= read -r -d '' shim; do
    resolved="$(readlink -f "$shim")"
    [[ -n "$resolved" && "$resolved" == "$STAGE/daemon/"* ]] || \
        die "daemon executable shim escapes its archive: $shim"
done < <(find "$STAGE/daemon/node_modules" -type l -path '*/.bin/*' -print0)

if find "$STAGE/daemon/node_modules" -type f -path '*/.bin/*' -print -quit | grep -q .; then
    die 'daemon dependency tree contains non-relocatable executable shims'
fi

daemon_smoke_root="$STAGE/daemon-smoke"
mkdir -p "$daemon_smoke_root/home" "$daemon_smoke_root/state"
daemon_smoke_output="$(
    HOME="$daemon_smoke_root/home" \
    HAPPY_HOME_DIR="$daemon_smoke_root/state" \
    HAPPY_SERVER_URL="$PUBLIC_URL" \
    HAPPY_WEBAPP_URL="$PUBLIC_URL" \
    node "$STAGE/daemon/bin/happy.mjs" auth status 2>&1
)"
grep -Fq 'Authentication Status' <<<"$daemon_smoke_output" || \
    die 'extracted daemon smoke did not load the CLI'
grep -Fq 'Not authenticated' <<<"$daemon_smoke_output" || \
    die 'extracted daemon smoke did not finish non-interactively'
rm -rf "$daemon_smoke_root"

platform="$(node -p "process.arch + '-' + process.platform")"
for tool_name in difftastic ripgrep; do
    archive="packages/happy-cli/tools/archives/${tool_name}-${platform}.tar.gz"
    license="packages/happy-cli/tools/archives/${tool_name}-LICENSE"
    [[ -f "$archive" ]] || die "missing daemon tool archive: $archive"
    mkdir -p "$STAGE/daemon/tools/archives"
    find "$STAGE/daemon/tools/archives" \
        -maxdepth 1 \
        -type f \
        -name "${tool_name}-*.tar.gz" \
        ! -name "${tool_name}-${platform}.tar.gz" \
        -delete
    cp "$archive" "$license" "$STAGE/daemon/tools/archives/"
done

(
    cd "$STAGE/daemon"
    node scripts/unpack-tools.cjs
)
[[ -x "$STAGE/daemon/tools/unpacked/rg" ]] || die 'daemon deployment did not unpack ripgrep'
ln -s ../tools/unpacked/rg "$STAGE/daemon/bin/rg"
"$STAGE/daemon/bin/rg" --version >/dev/null || die 'daemon deployment ripgrep is unusable'

pnpm --filter happy-agent --fail-if-no-match build
pnpm --filter @happyherd/pmai-discord-agent --fail-if-no-match build

bridge_deploy_log="$STAGE/pmai-discord-agent-deploy.log"
set +e
pnpm --frozen-lockfile --offline --filter @happyherd/pmai-discord-agent --fail-if-no-match deploy \
    --prod "$STAGE/pmai-discord-agent" >"$bridge_deploy_log" 2>&1
bridge_deploy_status=$?
set -e
if [[ "$bridge_deploy_status" -ne 0 ]] && \
    ! grep -Fq 'ERR_PNPM_LOCKFILE_CONFIG_MISMATCH' "$bridge_deploy_log"; then
    cat "$bridge_deploy_log" >&2
    die 'pnpm could not create the locked PMAI Discord Agent deployment payload'
fi
[[ -f "$STAGE/pmai-discord-agent/package.json" ]] || die 'PMAI Discord Agent deployment package is missing'
[[ -f "$STAGE/pmai-discord-agent/pnpm-lock.yaml" ]] || die 'PMAI Discord Agent deployment lockfile is missing'

export DEPLOY_STAGE="$STAGE/pmai-discord-agent"
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const deployStage = process.env.DEPLOY_STAGE;
const serverRoot = process.cwd();
const rootPackage = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));
const deployPackagePath = path.join(deployStage, 'package.json');
const deployLockPath = path.join(deployStage, 'pnpm-lock.yaml');
const overrides = rootPackage.pnpm?.overrides;
if (!overrides || Object.keys(overrides).length === 0) throw new Error('source workspace pnpm overrides are missing');
const deployPackage = JSON.parse(fs.readFileSync(deployPackagePath, 'utf8'));
deployPackage.pnpm = { ...deployPackage.pnpm, overrides };
fs.writeFileSync(deployPackagePath, `${JSON.stringify(deployPackage, null, 2)}\n`);
const yaml = require(require.resolve('yaml', { paths: [serverRoot] }));
const deployLock = yaml.parse(fs.readFileSync(deployLockPath, 'utf8'));
deployLock.overrides = overrides;
fs.writeFileSync(deployLockPath, yaml.stringify(deployLock, { lineWidth: 0 }));
NODE
unset DEPLOY_STAGE

(
    cd "$STAGE/pmai-discord-agent"
    pnpm --config.prefer-symlinked-executables=true \
        fetch --prod --frozen-lockfile --ignore-scripts
    pnpm \
        --config.inject-workspace-packages=true \
        --config.prefer-symlinked-executables=true \
        install --prod --frozen-lockfile --offline --ignore-scripts
)
rm -f "$STAGE/pmai-discord-agent/node_modules/.modules.yaml"
while IFS= read -r -d '' shim; do
    resolved="$(readlink -f "$shim")"
    [[ -n "$resolved" && "$resolved" == "$STAGE/pmai-discord-agent/"* ]] || \
        die "PMAI Discord Agent executable shim escapes its archive: $shim"
done < <(find "$STAGE/pmai-discord-agent/node_modules" -type l -path '*/.bin/*' -print0)
if find "$STAGE/pmai-discord-agent/node_modules" -type f -path '*/.bin/*' -print -quit | grep -q .; then
    die 'PMAI Discord Agent dependency tree contains non-relocatable executable shims'
fi
(
    cd "$STAGE/pmai-discord-agent"
    node --input-type=module -e \
        "const bridge = await import('./dist/index.mjs'); if (typeof bridge.startPmaiDiscordAgent !== 'function') process.exit(1)"
)

stable_archive web happyherd-web.tar.gz
stable_archive ios happyherd-ios-update.tar.gz
stable_archive server happyherd-server.tar.gz
stable_archive daemon "happyherd-daemon-${platform}.tar.gz"
stable_archive pmai-discord-agent "happyherd-pmai-discord-agent-${platform}.tar.gz"

(
    cd "$OUT_DIR"
    sha256sum happyherd-*.tar.gz | LC_ALL=C sort -k2 > SHA256SUMS
)

export ROOT OUT_DIR HEAD_SHA UPSTREAM_SHA SOURCE_DATE_EPOCH COMMIT_TIMESTAMP PUBLIC_URL
NODE_VERSION="$(node --version)"
export NODE_VERSION
export PNPM_VERSION
BUN_VERSION="$(bun --version)"
export BUN_VERSION
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const sums = fs.readFileSync(path.join(process.env.OUT_DIR, 'SHA256SUMS'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
        const [sha256, filename] = line.trim().split(/\s+/, 2);
        const filePath = path.join(process.env.OUT_DIR, filename);
        return { filename, sha256, bytes: fs.statSync(filePath).size };
    });

const manifest = {
    schemaVersion: 1,
    product: 'HappyHerd',
    source: {
        happyHerdSha: process.env.HEAD_SHA,
        upstreamBaseSha: process.env.UPSTREAM_SHA,
        sourceDateEpoch: Number(process.env.SOURCE_DATE_EPOCH),
        commitTimestamp: process.env.COMMIT_TIMESTAMP,
    },
    build: {
        publicUrl: process.env.PUBLIC_URL,
        node: process.env.NODE_VERSION,
        pnpm: process.env.PNPM_VERSION,
        bun: process.env.BUN_VERSION,
    },
    artifacts: sums,
};

fs.writeFileSync(
    path.join(process.env.OUT_DIR, 'build-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
);
NODE

printf '\nHappyHerd artifacts written to %s\n' "$OUT_DIR"
cat "$OUT_DIR/SHA256SUMS"
