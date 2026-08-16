#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
ORIGIN_URL="$(git -C "$ROOT" remote get-url origin)"
WORK_DIR="${1:-$(mktemp -d "${TMPDIR:-/tmp}/happyherd-repro.XXXXXX")}"
PRIMARY_OUT="$WORK_DIR/primary"
CLONE_DIR="$WORK_DIR/clean-clone"
CLONE_OUT="$WORK_DIR/clone"

cleanup_on_exit=false
if [[ $# -eq 0 ]]; then
    cleanup_on_exit=true
fi

cleanup() {
    if [[ "$cleanup_on_exit" == true ]]; then
        rm -rf "$WORK_DIR"
    fi
}
trap cleanup EXIT

[[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=normal)" ]] || {
    printf 'error: reproducibility verification requires a clean worktree\n' >&2
    exit 1
}

remote_sha="$(git -C "$ROOT" ls-remote origin refs/heads/main | awk '{print $1}')"
[[ "$remote_sha" == "$HEAD_SHA" ]] || {
    printf 'error: origin/main (%s) does not match HEAD (%s)\n' "$remote_sha" "$HEAD_SHA" >&2
    exit 1
}

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

"$ROOT/scripts/build-release-artifacts.sh" "$PRIMARY_OUT"

git clone --no-local --no-checkout "$ORIGIN_URL" "$CLONE_DIR"
git -C "$CLONE_DIR" checkout --detach "$HEAD_SHA"
git -C "$CLONE_DIR" fetch origin tag happy-upstream-base-2026-08-02 --no-tags

(
    cd "$CLONE_DIR/server"
    pnpm install --frozen-lockfile
)

"$CLONE_DIR/scripts/build-release-artifacts.sh" "$CLONE_OUT"

diff -u "$PRIMARY_OUT/SHA256SUMS" "$CLONE_OUT/SHA256SUMS"
diff -u "$PRIMARY_OUT/build-manifest.json" "$CLONE_OUT/build-manifest.json"

cat > "$WORK_DIR/reproducibility-evidence.json" <<EOF
{
  "schemaVersion": 1,
  "happyHerdSha": "$HEAD_SHA",
  "origin": "$ORIGIN_URL",
  "primaryChecksums": "primary/SHA256SUMS",
  "cleanCloneChecksums": "clone/SHA256SUMS",
  "result": "identical"
}
EOF

printf 'Reproducibility verified for %s\n' "$HEAD_SHA"
printf 'Evidence: %s\n' "$WORK_DIR/reproducibility-evidence.json"
