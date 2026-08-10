#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-sync-provenance.XXXXXX")"
fixture="$work_dir/fixture"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

fail() {
  echo "upstream-sync-provenance: $*" >&2
  exit 1
}

git init --quiet "$fixture"
git -C "$fixture" config user.name "HappyHerd Provenance Test"
git -C "$fixture" config user.email "happyherd-provenance@invalid.local"

git -C "$fixture" switch --orphan upstream-base >/dev/null 2>&1
printf 'upstream base\n' > "$fixture/app.txt"
git -C "$fixture" add app.txt
git -C "$fixture" commit --quiet -m "test: create fixture upstream base"

git -C "$fixture" switch --orphan main >/dev/null 2>&1
git -C "$fixture" rm -rf . >/dev/null 2>&1 || true
mkdir -p "$fixture/docs" "$fixture/scripts" "$fixture/server"
printf '# gate\tstate\tsubject\tevidence\n' > "$fixture/docs/owned-patches.tsv"
cp "$repo_root/scripts/verify-patch-discipline.sh" "$fixture/scripts/verify-patch-discipline.sh"
printf 'upstream base\n' > "$fixture/server/app.txt"
git -C "$fixture" add docs scripts server
git -C "$fixture" commit --quiet -m "test: create fixture distribution baseline"
fixture_baseline="$(git -C "$fixture" rev-parse HEAD)"
git -C "$fixture" tag fixture-owned-baseline "$fixture_baseline"

run_case() {
  local name="$1"
  local variant="$2"
  local expected="$3"
  local case_dir="$work_dir/$name"
  local upstream_base second_parent observed_target subject output rc

  git clone --quiet "$fixture" "$case_dir"
  git -C "$case_dir" config user.name "HappyHerd Provenance Test"
  git -C "$case_dir" config user.email "happyherd-provenance@invalid.local"
  upstream_base="$(git -C "$case_dir" rev-parse origin/upstream-base)"

  if [[ "$variant" == "unrelated" ]]; then
    git -C "$case_dir" switch --orphan candidate-upstream >/dev/null 2>&1
    git -C "$case_dir" rm -rf . >/dev/null 2>&1 || true
  else
    git -C "$case_dir" switch -c candidate-upstream origin/upstream-base >/dev/null 2>&1
  fi

  printf 'upstream next\n' > "$case_dir/app.txt"
  git -C "$case_dir" add app.txt
  git -C "$case_dir" commit --quiet -m "test: advance fixture upstream"
  second_parent="$(git -C "$case_dir" rev-parse HEAD)"
  observed_target="$second_parent"
  if [[ "$variant" == "local-descendant" ]]; then
    observed_target="$upstream_base"
  fi
  git -C "$case_dir" remote add upstream "$fixture"
  git -C "$case_dir" update-ref refs/remotes/upstream/main "$observed_target"
  git -C "$case_dir" switch main >/dev/null 2>&1
  git -C "$case_dir" merge --no-ff --no-commit --allow-unrelated-histories \
    -s ours "$second_parent" >/dev/null 2>&1
  git -C "$case_dir" show "${second_parent}:app.txt" > "$case_dir/server/app.txt"

  if [[ "$variant" == "outside-prefix" ]]; then
    printf 'escaped prefix\n' > "$case_dir/outside-server.txt"
  fi

  subject="Merge commit '$second_parent'"
  if [[ "$variant" == "wrong-subject" ]]; then
    subject="Merge commit 'not-the-second-parent'"
  fi

  git -C "$case_dir" add server/app.txt
  if [[ "$variant" == "outside-prefix" ]]; then
    git -C "$case_dir" add outside-server.txt
  fi
  git -C "$case_dir" commit --quiet -m "$subject"

  rc=0
  output="$(
    HAPPYHERD_ALLOW_REHEARSAL_SYNC=1 \
    HAPPYHERD_REHEARSAL_BASELINE_TAG=fixture-owned-baseline \
    HAPPYHERD_REHEARSAL_BASELINE_SHA="$fixture_baseline" \
    HAPPYHERD_REHEARSAL_UPSTREAM_REF="$upstream_base" \
    HAPPYHERD_REHEARSAL_TRUSTED_UPSTREAM_REF=refs/remotes/upstream/main \
    HAPPYHERD_REHEARSAL_TRUSTED_UPSTREAM_URL="$fixture" \
    HAPPYHERD_REHEARSAL_EXPECTED_UPSTREAM_SHA="$observed_target" \
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
run_case unrelated unrelated "second parent does not descend from upstream"
run_case local-descendant local-descendant "second parent is not reachable from trusted upstream"
run_case outside-prefix outside-prefix "changed paths outside server/"
run_case wrong-subject wrong-subject "unmanifested merge"

echo "upstream-sync-provenance: ok (1 valid and 4 rejected fixtures)"
