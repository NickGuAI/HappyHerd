#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-owned-merge.XXXXXX")"
fixture="$work_dir/fixture"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

fail() {
  echo "owned-merge-provenance: $*" >&2
  exit 1
}

git init --quiet "$fixture"
git -C "$fixture" config user.name "HappyHerd Owned Merge Test"
git -C "$fixture" config user.email "happyherd-owned-merge@invalid.local"

git -C "$fixture" switch --orphan upstream-base >/dev/null 2>&1
printf 'baseline\n' > "$fixture/app.txt"
git -C "$fixture" add app.txt
git -C "$fixture" commit --quiet -m "test: create fixture upstream base"
upstream_base="$(git -C "$fixture" rev-parse HEAD)"

git -C "$fixture" switch --orphan main >/dev/null 2>&1
git -C "$fixture" rm -rf . >/dev/null 2>&1 || true
mkdir -p "$fixture/docs" "$fixture/scripts" "$fixture/server"
printf '# gate\tstate\tsubject\tevidence\n' > "$fixture/docs/owned-patches.tsv"
cp "$repo_root/scripts/verify-patch-discipline.sh" "$fixture/scripts/verify-patch-discipline.sh"
printf 'baseline\n' > "$fixture/server/app.txt"
git -C "$fixture" add docs scripts server
git -C "$fixture" commit --quiet -m "test: create fixture distribution baseline"
fixture_baseline="$(git -C "$fixture" rev-parse HEAD)"
git -C "$fixture" tag fixture-owned-baseline "$fixture_baseline"
git -C "$fixture" symbolic-ref HEAD refs/heads/main

run_case() {
  local name="$1"
  local variant="$2"
  local expected="$3"
  local case_dir="$work_dir/$name"
  local output rc=0

  git clone --quiet --branch main "$fixture" "$case_dir"
  git -C "$case_dir" config user.name "HappyHerd Owned Merge Test"
  git -C "$case_dir" config user.email "happyherd-owned-merge@invalid.local"
  git -C "$case_dir" remote add upstream "$fixture"
  git -C "$case_dir" update-ref refs/remotes/upstream/main "$upstream_base"
  git -C "$case_dir" switch -c feat/owned >/dev/null 2>&1
  printf 'owned change\n' > "$case_dir/server/app.txt"
  if [[ "$variant" != "unmanifested" ]]; then
    printf 'TEST\tcode-ready\tfeat(test): add owned change\tserver/app.txt\n' \
      >> "$case_dir/docs/owned-patches.tsv"
  fi
  git -C "$case_dir" add docs/owned-patches.tsv server/app.txt
  git -C "$case_dir" commit --quiet -m "feat(test): add owned change"
  git -C "$case_dir" switch main >/dev/null 2>&1
  git -C "$case_dir" merge --no-ff --no-commit feat/owned >/dev/null 2>&1
  if [[ "$variant" == "merge-only-change" ]]; then
    printf 'not present on the reviewed branch\n' > "$case_dir/docs/merge-only.txt"
    git -C "$case_dir" add docs/merge-only.txt
  fi
  git -C "$case_dir" commit --quiet -m "Merge pull request #1 from NickGuAI/feat/owned"

  output="$(
    HAPPYHERD_ALLOW_REHEARSAL_SYNC=1 \
    HAPPYHERD_REHEARSAL_BASELINE_TAG=fixture-owned-baseline \
    HAPPYHERD_REHEARSAL_BASELINE_SHA="$fixture_baseline" \
    HAPPYHERD_REHEARSAL_UPSTREAM_REF="$upstream_base" \
    HAPPYHERD_REHEARSAL_TRUSTED_UPSTREAM_REF=refs/remotes/upstream/main \
    HAPPYHERD_REHEARSAL_TRUSTED_UPSTREAM_URL="$fixture" \
      "$case_dir/scripts/verify-patch-discipline.sh" 2>&1
  )" || rc=$?

  if [[ "$expected" == "pass" ]]; then
    [[ "$rc" -eq 0 ]] || fail "$name should pass: $output"
    [[ "$output" == *"patch-discipline: ok"* ]] ||
      fail "$name did not report success"
  else
    [[ "$rc" -ne 0 ]] || fail "$name should fail"
    [[ "$output" == *"$expected"* ]] ||
      fail "$name failed for the wrong reason: $output"
  fi
}

run_case valid valid pass
run_case unmanifested unmanifested "unmanifested patch"
run_case merge-only-change merge-only-change "merge tree contains changes outside its branch patches"

echo "owned-merge-provenance: ok (1 valid and 2 rejected fixtures)"
