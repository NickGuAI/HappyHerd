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

for command_name in git node pnpm bun tar gzip sha256sum; do
    require_command "$command_name"
done

PNPM_VERSION="$(cd "$SERVER_ROOT" && pnpm --version)"
[[ "$PNPM_VERSION" == "10.11.0" ]] || die "pnpm 10.11.0 is required"
[[ "$(bun --version)" == "1.3.11" ]] || die "bun 1.3.11 is required"
[[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=normal)" ]] || \
    die "release artifacts must be built from a clean worktree"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR" "$STAGE/web" "$STAGE/ios" "$STAGE/server" "$STAGE/daemon"

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

pnpm --filter ./packages/happy-server --fail-if-no-match build
cp -a packages/happy-server/dist "$STAGE/server/dist"
cp -a packages/happy-server/prisma/migrations "$STAGE/server/migrations"
cp packages/happy-server/package.json "$STAGE/server/package.json"

pnpm --filter happy --fail-if-no-match build
cp -a packages/happy-cli/dist "$STAGE/daemon/dist"
cp -a packages/happy-cli/bin "$STAGE/daemon/bin"
cp packages/happy-cli/package.json "$STAGE/daemon/package.json"

platform="$(node -p "process.arch + '-' + process.platform")"
for tool_name in difftastic ripgrep; do
    archive="packages/happy-cli/tools/archives/${tool_name}-${platform}.tar.gz"
    license="packages/happy-cli/tools/archives/${tool_name}-LICENSE"
    [[ -f "$archive" ]] || die "missing daemon tool archive: $archive"
    mkdir -p "$STAGE/daemon/tools/archives"
    cp "$archive" "$license" "$STAGE/daemon/tools/archives/"
done

stable_archive web happyherd-web.tar.gz
stable_archive ios happyherd-ios-update.tar.gz
stable_archive server happyherd-server.tar.gz
stable_archive daemon "happyherd-daemon-${platform}.tar.gz"

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
