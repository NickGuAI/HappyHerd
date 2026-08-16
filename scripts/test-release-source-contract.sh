#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSERT_ORIGIN_MAIN="$ROOT/scripts/assert-origin-main.sh"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-release-source-test.XXXXXX")"

cleanup() {
    rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
    printf 'release-source-contract: %s\n' "$*" >&2
    exit 1
}

git init --bare "$TMP_ROOT/origin.git" >/dev/null
git init "$TMP_ROOT/work" >/dev/null
git -C "$TMP_ROOT/work" config user.name 'HappyHerd Contract Test'
git -C "$TMP_ROOT/work" config user.email 'contract@happyherd.example'
git -C "$TMP_ROOT/work" checkout -b main >/dev/null
printf 'pushed\n' > "$TMP_ROOT/work/release.txt"
git -C "$TMP_ROOT/work" add release.txt
git -C "$TMP_ROOT/work" commit -m 'test: pushed release' >/dev/null
git -C "$TMP_ROOT/work" remote add origin "$TMP_ROOT/origin.git"
git -C "$TMP_ROOT/work" push -u origin main >/dev/null

pushed_sha="$(git -C "$TMP_ROOT/work" rev-parse HEAD)"
[[ "$("$ASSERT_ORIGIN_MAIN" "$TMP_ROOT/work")" == "$pushed_sha" ]] || \
    fail 'pushed main commit was rejected'

printf 'local-only\n' >> "$TMP_ROOT/work/release.txt"
git -C "$TMP_ROOT/work" add release.txt
git -C "$TMP_ROOT/work" commit -m 'test: local only release' >/dev/null
if "$ASSERT_ORIGIN_MAIN" "$TMP_ROOT/work" >/dev/null 2>&1; then
    fail 'local-only HEAD was accepted as a release source'
fi

printf 'Release source contract tests passed.\n'
