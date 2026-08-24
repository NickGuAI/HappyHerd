#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workflow="$repo_root/.github/workflows/upstream-sync.yml"
publisher="$repo_root/scripts/publish-daily-upstream-sync.sh"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-daily-sync-test.XXXXXX")"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

fail() {
  echo "daily-upstream-sync contract: $*" >&2
  exit 1
}

metadata_value() {
  local directory="$1"
  local key="$2"
  awk -F '\t' -v key="$key" '$1 == key { print $2 }' "$directory/metadata.tsv"
}

assert_fixed() {
  local value="$1"
  grep -Fqx -- "$value" "$workflow" || fail "workflow is missing: $value"
}

[[ -f "$workflow" ]] || fail "workflow is missing"
assert_fixed 'name: Daily Happy upstream sync'
assert_fixed "    - cron: '17 9 * * *'"
assert_fixed '  workflow_dispatch:'
assert_fixed '  cancel-in-progress: false'
assert_fixed '      contents: read'
assert_fixed '      actions: read'
assert_fixed '      contents: write'
assert_fixed '      issues: write'
assert_fixed '      pull-requests: write'
assert_fixed '    name: Validate candidate without write credentials'
assert_fixed '    name: Publish verified result without executing imported code'

[[ "$(grep -Fc 'persist-credentials: false' "$workflow")" -eq 3 ]] ||
  fail "all three jobs must remove checkout credentials"
prepare_block="$(awk '/^  prepare:$/ { keep = 1 } /^  validate:$/ { keep = 0 } keep' "$workflow")"
validate_block="$(awk '/^  validate:$/ { keep = 1 } /^  publish:$/ { keep = 0 } keep' "$workflow")"
publish_block="$(awk '/^  publish:$/ { keep = 1 } keep' "$workflow")"
if grep -Eq 'contents:[[:space:]]+write|issues:[[:space:]]+write|pull-requests:[[:space:]]+write' \
  <<< "$prepare_block$validate_block"; then
  fail "prepare and validation jobs must not have a write token"
fi
if grep -Eq 'working-directory:[[:space:]]+server|pnpm|subtree|--materialize' \
  <<< "$publish_block"; then
  fail "publication job must not execute or materialize imported content"
fi
if grep -Eq 'gh[[:space:]]+pr[[:space:]]+merge|--auto([[:space:]]|$)' \
  "$workflow" "$publisher"; then
  fail "workflow must not auto-merge"
fi
grep -Fq 'sync_branch="automation/upstream-sync"' "$publisher" ||
  fail "publisher does not use the one fixed branch"
grep -Fq 'No sync branch was changed and no pull request was created' "$publisher" ||
  fail "conflict outcome does not state its no-PR contract"

upstream_repo="$work_dir/upstream"
distribution_repo="$work_dir/distribution"
origin_repo="$work_dir/origin.git"

git init --quiet "$upstream_repo"
git -C "$upstream_repo" config user.name "Upstream Fixture"
git -C "$upstream_repo" config user.email "upstream@invalid.local"
git -C "$upstream_repo" switch -c main >/dev/null
printf 'base\n' > "$upstream_repo/app.txt"
git -C "$upstream_repo" add app.txt
git -C "$upstream_repo" commit --quiet -m "test: upstream base"
upstream_base="$(git -C "$upstream_repo" rev-parse HEAD)"

git init --quiet "$distribution_repo"
git -C "$distribution_repo" config user.name "Distribution Fixture"
git -C "$distribution_repo" config user.email "distribution@invalid.local"
git -C "$distribution_repo" switch -c main >/dev/null
mkdir -p "$distribution_repo/scripts"
cp "$repo_root/scripts/prepare-daily-upstream-sync.sh" \
  "$repo_root/scripts/publish-daily-upstream-sync.sh" \
  "$repo_root/scripts/verify-daily-upstream-sync-evidence.sh" \
  "$distribution_repo/scripts/"
