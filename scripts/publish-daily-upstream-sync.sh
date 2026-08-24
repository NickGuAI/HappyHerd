#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
evidence_dir="${1:?usage: publish-daily-upstream-sync.sh EVIDENCE_DIR}"
repository="${GITHUB_REPOSITORY:?missing GITHUB_REPOSITORY}"
server_url="${GITHUB_SERVER_URL:-https://github.com}"
run_id="${GITHUB_RUN_ID:?missing GITHUB_RUN_ID}"
run_attempt="${GITHUB_RUN_ATTEMPT:-1}"
artifact_url="${HAPPYHERD_SYNC_ARTIFACT_URL:?missing HAPPYHERD_SYNC_ARTIFACT_URL}"
artifact_digest="${HAPPYHERD_SYNC_ARTIFACT_DIGEST:?missing HAPPYHERD_SYNC_ARTIFACT_DIGEST}"
origin_url="${HAPPYHERD_SYNC_ORIGIN_URL:-https://github.com/${repository}.git}"
sync_branch="automation/upstream-sync"
conflict_title="[upstream sync] Happy main conflict requires reconciliation"
bundle_ref="refs/happyherd/upstream-sync/result"

fail() {
  echo "daily-upstream-sync publish: $*" >&2
  exit 1
}

metadata_value() {
  local key="$1"
  awk -F '\t' -v key="$key" '$1 == key { print $2 }' "$evidence_dir/metadata.tsv"
}

find_conflict_issue() {
  gh issue list --repo "$repository" --state all --limit 100 \
    --search "\"$conflict_title\" in:title" \
    --json number,title,state \
    --jq ".[] | select(.title == \"$conflict_title\") | [.number, .state] | @tsv"
}

write_conflict_body() {
  local target="$1"
  local include_map="$2"

  {
    printf '## Daily upstream sync conflict\n\n'
    printf 'The read-only sync lane froze both inputs and found a real subtree conflict. '
    printf 'No sync branch was changed and no pull request was created for this outcome.\n\n'
    printf -- "- HappyHerd base: \`%s\`\n" "$base_sha"
    printf -- "- Happy upstream: \`%s\`\n" "$upstream_sha"
    printf -- '- Workflow run: [%s · attempt %s](%s/%s/actions/runs/%s)\n' \
      "$run_id" "$run_attempt" "$server_url" "$repository" "$run_id"
    printf -- '- Evidence artifact: [download](%s)\n' "$artifact_url"
    printf -- "- Artifact SHA-256: \`%s\`\n\n" "$artifact_digest"
    printf 'The artifact contains the byte-exact NUL-delimited Git status and stage records, '
    printf 'the human-readable map below, frozen metadata, merge log, and per-file hashes.\n'
    if [[ "$include_map" == "yes" ]]; then
      printf '\n### Complete conflict map\n\n```text\n'
      sed -n '1,$p' "$evidence_dir/conflict-map.tsv"
      printf '```\n'
    else
      printf '\nThe complete map is split across comments on this issue because it exceeds '
      printf 'the issue-body size limit.\n'
    fi
  } > "$target"
}

"$repo_root/scripts/verify-daily-upstream-sync-evidence.sh" "$evidence_dir"

[[ "$run_id" =~ ^[0-9]+$ && "$run_attempt" =~ ^[0-9]+$ ]] ||
  fail "workflow run identity is malformed"
[[ "$artifact_digest" =~ ^[0-9a-f]{64}$ ]] || fail "artifact digest is malformed"
expected_artifact_prefix="$server_url/$repository/actions/runs/$run_id/artifacts/"
[[ "$artifact_url" == "$expected_artifact_prefix"* ]] ||
  fail "artifact URL does not belong to this workflow run"

base_sha="$(metadata_value base_sha)"
upstream_sha="$(metadata_value upstream_sha)"
result_sha="$(metadata_value result_sha)"
outcome="$(metadata_value outcome)"

live_base="$(git ls-remote "$origin_url" refs/heads/main | awk 'NR == 1 { print $1 }')"
[[ "$live_base" =~ ^[0-9a-f]{40}$ ]] || fail "cannot resolve live main"
if [[ "$live_base" != "$base_sha" ]]; then
  echo "daily-upstream-sync publish: main advanced to $live_base; frozen run is stale"
  exit 0
fi

if [[ "$outcome" == "noop" ]]; then
  echo "daily-upstream-sync publish: noop ($upstream_sha already integrated)"
  exit 0
fi

work_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/happyherd-sync-publish.XXXXXX")"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

