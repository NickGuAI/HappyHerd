#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${1:-}"
RELEASE_ROOT="${2:-/opt/happyherd/releases}"
CURRENT_LINK="${3:-/opt/happyherd/current}"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ -n "$ARTIFACT_DIR" ]] || \
    die 'usage: install-host-release.sh ARTIFACT_DIR [RELEASE_ROOT] [CURRENT_LINK]'

for command_name in chmod cp dirname git ln mkdir mktemp mv node realpath rm sha256sum tar; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command not found: $command_name"
done

ARTIFACT_DIR="$(realpath "$ARTIFACT_DIR")"
[[ -f "$ARTIFACT_DIR/build-manifest.json" ]] || die 'artifact build manifest is missing'
[[ -f "$ARTIFACT_DIR/SHA256SUMS" ]] || die 'artifact checksums are missing'

readarray -t manifest_values < <(node - "$ARTIFACT_DIR/build-manifest.json" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sourceSha = manifest.source?.happyHerdSha;
const daemonArtifacts = Array.isArray(manifest.artifacts)
    ? manifest.artifacts.filter((artifact) => /^happyherd-daemon-.+\.tar\.gz$/.test(artifact.filename))
    : [];
const bridgeArtifacts = Array.isArray(manifest.artifacts)
    ? manifest.artifacts.filter((artifact) => /^happyherd-agent-.+\.tar\.gz$/.test(artifact.filename))
    : [];
if (!/^[0-9a-f]{40}$/.test(sourceSha ?? '') || daemonArtifacts.length !== 1 || bridgeArtifacts.length !== 1) {
    process.exit(1);
}
process.stdout.write(`${sourceSha}\n${daemonArtifacts[0].filename}\n${bridgeArtifacts[0].filename}\n`);
NODE
)
[[ "${#manifest_values[@]}" -eq 3 ]] || die 'build manifest has no unique daemon and HappyHerd Agent artifacts'
SOURCE_SHA="${manifest_values[0]}"
DAEMON_FILENAME="${manifest_values[1]}"
BRIDGE_FILENAME="${manifest_values[2]}"
DAEMON_ARCHIVE="$ARTIFACT_DIR/$DAEMON_FILENAME"
BRIDGE_ARCHIVE="$ARTIFACT_DIR/$BRIDGE_FILENAME"

[[ -f "$DAEMON_ARCHIVE" ]] || die "daemon artifact is missing: $DAEMON_FILENAME"
[[ -f "$BRIDGE_ARCHIVE" ]] || die "HappyHerd Agent artifact is missing: $BRIDGE_FILENAME"
git -C "$ROOT" cat-file -e "${SOURCE_SHA}^{commit}" 2>/dev/null || \
    die "source commit is unavailable in this checkout: $SOURCE_SHA"

(
    cd "$ARTIFACT_DIR"
    sha256sum -c SHA256SUMS
)

while IFS= read -r entry; do
    case "$entry" in
        daemon|daemon/*) ;;
        *) die "daemon archive contains an unexpected path: $entry" ;;
    esac
    [[ "$entry" != *'/../'* && "$entry" != '../'* ]] || \
        die "daemon archive contains path traversal: $entry"
done < <(tar -tzf "$DAEMON_ARCHIVE")

while IFS= read -r entry; do
    case "$entry" in
        happyherd-agent|happyherd-agent/*) ;;
        *) die "HappyHerd Agent archive contains an unexpected path: $entry" ;;
    esac
    [[ "$entry" != *'/../'* && "$entry" != '../'* ]] || \
        die "HappyHerd Agent archive contains path traversal: $entry"
done < <(tar -tzf "$BRIDGE_ARCHIVE")

mkdir -p "$RELEASE_ROOT" "$(dirname "$CURRENT_LINK")"
RELEASE_ROOT="$(realpath "$RELEASE_ROOT")"
TARGET="$RELEASE_ROOT/$SOURCE_SHA"
[[ ! -e "$TARGET" ]] || die "immutable release already exists: $TARGET"

STAGE="$(mktemp -d "$RELEASE_ROOT/.${SOURCE_SHA}.XXXXXX")"
LINK_STAGE=''
cleanup() {
    [[ -z "$LINK_STAGE" ]] || rm -f "$LINK_STAGE"
    [[ -z "$STAGE" ]] || rm -rf "$STAGE"
}
trap cleanup EXIT

cp "$ARTIFACT_DIR/build-manifest.json" "$ARTIFACT_DIR/SHA256SUMS" "$STAGE/"
tar -xzf "$DAEMON_ARCHIVE" -C "$STAGE"
tar -xzf "$BRIDGE_ARCHIVE" -C "$STAGE"
git -C "$ROOT" archive "$SOURCE_SHA" scripts deploy | tar -x -C "$STAGE"

# mktemp deliberately creates mode 0700. The daemon runs as a non-root service
# account, so make the completed immutable release traversable before exposing
# it through `current`.
chmod 0755 "$STAGE"
chmod 0755 "$STAGE/daemon/bin/happy.mjs" "$STAGE/scripts/"*.sh

[[ -x "$STAGE/daemon/bin/happy.mjs" ]] || die 'daemon entrypoint is not executable'
[[ -x "$STAGE/daemon/bin/rg" ]] || die 'daemon sandbox ripgrep is not executable'
[[ -f "$STAGE/happyherd-agent/dist/index.mjs" ]] || die 'HappyHerd Agent entrypoint is missing'
[[ -x "$STAGE/scripts/run-container.sh" ]] || die 'server launcher is not executable'
[[ -x "$STAGE/scripts/activate-release.sh" ]] || die 'release activator is not executable'

mv "$STAGE" "$TARGET"
STAGE=''

LINK_STAGE="$(dirname "$CURRENT_LINK")/.current.${SOURCE_SHA}.$$"
ln -s "$TARGET" "$LINK_STAGE"
mv -Tf "$LINK_STAGE" "$CURRENT_LINK"
LINK_STAGE=''

[[ "$(realpath "$CURRENT_LINK")" == "$TARGET" ]] || die 'current link did not switch atomically'
[[ -x "$CURRENT_LINK/daemon/bin/happy.mjs" ]] || die 'installed daemon is not executable through current'
[[ -x "$CURRENT_LINK/daemon/bin/rg" ]] || die 'installed sandbox ripgrep is unavailable through current'
[[ -f "$CURRENT_LINK/happyherd-agent/dist/index.mjs" ]] || die 'installed HappyHerd Agent is unavailable through current'
[[ -x "$CURRENT_LINK/scripts/run-container.sh" ]] || die 'installed server launcher is unavailable through current'

printf 'HappyHerd host release installed: %s\n' "$TARGET"
