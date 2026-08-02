#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

manifest="docs/owned-patches.tsv"
baseline_tag="happyherd-owned-baseline-2026-08-02"
baseline_sha="7b1acd8554f4de8c56b085f3f564a6f92865985b"
upstream_tag="happy-upstream-base-2026-08-02"
conventional_subject_re='^(feat|fix|build|ops|docs|test|chore|refactor|perf|ci|revert)(\([[:alnum:]_.-]+\))?!?: .+'

fail() {
  echo "patch-discipline: $*" >&2
  exit 1
}

[[ -f "$manifest" ]] || fail "missing $manifest"

actual_baseline="$(git rev-parse "${baseline_tag}^{commit}" 2>/dev/null)" ||
  fail "missing owned baseline tag $baseline_tag"
[[ "$actual_baseline" == "$baseline_sha" ]] ||
  fail "owned baseline tag moved: $actual_baseline"

git merge-base --is-ancestor "$baseline_sha" HEAD ||
  fail "owned baseline is not an ancestor of HEAD"

upstream_tree="$(git rev-parse "${upstream_tag}^{tree}")"
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

while IFS=$'\t' read -r gate state subject evidence; do
  [[ -z "$gate" || "$gate" == \#* ]] && continue
  [[ -n "$state" && -n "$subject" && -n "$evidence" ]] ||
    fail "malformed manifest row for gate $gate"
  [[ "$state" == "accepted" || "$state" == "code-ready" ]] ||
    fail "unsupported state '$state' for '$subject'"
  [[ -z "${manifest_gate[$subject]:-}" ]] ||
    fail "duplicate manifest subject '$subject'"
  [[ -e "$evidence" ]] || fail "missing evidence path '$evidence' for '$subject'"
  manifest_gate[$subject]="$gate"
done < "$manifest"

mapfile -t series < <(
  git log --first-parent --reverse --format=$'%H\t%s' "${baseline_tag}..HEAD"
)
[[ "${#series[@]}" -gt 0 ]] || fail "owned patch series is empty"

declare -A resolved_subjects=()
for record in "${series[@]}"; do
  sha="${record%%$'\t'*}"
  subject="${record#*$'\t'}"
  gate="${manifest_gate[$subject]:-}"

  [[ -n "$gate" ]] || fail "unmanifested patch ${sha:0:12}: $subject"
  [[ -z "${resolved_subjects[$subject]:-}" ]] ||
    fail "manifest subject resolves to multiple commits: $subject"
  resolved_subjects[$subject]="$sha"

  case "$subject" in
    fixup\!*|squash\!*|WIP*|wip*) fail "temporary commit subject: $subject" ;;
  esac

  if [[ "$gate" != "UPSTREAM_SYNC" && ! "$subject" =~ $conventional_subject_re ]]; then
    fail "non-conventional owned patch subject: $subject"
  fi

  parent_count="$(( $(git rev-list --parents -n 1 "$sha" | wc -w) - 1 ))"
  if [[ "$parent_count" -gt 1 && "$gate" != "UPSTREAM_SYNC" ]]; then
    fail "owned patch is a merge outside UPSTREAM_SYNC: ${sha:0:12} $subject"
  fi

  if [[ "$parent_count" -eq 1 ]] && git diff-tree --quiet "${sha}^" "$sha"; then
    fail "empty owned patch: ${sha:0:12} $subject"
  fi
done

for subject in "${!manifest_gate[@]}"; do
  [[ -n "${resolved_subjects[$subject]:-}" ]] ||
    fail "manifest subject does not resolve to a first-parent commit: $subject"
done

echo "patch-discipline: ok (${#series[@]} owned patches; baseline ${baseline_sha:0:12}; tree ${upstream_tree:0:12})"