if [[ "$outcome" == "conflict" ]]; then
  map_bytes="$(wc -c < "$evidence_dir/conflict-map.tsv")"
  include_map=yes
  if [[ "$map_bytes" -gt 50000 ]]; then
    include_map=no
  fi
  write_conflict_body "$work_dir/issue-body.md" "$include_map"

  mapfile -t issue_records < <(find_conflict_issue)
  [[ "${#issue_records[@]}" -le 1 ]] || fail "multiple canonical conflict issues exist"
  if [[ "${#issue_records[@]}" -eq 0 ]]; then
    issue_url="$(gh issue create --repo "$repository" --title "$conflict_title" \
      --body-file "$work_dir/issue-body.md")"
    issue_number="${issue_url##*/}"
  else
    IFS=$'\t' read -r issue_number issue_state <<< "${issue_records[0]}"
    if [[ "$issue_state" == "CLOSED" ]]; then
      gh issue reopen "$issue_number" --repo "$repository"
    fi
    gh issue edit "$issue_number" --repo "$repository" \
      --title "$conflict_title" --body-file "$work_dir/issue-body.md"
  fi

  if [[ "$include_map" == "no" ]]; then
    split -C 50000 -d -a 4 "$evidence_dir/conflict-map.tsv" "$work_dir/map-part-"
    mapfile -t map_parts < <(find "$work_dir" -maxdepth 1 -type f -name 'map-part-*' | sort)
    part_count="${#map_parts[@]}"
    part_number=0
    for part in "${map_parts[@]}"; do
      part_number=$((part_number + 1))
      {
        printf '### Conflict map — run %s, part %s/%s\n\n```text\n' \
          "$run_id" "$part_number" "$part_count"
        sed -n '1,$p' "$part"
        printf '```\n'
      } > "$work_dir/comment.md"
      gh issue comment "$issue_number" --repo "$repository" \
        --body-file "$work_dir/comment.md"
    done
  fi

  echo "daily-upstream-sync publish: conflict issue #$issue_number updated; no PR created"
  exit 0
fi

mapfile -t pr_records < <(
  gh pr list --repo "$repository" --state open --head "$sync_branch" \
    --json number,baseRefName,url --jq '.[] | [.number, .baseRefName, .url] | @tsv'
)
[[ "${#pr_records[@]}" -le 1 ]] || fail "multiple open PRs use the fixed sync branch"
if [[ "${#pr_records[@]}" -eq 1 ]]; then
  IFS=$'\t' read -r pr_number pr_base pr_url <<< "${pr_records[0]}"
  [[ "$pr_base" == "main" ]] || fail "fixed sync branch has an open PR to $pr_base"
  echo "daily-upstream-sync publish: deferred; open sync PR #$pr_number to $pr_base remains unchanged at $pr_url"
  exit 0
fi

git -C "$repo_root" remote set-url origin "$origin_url"
gh auth setup-git

remote_branch_sha="$(
  git ls-remote "$origin_url" "refs/heads/$sync_branch" | awk 'NR == 1 { print $1 }'
)"
if [[ -n "$remote_branch_sha" && ! "$remote_branch_sha" =~ ^[0-9a-f]{40}$ ]]; then
  fail "cannot resolve existing sync branch"
fi

lease="--force-with-lease=refs/heads/$sync_branch:${remote_branch_sha}"
git -C "$repo_root" push origin \
  "$bundle_ref:refs/heads/$sync_branch" "$lease"

short_upstream="${upstream_sha:0:12}"
pr_title="chore: sync Happy upstream $short_upstream"
cat > "$work_dir/pr-body.md" <<EOF
## Automated upstream sync

This reviewed-sync candidate was assembled and validated without granting imported upstream code a repository write token.

- HappyHerd base: \`$base_sha\`
- Happy upstream: \`$upstream_sha\`
- Merge result: \`$result_sha\`
- Workflow run: [$run_id · attempt $run_attempt]($server_url/$repository/actions/runs/$run_id)
- Evidence artifact: [download]($artifact_url)
- Artifact SHA-256: \`$artifact_digest\`

The branch contains one non-squashed subtree merge with the frozen upstream commit as its second parent. It was installed and tested on a separate read-only runner before publication. This workflow never auto-merges.

### Required human action

GitHub places pull-request workflows created or synchronized by \`GITHUB_TOKEN\` into an approval-required state. A repository writer must select **Approve workflows to run**, then review the required checks and merge normally.
EOF

pr_url="$(gh pr create --repo "$repository" --base main --head "$sync_branch" \
  --title "$pr_title" --body-file "$work_dir/pr-body.md")"

echo "daily-upstream-sync publish: clean candidate published at $pr_url"
