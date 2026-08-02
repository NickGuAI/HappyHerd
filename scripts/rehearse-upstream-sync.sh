#!/usr/bin/env bash
set -euo pipefail

export GIT_MERGE_AUTOEDIT=no

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
baseline="happyherd-owned-baseline-2026-08-02"
distribution_shell="ee05253ca0b964d8aad071b2f424dff0752a836c"
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
git clone --no-local --branch main "$origin_url" "$work_dir/live-rehearsal" >/dev/null
git -C "$work_dir/live-rehearsal" config user.name "HappyHerd Sync Rehearsal"
git -C "$work_dir/live-rehearsal" config user.email "happyherd-sync@invalid.local"
git -C "$work_dir/live-rehearsal" remote add upstream "$upstream_url"
git -C "$work_dir/live-rehearsal" fetch upstream main --tags >/dev/null

live_upstream="$(git -C "$work_dir/live-rehearsal" rev-parse upstream/main)"
earlier_upstream="$(git -C "$work_dir/live-rehearsal" rev-parse "${live_upstream}^1")"
live_before="$(git -C "$work_dir/live-rehearsal" rev-parse HEAD)"
git -C "$work_dir/live-rehearsal" subtree pull --prefix=server upstream main
live_after="$(git -C "$work_dir/live-rehearsal" rev-parse HEAD)"

echo
echo "Live upstream range-diff (before -> after):"
live_range_diff="$(git -C "$work_dir/live-rehearsal" range-diff --no-color \
  "${baseline}..${live_before}" \
  "${baseline}..${live_after}")"
printf '%s\n' "$live_range_diff"
verify_owned_identity "$live_range_diff"

# Phase 2: reconstruct the distribution at the previous real upstream commit,
# apply the exact owned series, then integrate the current real upstream commit.
git clone --no-local --branch main "$origin_url" "$work_dir/real-delta-rehearsal" >/dev/null
candidate="$work_dir/real-delta-rehearsal"
git -C "$candidate" config user.name "HappyHerd Sync Rehearsal"
git -C "$candidate" config user.email "happyherd-sync@invalid.local"
git -C "$candidate" remote add upstream "$upstream_url"
git -C "$candidate" fetch upstream main --tags >/dev/null
git -C "$candidate" switch --detach "$distribution_shell" >/dev/null
git -C "$candidate" switch -c real-upstream-delta >/dev/null
git -C "$candidate" merge --no-ff --allow-unrelated-histories -s ours \
  "$earlier_upstream" -m "chore: connect earlier Happy upstream for rehearsal" >/dev/null
git -C "$candidate" read-tree --prefix=server/ -u "${earlier_upstream}^{tree}"
git -C "$candidate" commit -m "chore: materialize earlier Happy upstream for rehearsal" >/dev/null
git -C "$candidate" checkout "$baseline" -- docs/lineage.md scripts/verify-lineage.sh
git -C "$candidate" commit -m "chore: codify rehearsal upstream lineage" >/dev/null
rehearsal_baseline="$(git -C "$candidate" rev-parse HEAD)"
git -C "$candidate" tag happyherd-rehearsal-owned-baseline "$rehearsal_baseline"

while IFS=$'\t' read -r sha subject; do
  [[ -n "${manifest_subjects[$subject]:-}" ]] || continue
  parent_count="$(( $(git -C "$repo_root" rev-list --parents -n 1 "$sha" | wc -w) - 1 ))"
  [[ "$parent_count" -eq 1 ]] ||
    fail "cannot replay merge-valued owned patch in rehearsal: $subject"
  git -C "$candidate" cherry-pick "$sha" >/dev/null
done < <(
  git -C "$repo_root" log --first-parent --reverse --format=$'%H\t%s' \
    "${baseline}..${head_before}"
)

clone_before="$(git -C "$candidate" rev-parse HEAD)"
git -C "$candidate" subtree pull --prefix=server upstream main
clone_after="$(git -C "$candidate" rev-parse HEAD)"
[[ "$clone_before" != "$clone_after" ]] || fail "real upstream interval produced a no-op"

echo
echo "Real non-no-op upstream range-diff (before -> after):"
controlled_range_diff="$(git -C "$candidate" range-diff --no-color \
  "${rehearsal_baseline}..${clone_before}" \
  "${rehearsal_baseline}..${clone_after}")"
printf '%s\n' "$controlled_range_diff"
verify_owned_identity "$controlled_range_diff"
live_subject="$(git -C "$candidate" show -s --format=%s "$live_upstream")"
printf '%s\n' "$controlled_range_diff" | grep -F -- "$live_subject" >/dev/null ||
  fail "range-diff did not expose the real upstream delta"

(
  cd "$candidate/server"
  pnpm install --frozen-lockfile
)
HAPPYHERD_ALLOW_REHEARSAL_SYNC=1 \
HAPPYHERD_REHEARSAL_BASELINE_TAG=happyherd-rehearsal-owned-baseline \
HAPPYHERD_REHEARSAL_BASELINE_SHA="$rehearsal_baseline" \
HAPPYHERD_REHEARSAL_UPSTREAM_REF="$earlier_upstream" \
  "$candidate/scripts/contract-suite.sh"

echo
echo "upstream-rehearsal: ok (real interval ${earlier_upstream:0:12}..${live_upstream:0:12}; post-sync ${clone_after:0:12})"
