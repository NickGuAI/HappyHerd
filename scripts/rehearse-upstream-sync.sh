#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
baseline="happyherd-owned-baseline-2026-08-02"
expected_upstream="971d608923f175d3d63af7c204e8c036206b3e99"
upstream_url="https://github.com/slopus/happy.git"
origin_url="$(git -C "$repo_root" remote get-url origin)"
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

git clone --no-local --branch main "$origin_url" "$work_dir/rehearsal" >/dev/null
git -C "$work_dir/rehearsal" remote add upstream "$upstream_url"
git -C "$work_dir/rehearsal" fetch upstream main --tags >/dev/null

live_upstream="$(git -C "$work_dir/rehearsal" rev-parse upstream/main)"
[[ "$live_upstream" == "$expected_upstream" ]] ||
  fail "upstream/main advanced to $live_upstream; repeat A5 against the new SHA"

clone_before="$(git -C "$work_dir/rehearsal" rev-parse HEAD)"
git -C "$work_dir/rehearsal" subtree pull --prefix=server upstream main
clone_after="$(git -C "$work_dir/rehearsal" rev-parse HEAD)"

[[ "$clone_before" == "$clone_after" ]] ||
  fail "expected an identity sync at the recorded upstream SHA"

echo
echo "Owned patch range-diff (before -> after):"
git -C "$work_dir/rehearsal" range-diff --no-color \
  "${baseline}..${clone_before}" \
  "${baseline}..${clone_after}"

git -C "$work_dir/rehearsal" diff --quiet "${clone_before}^{tree}" "${clone_after}^{tree}" ||
  fail "identity sync changed the repository tree"

echo
echo "upstream-rehearsal: ok (upstream ${live_upstream:0:12}; HEAD ${clone_after:0:12})"
