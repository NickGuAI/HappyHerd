#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

manifest="docs/owned-patches.tsv"
production_baseline_tag="happyherd-owned-baseline-2026-08-02"
production_baseline_sha="7b1acd8554f4de8c56b085f3f564a6f92865985b"
production_upstream_ref="happy-upstream-base-2026-08-02"
production_trusted_upstream_ref="refs/remotes/upstream/main"
production_trusted_upstream_url="https://github.com/slopus/happy.git"
conventional_subject_re='^(feat|fix|build|ops|docs|test|chore|refactor|perf|ci|revert)(\([[:alnum:]_.-]+\))?!?: .+'

fail() {
  echo "patch-discipline: $*" >&2
  exit 1
}

[[ -f "$manifest" ]] || fail "missing $manifest"

if [[ "${HAPPYHERD_ALLOW_REHEARSAL_SYNC:-0}" == "1" ]]; then
  baseline_tag="${HAPPYHERD_REHEARSAL_BASELINE_TAG:?missing rehearsal baseline tag}"
  baseline_sha="${HAPPYHERD_REHEARSAL_BASELINE_SHA:?missing rehearsal baseline SHA}"
  upstream_ref="${HAPPYHERD_REHEARSAL_UPSTREAM_REF:?missing rehearsal upstream ref}"
  trusted_upstream_ref="${HAPPYHERD_REHEARSAL_TRUSTED_UPSTREAM_REF:-$production_trusted_upstream_ref}"
  trusted_upstream_url="${HAPPYHERD_REHEARSAL_TRUSTED_UPSTREAM_URL:-$production_trusted_upstream_url}"
  expected_upstream_sha="${HAPPYHERD_REHEARSAL_EXPECTED_UPSTREAM_SHA:-}"
else
  baseline_tag="$production_baseline_tag"
  baseline_sha="$production_baseline_sha"
  upstream_ref="$production_upstream_ref"
  trusted_upstream_ref="$production_trusted_upstream_ref"
  trusted_upstream_url="$production_trusted_upstream_url"
  expected_upstream_sha=""
fi

actual_baseline="$(git rev-parse "${baseline_tag}^{commit}" 2>/dev/null)" ||
  fail "missing owned baseline tag $baseline_tag"
[[ "$actual_baseline" == "$baseline_sha" ]] ||
  fail "owned baseline tag moved: $actual_baseline"

git merge-base --is-ancestor "$baseline_sha" HEAD ||
  fail "owned baseline is not an ancestor of HEAD"

upstream_tree="$(git rev-parse "${upstream_ref}^{tree}")"
owned_server_tree="$(git rev-parse "${baseline_tag}:server")"
[[ "$upstream_tree" == "$owned_server_tree" ]] ||
  fail "owned baseline server tree differs from the recorded upstream tree"

if git cat-file -e "${baseline_tag}:server/packages/happy-cli/src/daemon/detectModels.ts" 2>/dev/null; then
  fail "dirty-reference model detector exists in the owned baseline"
fi

