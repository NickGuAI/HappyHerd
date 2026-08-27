#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-/usr/local/lib/happyherd-cli}"
LINK="${2:-/usr/local/bin/happy}"
HAPPYHERD_LINK="${3:-/usr/local/bin/happyherd}"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ "$(id -u)" -eq 0 ]] || die 'install-host-cli.sh must run as root'
[[ "$TARGET" == /* && "$LINK" == /* && "$HAPPYHERD_LINK" == /* ]] || \
    die 'target and executable links must be absolute paths'

if command -v pnpm >/dev/null 2>&1; then
    PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
    PNPM=(corepack pnpm)
else
    die 'pnpm or corepack is required'
fi

SOURCE_OWNER="$(stat -c '%U' "$ROOT")"
BUILD_USER="${SUDO_USER:-$SOURCE_OWNER}"
id "$BUILD_USER" >/dev/null 2>&1 || die "source owner is not a local user: $BUILD_USER"
[[ "$BUILD_USER" == root ]] || command -v runuser >/dev/null 2>&1 || \
    die 'runuser is required when installing from a non-root-owned checkout'
BUILD_GROUP="$(id -gn "$BUILD_USER")"
BUILD_HOME="$(getent passwd "$BUILD_USER" | cut -d: -f6)"
[[ -n "$BUILD_HOME" ]] || die "cannot determine home directory for build user: $BUILD_USER"

run_build() {
    if [[ "$BUILD_USER" == root ]]; then
        "$@"
    else
        runuser -u "$BUILD_USER" -- env HOME="$BUILD_HOME" PATH="$PATH" "$@"
    fi
}

# Build as the checkout owner so a root installation never leaves root-owned
# artifacts in the source tree. Only the final stable installation is root-owned.
(cd "$ROOT/server" && run_build "${PNPM[@]}" --filter @slopus/happy-wire --fail-if-no-match build)
(cd "$ROOT/server" && run_build "${PNPM[@]}" --filter happy --fail-if-no-match build)
stage="$(mktemp -d /tmp/happyherd-cli.stage.XXXXXX)"
chown "$BUILD_USER:$BUILD_GROUP" "$stage"
cleanup() {
    rm -rf "$stage"
}
trap cleanup EXIT
(cd "$ROOT/server" && run_build "${PNPM[@]}" --ignore-scripts --filter happy --fail-if-no-match \
    deploy --legacy --prod "$stage")
node "$stage/scripts/unpack-tools.cjs"
[[ -x "$stage/bin/happy.mjs" && -x "$stage/tools/unpacked/rg" ]] || \
    die 'deployed Happy CLI is missing its executable or bundled ripgrep'

rm -rf "$TARGET"
mv "$stage" "$TARGET"
trap - EXIT
ln -sfn "$TARGET/bin/happy.mjs" "$LINK"
ln -sfn "$TARGET/bin/happy.mjs" "$HAPPYHERD_LINK"

printf 'Happy CLI and thin HappyHerd alias installed independently at %s\n' "$TARGET"
