#!/usr/bin/env bash
set -euo pipefail

export GIT_MERGE_AUTOEDIT=no

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
baseline="happyherd-owned-baseline-2026-08-02"
upstream_url="https://github.com/slopus/happy.git"
origin_url="$(git -C "$repo_root" remote get-url origin)"
clone_source="${HAPPYHERD_CLONE_SOURCE:-$origin_url}"
head_before="$(git -C "$repo_root" rev-parse HEAD)"
origin_head="$(git -C "$repo_root" ls-remote origin refs/heads/main | awk '{print $1}')"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-sync-rehearsal.XXXXXX")"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

fail() {
  echo "upstream-rehearsal: $*" >&2
  exit 1
}

[[ -z "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]] ||
  fail "delivery checkout must be clean"
[[ "$origin_head" == "$head_before" ]] ||
  fail "HEAD is not the pushed origin/main commit"

if [[ -n "${HAPPYHERD_CLONE_SOURCE:-}" ]]; then
  [[ "$(git -C "$clone_source" rev-parse HEAD)" == "$head_before" ]] ||
    fail "clone source is not the verified pushed commit"
  [[ -z "$(git -C "$clone_source" status --porcelain --untracked-files=normal)" ]] ||
    fail "clone source worktree is not clean"
fi

declare -A manifest_subjects=()
while IFS=$'\t' read -r gate _ subject _; do
  [[ -z "$gate" || "$gate" == \#* ]] && continue
  manifest_subjects[$subject]=1
done < "$repo_root/docs/owned-patches.tsv"

verify_owned_identity() {
  local range_diff="$1"
  local subject match

  for subject in "${!manifest_subjects[@]}"; do
    match="$(printf '%s\n' "$range_diff" | grep -F -- "$subject" || true)"
    [[ "$match" == *" = "* ]] ||
      fail "owned patch was not preserved by range-diff: $subject"
  done
}

# Phase 1: exercise the public remote exactly as it exists at run time.
git clone --quiet --no-local --branch main "$clone_source" "$work_dir/live-rehearsal"
git -C "$work_dir/live-rehearsal" remote set-url origin "$origin_url"
git -C "$work_dir/live-rehearsal" config user.name "HappyHerd Sync Rehearsal"
git -C "$work_dir/live-rehearsal" config user.email "happyherd-sync@invalid.local"
git -C "$work_dir/live-rehearsal" remote add upstream "$upstream_url"
git -C "$work_dir/live-rehearsal" fetch upstream main --tags >/dev/null

live_upstream="$(git -C "$work_dir/live-rehearsal" rev-parse upstream/main)"
live_before="$(git -C "$work_dir/live-rehearsal" rev-parse HEAD)"
git -C "$work_dir/live-rehearsal" subtree pull --prefix=server upstream main \
  -m "Merge commit '$live_upstream'"
live_after="$(git -C "$work_dir/live-rehearsal" rev-parse HEAD)"

if [[ "$live_before" == "$live_after" ]]; then
  echo
  echo "Live upstream is already integrated at ${live_upstream}."
else
  echo
  echo "Live upstream range-diff (before -> after):"
  live_range_diff="$(git -C "$work_dir/live-rehearsal" range-diff --no-color \
    "${baseline}..${live_before}" \
    "${baseline}..${live_after}")"
  printf '%s\n' "$live_range_diff"
  verify_owned_identity "$live_range_diff"
fi

(
  cd "$work_dir/live-rehearsal/server"
  pnpm install --frozen-lockfile
)
"$work_dir/live-rehearsal/scripts/contract-suite.sh"

echo
echo "upstream-rehearsal: ok (upstream ${live_upstream}; post-sync ${live_after})"