if [[ "${HAPPYHERD_ALLOW_DIRTY:-0}" != "1" ]] &&
   [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  fail "worktree is not clean"
fi

declare -A manifest_gate=()
a5_accepted_count=0

while IFS=$'\t' read -r gate state subject evidence; do
  [[ -z "$gate" || "$gate" == \#* ]] && continue
  [[ -n "$state" && -n "$subject" && -n "$evidence" ]] ||
    fail "malformed manifest row for gate $gate"
  [[ "$state" == "accepted" || "$state" == "code-ready" ]] ||
    fail "unsupported state '$state' for '$subject'"
  [[ -z "${manifest_gate[$subject]:-}" ]] ||
    fail "duplicate manifest subject '$subject'"
  [[ -e "$evidence" ]] || fail "missing evidence path '$evidence' for '$subject'"
  if [[ "$gate" == "A5" && "$state" == "accepted" ]]; then
    [[ "$evidence" == docs/acceptance/a5-*.json ]] ||
      fail "accepted A5 row must reference a dated structured evidence file"
    evidence_args=("$evidence")
    if [[ "${HAPPYHERD_ALLOW_REHEARSAL_SYNC:-0}" == "1" ]]; then
      evidence_args+=(--rehearsal)
    fi
    node "$repo_root/scripts/verify-a5-evidence.mjs" "${evidence_args[@]}"
    a5_accepted_count=$((a5_accepted_count + 1))
  fi
  manifest_gate[$subject]="$gate"
done < "$manifest"

[[ "$a5_accepted_count" -le 1 ]] || fail "A5 has multiple acceptance records"

mapfile -t series < <(
  git log --first-parent --reverse --format=$'%H\t%s' "${baseline_tag}..HEAD"
)
[[ "${#series[@]}" -gt 0 ]] || fail "owned patch series is empty"

declare -A resolved_subjects=()
owned_patch_count=0

resolve_owned_commit() {
  local sha="$1"
  local subject="$2"
  local gate="${manifest_gate[$subject]:-}"
  local parent_record parent_count

  [[ -n "$gate" ]] || fail "unmanifested patch ${sha:0:12}: $subject"
  [[ -z "${resolved_subjects[$subject]:-}" ]] ||
    fail "manifest subject resolves to multiple commits: $subject"

  case "$subject" in
    fixup\!*|squash\!*|WIP*|wip*) fail "temporary commit subject: $subject" ;;
  esac
  [[ "$subject" =~ $conventional_subject_re ]] ||
    fail "non-conventional owned patch subject: $subject"

  parent_record="$(git rev-list --parents -n 1 "$sha")"
  parent_count="$(( $(wc -w <<< "$parent_record") - 1 ))"
  [[ "$parent_count" -eq 1 ]] ||
    fail "owned PR branch contains a merge-valued patch: ${sha:0:12} $subject"
  git diff-tree --quiet "${sha}^" "$sha" &&
    fail "empty owned patch: ${sha:0:12} $subject"

  resolved_subjects[$subject]="$sha"
  owned_patch_count=$((owned_patch_count + 1))
}

validate_upstream_merge() {
  local sha="$1"
  local subject="$2"
  local first_parent="$3"
  local second_parent="$4"
  local actual_upstream_url outside_server

  [[ "$subject" == "Merge commit '$second_parent'" ]] ||
    fail "unmanifested merge ${sha:0:12}: $subject"
  git merge-base --is-ancestor "${upstream_ref}^{commit}" "$second_parent" ||
    fail "UPSTREAM_SYNC second parent does not descend from upstream"
  actual_upstream_url="$(git remote get-url upstream 2>/dev/null)" ||
    fail "UPSTREAM_SYNC requires the trusted upstream remote"
  [[ "$actual_upstream_url" == "$trusted_upstream_url" ]] ||
    fail "UPSTREAM_SYNC remote is not the trusted public upstream: $actual_upstream_url"
  git rev-parse --verify "${trusted_upstream_ref}^{commit}" >/dev/null 2>&1 ||
    fail "UPSTREAM_SYNC trusted upstream ref is missing: $trusted_upstream_ref"
  git merge-base --is-ancestor "$second_parent" "${trusted_upstream_ref}^{commit}" ||
    fail "UPSTREAM_SYNC second parent is not reachable from trusted upstream"
  if [[ -n "$expected_upstream_sha" ]]; then
    [[ "$second_parent" == "$expected_upstream_sha" ]] ||
      fail "UPSTREAM_SYNC second parent does not match observed upstream target"
  fi
  outside_server="$(git diff --name-only "$first_parent" "$sha" | awk '!/^server\//')"
  [[ -z "$outside_server" ]] ||
    fail "UPSTREAM_SYNC changed paths outside server/: $outside_server"
}

for record in "${series[@]}"; do
  sha="${record%%$'\t'*}"
  subject="${record#*$'\t'}"
  parent_record="$(git rev-list --parents -n 1 "$sha")"
  parent_count="$(( $(wc -w <<< "$parent_record") - 1 ))"

  if [[ "$parent_count" -eq 1 ]]; then
    resolve_owned_commit "$sha" "$subject"
    continue
  fi

  [[ "$parent_count" -eq 2 ]] ||
    fail "merge commit must have exactly two parents: ${sha:0:12}"
  read -r _ first_parent second_parent <<< "$parent_record"

  # GitHub PR merges are structural only: every commit unique to the PR branch
  # must already be a manifest-backed, conventional, single-parent patch, and
  # the merge tree must equal Git's clean synthetic merge tree. This allows the
  # public repository to use protected-branch PR merges without creating an
  # unaudited patch or forcing history rewrites after merge.
  if [[ "$subject" =~ ^Merge\ pull\ request\ \#[0-9]+\ from\ NickGuAI/[^[:space:]]+$ ]]; then
    [[ -z "${manifest_gate[$subject]:-}" ]] ||
      fail "structural owned PR merge must not be a manifest patch: $subject"
    expected_tree="$(git merge-tree --write-tree "$first_parent" "$second_parent" 2>/dev/null)" ||
      fail "owned PR merge is not a clean synthetic merge: ${sha:0:12}"
    [[ "$expected_tree" == "$(git rev-parse "${sha}^{tree}")" ]] ||
      fail "owned PR merge tree contains changes outside its branch patches: ${sha:0:12}"
    mapfile -t branch_commits < <(git rev-list --first-parent --reverse "$first_parent..$second_parent")
    [[ "${#branch_commits[@]}" -gt 0 ]] ||
      fail "owned PR merge has no branch patches: ${sha:0:12}"
    for branch_sha in "${branch_commits[@]}"; do
      branch_subject="$(git show -s --format=%s "$branch_sha")"
      branch_parent_record="$(git rev-list --parents -n 1 "$branch_sha")"
      branch_parent_count="$(( $(wc -w <<< "$branch_parent_record") - 1 ))"
      if [[ "$branch_parent_count" -eq 1 ]]; then
        resolve_owned_commit "$branch_sha" "$branch_subject"
        continue
      fi
      [[ "$branch_parent_count" -eq 2 ]] ||
        fail "owned PR branch merge must have exactly two parents: ${branch_sha:0:12}"
      read -r _ branch_first_parent branch_second_parent <<< "$branch_parent_record"
      validate_upstream_merge \
        "$branch_sha" "$branch_subject" "$branch_first_parent" "$branch_second_parent"
    done
    continue
  fi

  validate_upstream_merge "$sha" "$subject" "$first_parent" "$second_parent"
done

for subject in "${!manifest_gate[@]}"; do
  [[ -n "${resolved_subjects[$subject]:-}" ]] ||
    fail "manifest subject does not resolve to an owned commit: $subject"
done

echo "patch-discipline: ok ($owned_patch_count owned patches; baseline ${baseline_sha:0:12}; tree ${upstream_tree:0:12})"