chmod +x "$distribution_repo"/scripts/*.sh
printf 'fixture\n' > "$distribution_repo/README.md"
git -C "$distribution_repo" add README.md scripts
git -C "$distribution_repo" commit --quiet -m "test: distribution shell"
git -C "$distribution_repo" subtree add --prefix=server "$upstream_repo" \
  "$upstream_base" -m "test: import upstream fixture" >/dev/null

git clone --quiet --bare "$distribution_repo" "$origin_repo"
git -C "$distribution_repo" remote add origin "$origin_repo"
base_sha="$(git -C "$distribution_repo" rev-parse HEAD)"

git clone --quiet "$origin_repo" "$work_dir/noop-checkout"
HAPPYHERD_SYNC_ORIGIN_URL="$origin_repo" \
HAPPYHERD_SYNC_UPSTREAM_URL="$upstream_repo" \
HAPPYHERD_SYNC_EXPECTED_BASE="$base_sha" \
  "$work_dir/noop-checkout/scripts/prepare-daily-upstream-sync.sh" \
  "$work_dir/noop-evidence" >/dev/null
[[ "$(metadata_value "$work_dir/noop-evidence" outcome)" == "noop" ]] ||
  fail "already-integrated upstream did not produce noop"
HAPPYHERD_SYNC_ORIGIN_URL="$origin_repo" \
HAPPYHERD_SYNC_UPSTREAM_URL="$upstream_repo" \
HAPPYHERD_SYNC_EXPECTED_BASE="$base_sha" \
HAPPYHERD_SYNC_EXPECTED_UPSTREAM="$upstream_base" \
HAPPYHERD_SYNC_EXPECTED_OUTCOME=noop \
  "$work_dir/noop-checkout/scripts/verify-daily-upstream-sync-evidence.sh" \
  "$work_dir/noop-evidence" >/dev/null

printf 'upstream change\n' > "$upstream_repo/app.txt"
git -C "$upstream_repo" add app.txt
git -C "$upstream_repo" commit --quiet -m "test: advance upstream"
upstream_next="$(git -C "$upstream_repo" rev-parse HEAD)"

git clone --quiet "$origin_repo" "$work_dir/clean-prepare"
HAPPYHERD_SYNC_ORIGIN_URL="$origin_repo" \
HAPPYHERD_SYNC_UPSTREAM_URL="$upstream_repo" \
HAPPYHERD_SYNC_EXPECTED_BASE="$base_sha" \
  "$work_dir/clean-prepare/scripts/prepare-daily-upstream-sync.sh" \
  "$work_dir/clean-evidence" >/dev/null
[[ "$(metadata_value "$work_dir/clean-evidence" outcome)" == "clean" ]] ||
  fail "non-conflicting upstream did not produce a clean bundle"

git clone --quiet "$origin_repo" "$work_dir/clean-verify"
HAPPYHERD_SYNC_ORIGIN_URL="$origin_repo" \
HAPPYHERD_SYNC_UPSTREAM_URL="$upstream_repo" \
HAPPYHERD_SYNC_EXPECTED_BASE="$base_sha" \
HAPPYHERD_SYNC_EXPECTED_UPSTREAM="$upstream_next" \
HAPPYHERD_SYNC_EXPECTED_OUTCOME=clean \
  "$work_dir/clean-verify/scripts/verify-daily-upstream-sync-evidence.sh" \
  "$work_dir/clean-evidence" --materialize >/dev/null

cp -a "$work_dir/clean-evidence" "$work_dir/tampered-evidence"
printf 'tampered\n' >> "$work_dir/tampered-evidence/merge.log"
git clone --quiet "$origin_repo" "$work_dir/tampered-verify"
tamper_rc=0
tamper_output="$(
  HAPPYHERD_SYNC_ORIGIN_URL="$origin_repo" \
  HAPPYHERD_SYNC_UPSTREAM_URL="$upstream_repo" \
  HAPPYHERD_SYNC_EXPECTED_BASE="$base_sha" \
  HAPPYHERD_SYNC_EXPECTED_UPSTREAM="$upstream_next" \
  HAPPYHERD_SYNC_EXPECTED_OUTCOME=clean \
    "$work_dir/tampered-verify/scripts/verify-daily-upstream-sync-evidence.sh" \
    "$work_dir/tampered-evidence" 2>&1
)" || tamper_rc=$?
if [[ "$tamper_rc" -eq 0 ]]; then
  fail "tampered evidence passed verification"
fi
[[ "$tamper_output" == *"evidence file hash mismatch"* ]] ||
  fail "tampered evidence failed for the wrong reason: $tamper_output"

mkdir -p "$work_dir/bin"
cat > "$work_dir/bin/gh" <<'GH_STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >> "${GH_LOG:?}"
printf '\n' >> "$GH_LOG"
command="${1:-} ${2:-}"
if [[ "$command" == "issue create" && -n "${GH_CAPTURE_ISSUE_BODY:-}" ]]; then
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == "--body-file" ]]; then
      cp "$2" "$GH_CAPTURE_ISSUE_BODY"
      break
    fi
    shift
  done
fi
case "$command" in
  "auth setup-git"|"issue list") exit 0 ;;
  "pr list")
    if [[ -n "${GH_OPEN_PR_RECORD:-}" ]]; then
      printf '%s\n' "$GH_OPEN_PR_RECORD"
    fi
    ;;
  "pr create") printf 'https://github.example/example/HappyHerd/pull/123\n' ;;
  "pr edit"|"issue edit"|"issue reopen"|"issue comment") exit 0 ;;
  "pr view") printf 'https://github.example/example/HappyHerd/pull/123\n' ;;
  "issue create") printf 'https://github.example/example/HappyHerd/issues/321\n' ;;
  *) printf 'unexpected gh command: %s %s\n' "${1:-}" "${2:-}" >&2; exit 1 ;;
esac
GH_STUB
chmod +x "$work_dir/bin/gh"

git clone --quiet "$origin_repo" "$work_dir/clean-publish"
clean_gh_log="$work_dir/clean-gh.log"
: > "$clean_gh_log"
PATH="$work_dir/bin:$PATH" \
GH_LOG="$clean_gh_log" \
GH_TOKEN=fixture-token \
GITHUB_REPOSITORY=example/HappyHerd \
GITHUB_SERVER_URL=https://github.example \
GITHUB_RUN_ID=123 \
GITHUB_RUN_ATTEMPT=1 \
HAPPYHERD_SYNC_ARTIFACT_URL=https://github.example/example/HappyHerd/actions/runs/123/artifacts/456 \
HAPPYHERD_SYNC_ARTIFACT_DIGEST=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
HAPPYHERD_SYNC_ORIGIN_URL="$origin_repo" \
HAPPYHERD_SYNC_UPSTREAM_URL="$upstream_repo" \
HAPPYHERD_SYNC_EXPECTED_BASE="$base_sha" \
HAPPYHERD_SYNC_EXPECTED_UPSTREAM="$upstream_next" \
HAPPYHERD_SYNC_EXPECTED_OUTCOME=clean \
  "$work_dir/clean-publish/scripts/publish-daily-upstream-sync.sh" \
  "$work_dir/clean-evidence" >/dev/null
published_sha="$(git --git-dir="$origin_repo" rev-parse refs/heads/automation/upstream-sync)"
[[ "$published_sha" == "$(metadata_value "$work_dir/clean-evidence" result_sha)" ]] ||
  fail "clean publisher did not update the fixed branch to the verified result"
grep -Fq 'pr create' "$clean_gh_log" || fail "clean publisher did not create one PR"
if grep -Fq 'issue create' "$clean_gh_log"; then
  fail "clean publisher created a conflict issue"
fi

git --git-dir="$origin_repo" update-ref \
  refs/heads/automation/upstream-sync "$base_sha"
deferred_branch_before="$(
  git --git-dir="$origin_repo" rev-parse refs/heads/automation/upstream-sync
)"
deferred_gh_log="$work_dir/deferred-gh.log"
: > "$deferred_gh_log"
deferred_output="$(
  PATH="$work_dir/bin:$PATH" \
  GH_LOG="$deferred_gh_log" \
  GH_OPEN_PR_RECORD=$'77\tmain\thttps://github.example/example/HappyHerd/pull/77' \
  GH_TOKEN=fixture-token \
  GITHUB_REPOSITORY=example/HappyHerd \
  GITHUB_SERVER_URL=https://github.example \
  GITHUB_RUN_ID=125 \
  GITHUB_RUN_ATTEMPT=1 \
  HAPPYHERD_SYNC_ARTIFACT_URL=https://github.example/example/HappyHerd/actions/runs/125/artifacts/458 \
  HAPPYHERD_SYNC_ARTIFACT_DIGEST=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
  HAPPYHERD_SYNC_ORIGIN_URL="$origin_repo" \
  HAPPYHERD_SYNC_UPSTREAM_URL="$upstream_repo" \
  HAPPYHERD_SYNC_EXPECTED_BASE="$base_sha" \
  HAPPYHERD_SYNC_EXPECTED_UPSTREAM="$upstream_next" \
  HAPPYHERD_SYNC_EXPECTED_OUTCOME=clean \
    "$work_dir/clean-publish/scripts/publish-daily-upstream-sync.sh" \
    "$work_dir/clean-evidence"
)"
deferred_branch_after="$(
  git --git-dir="$origin_repo" rev-parse refs/heads/automation/upstream-sync
)"
[[ "$deferred_branch_after" == "$deferred_branch_before" ]] ||
  fail "open-PR deferral rewrote the fixed sync branch"
[[ "$deferred_output" == *"deferred; open sync PR #77 to main remains unchanged"* ]] ||
  fail "open-PR outcome was not reported as deferred: $deferred_output"
grep -Fq 'pr list' "$deferred_gh_log" ||
  fail "publisher did not check for an open sync PR"
if grep -Eq 'auth setup-git|pr create|pr edit|pr view' "$deferred_gh_log"; then
  fail "open-PR deferral performed a publication write"
fi

wrong_base_gh_log="$work_dir/wrong-base-gh.log"
: > "$wrong_base_gh_log"
if PATH="$work_dir/bin:$PATH" \
  GH_LOG="$wrong_base_gh_log" \
  GH_OPEN_PR_RECORD=$'78\tdev\thttps://github.example/example/HappyHerd/pull/78' \
  GH_TOKEN=fixture-token \
  GITHUB_REPOSITORY=example/HappyHerd \
  GITHUB_SERVER_URL=https://github.example \
  GITHUB_RUN_ID=126 \
  GITHUB_RUN_ATTEMPT=1 \
  HAPPYHERD_SYNC_ARTIFACT_URL=https://github.example/example/HappyHerd/actions/runs/126/artifacts/459 \
  HAPPYHERD_SYNC_ARTIFACT_DIGEST=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  HAPPYHERD_SYNC_ORIGIN_URL="$origin_repo" \
  HAPPYHERD_SYNC_UPSTREAM_URL="$upstream_repo" \
  HAPPYHERD_SYNC_EXPECTED_BASE="$base_sha" \
  HAPPYHERD_SYNC_EXPECTED_UPSTREAM="$upstream_next" \
  HAPPYHERD_SYNC_EXPECTED_OUTCOME=clean \
    "$work_dir/clean-publish/scripts/publish-daily-upstream-sync.sh" \
    "$work_dir/clean-evidence" >/dev/null 2>&1; then
  fail "publisher accepted a fixed-branch pull request whose base is not main"
fi
if grep -Eq 'auth setup-git|pr create|pr edit|pr view' "$wrong_base_gh_log"; then
  fail "wrong-base rejection performed a publication write"
fi

printf 'owned change\n' > "$distribution_repo/server/app.txt"
git -C "$distribution_repo" add server/app.txt
git -C "$distribution_repo" commit --quiet -m "test: create owned conflict"
conflict_base="$(git -C "$distribution_repo" rev-parse HEAD)"
git -C "$distribution_repo" push --quiet origin main

git clone --quiet "$origin_repo" "$work_dir/conflict-prepare"
HAPPYHERD_SYNC_ORIGIN_URL="$origin_repo" \
HAPPYHERD_SYNC_UPSTREAM_URL="$upstream_repo" \
HAPPYHERD_SYNC_EXPECTED_BASE="$conflict_base" \
  "$work_dir/conflict-prepare/scripts/prepare-daily-upstream-sync.sh" \
  "$work_dir/conflict-evidence" >/dev/null
[[ "$(metadata_value "$work_dir/conflict-evidence" outcome)" == "conflict" ]] ||
  fail "divergent upstream did not produce conflict evidence"
expected_conflict_header=$'path\tconflict type\taffected function\tinvariant\tHappy behavior\tHappyHerd behavior\tselected/required decision'
[[ "$(head -n 1 "$work_dir/conflict-evidence/conflict-map.tsv")" == \
   "$expected_conflict_header" ]] ||
  fail "generated conflict report is missing the complete decision schema"
awk -F '\t' '
  NR == 1 { next }
  NF != 7 { exit 1 }
  $1 == "" || $2 == "" || $3 == "" || $4 == "" ||
    $5 == "" || $6 == "" || $7 == "" { exit 1 }
  $3 !~ /^UNRESOLVED - / || $4 !~ /^UNRESOLVED - / ||
    $5 !~ /^UNRESOLVED - / || $6 !~ /^UNRESOLVED - / ||
    $7 !~ /^OPERATOR REQUIRED - / { exit 1 }
' "$work_dir/conflict-evidence/conflict-map.tsv" ||
  fail "generated conflict report contains an incomplete decision row"

git clone --quiet "$origin_repo" "$work_dir/conflict-verify"
HAPPYHERD_SYNC_ORIGIN_URL="$origin_repo" \
HAPPYHERD_SYNC_UPSTREAM_URL="$upstream_repo" \
HAPPYHERD_SYNC_EXPECTED_BASE="$conflict_base" \
HAPPYHERD_SYNC_EXPECTED_UPSTREAM="$upstream_next" \
HAPPYHERD_SYNC_EXPECTED_OUTCOME=conflict \
  "$work_dir/conflict-verify/scripts/verify-daily-upstream-sync-evidence.sh" \
  "$work_dir/conflict-evidence" >/dev/null

git clone --quiet "$origin_repo" "$work_dir/conflict-publish"
conflict_gh_log="$work_dir/conflict-gh.log"
published_conflict_body="$work_dir/published-conflict-body.md"
: > "$conflict_gh_log"
branch_before_conflict="$(git --git-dir="$origin_repo" rev-parse refs/heads/automation/upstream-sync)"
PATH="$work_dir/bin:$PATH" \
GH_LOG="$conflict_gh_log" \
GH_CAPTURE_ISSUE_BODY="$published_conflict_body" \
GH_TOKEN=fixture-token \
GITHUB_REPOSITORY=example/HappyHerd \
GITHUB_SERVER_URL=https://github.example \
GITHUB_RUN_ID=124 \
GITHUB_RUN_ATTEMPT=1 \
HAPPYHERD_SYNC_ARTIFACT_URL=https://github.example/example/HappyHerd/actions/runs/124/artifacts/457 \
HAPPYHERD_SYNC_ARTIFACT_DIGEST=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
HAPPYHERD_SYNC_ORIGIN_URL="$origin_repo" \
HAPPYHERD_SYNC_UPSTREAM_URL="$upstream_repo" \
HAPPYHERD_SYNC_EXPECTED_BASE="$conflict_base" \
HAPPYHERD_SYNC_EXPECTED_UPSTREAM="$upstream_next" \
HAPPYHERD_SYNC_EXPECTED_OUTCOME=conflict \
  "$work_dir/conflict-publish/scripts/publish-daily-upstream-sync.sh" \
  "$work_dir/conflict-evidence" >/dev/null
branch_after_conflict="$(git --git-dir="$origin_repo" rev-parse refs/heads/automation/upstream-sync)"
[[ "$branch_after_conflict" == "$branch_before_conflict" ]] ||
  fail "conflict publisher changed the sync branch"
grep -Fq 'issue create' "$conflict_gh_log" ||
  fail "conflict publisher did not create the canonical issue"
[[ -f "$published_conflict_body" ]] ||
  fail "conflict publisher did not send a report body"
grep -Fq "$expected_conflict_header" "$published_conflict_body" ||
  fail "published conflict report omitted the complete decision schema"
grep -Fq 'OPERATOR REQUIRED - ' "$published_conflict_body" ||
  fail "published conflict report omitted the required operator decision"
if grep -Fq 'pr create' "$conflict_gh_log"; then
  fail "conflict publisher created a fake PR"
fi

echo "daily-upstream-sync contract: ok (noop, clean PR, open-PR deferral, tamper rejection, full conflict issue)"
