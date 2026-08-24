#!/usr/bin/env bash
set -euo pipefail

export GIT_MERGE_AUTOEDIT=no

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="${1:?usage: prepare-daily-upstream-sync.sh OUTPUT_DIR}"
origin_url="${HAPPYHERD_SYNC_ORIGIN_URL:?missing HAPPYHERD_SYNC_ORIGIN_URL}"
upstream_url="${HAPPYHERD_SYNC_UPSTREAM_URL:-https://github.com/slopus/happy.git}"
base_ref="${HAPPYHERD_SYNC_BASE_REF:-refs/heads/main}"
upstream_ref="${HAPPYHERD_SYNC_UPSTREAM_REF:-refs/heads/main}"
expected_base="${HAPPYHERD_SYNC_EXPECTED_BASE:-}"
canonical_name="HappyHerd Maintainers"
canonical_email="maintainers@happyherd.example"

fail() {
  echo "daily-upstream-sync prepare: $*" >&2
  exit 1
}

is_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

remote_sha() {
  local repository="$1"
  local ref="$2"
  local listing sha extra

  listing="$(git ls-remote "$repository" "$ref")" ||
    fail "cannot resolve $repository $ref"
  sha="$(awk 'NR == 1 { print $1 }' <<< "$listing")"
  extra="$(awk 'NR > 1 { print $1 }' <<< "$listing")"
  is_sha "$sha" || fail "remote ref did not resolve to one commit: $repository $ref"
  [[ -z "$extra" ]] || fail "remote ref resolved ambiguously: $repository $ref"
  printf '%s\n' "$sha"
}

write_metadata() {
  local outcome="$1"
  local result_sha="$2"

  {
    printf 'format\t1\n'
    printf 'outcome\t%s\n' "$outcome"
    printf 'base_sha\t%s\n' "$base_sha"
    printf 'upstream_sha\t%s\n' "$upstream_sha"
    printf 'result_sha\t%s\n' "$result_sha"
  } > "$output_dir/metadata.tsv"
}

write_manifest() {
  local file
  local -a files=()

  while IFS= read -r -d '' file; do
    files+=("${file#./}")
  done < <(
    cd "$output_dir"
    find . -maxdepth 1 -type f ! -name MANIFEST.sha256 -print0 | sort -z
  )

  [[ "${#files[@]}" -gt 0 ]] || fail "evidence directory is empty"
  (
    cd "$output_dir"
    sha256sum -- "${files[@]}" > MANIFEST.sha256
  )
}

write_conflict_map() {
  local path status base_blob ours_blob theirs_blob stage_record stage blob
  local conflict_count=0

  git -C "$repo_root" status --porcelain=v1 -z --untracked-files=no \
    > "$output_dir/conflict-status.zlist"
  git -C "$repo_root" ls-files --unmerged -z > "$output_dir/conflict-stages.zlist"

  printf 'status\tpath\tbase_blob\tours_blob\ttheirs_blob\n' \
    > "$output_dir/conflict-map.tsv"

  while IFS= read -r -d '' path; do
    status="$(git -C "$repo_root" status --porcelain=v1 --untracked-files=no -- "$path" |
      awk 'NR == 1 { print substr($0, 1, 2) }')"
    base_blob="-"
    ours_blob="-"
    theirs_blob="-"

    while IFS= read -r stage_record; do
      [[ -n "$stage_record" ]] || continue
      blob="$(awk '{ print $2 }' <<< "$stage_record")"
      stage="$(awk '{ print $3 }' <<< "$stage_record")"
      case "$stage" in
        1) base_blob="$blob" ;;
        2) ours_blob="$blob" ;;
        3) theirs_blob="$blob" ;;
        *) fail "unexpected conflict stage $stage for $path" ;;
      esac
    done < <(git -C "$repo_root" ls-files --unmerged -- "$path" | cut -f1)

    printf '%s\t' "$status" >> "$output_dir/conflict-map.tsv"
    printf '%q\t%s\t%s\t%s\n' \
      "$path" "$base_blob" "$ours_blob" "$theirs_blob" \
      >> "$output_dir/conflict-map.tsv"
    conflict_count=$((conflict_count + 1))
  done < <(git -C "$repo_root" diff --name-only --diff-filter=U -z | sort -z)

  [[ "$conflict_count" -gt 0 ]] || fail "merge failed without unmerged paths"
}

[[ ! -e "$output_dir" ]] || fail "output directory already exists: $output_dir"
mkdir -p "$output_dir"

[[ -z "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]] ||
  fail "checkout must be clean before freezing refs"

base_sha="$(remote_sha "$origin_url" "$base_ref")"
upstream_sha="$(remote_sha "$upstream_url" "$upstream_ref")"

if [[ -n "$expected_base" && "$base_sha" != "$expected_base" ]]; then
  fail "workflow commit is stale: expected $expected_base, observed $base_sha"
fi

git -C "$repo_root" fetch --no-tags "$origin_url" "$base_sha"
git -C "$repo_root" checkout --detach --force "$base_sha"
git -C "$repo_root" fetch --no-tags "$upstream_url" "$upstream_sha"

git -C "$repo_root" config user.name "$canonical_name"
git -C "$repo_root" config user.email "$canonical_email"
git -C "$repo_root" config commit.gpgsign false
git -C "$repo_root" config core.hooksPath /dev/null

if git -C "$repo_root" merge-base --is-ancestor "$upstream_sha" "$base_sha"; then
  printf 'Upstream %s is already reachable from base %s.\n' \
    "$upstream_sha" "$base_sha" > "$output_dir/merge.log"
  write_metadata noop "$base_sha"
  write_manifest
  echo "daily-upstream-sync prepare: noop ($upstream_sha already integrated)"
  exit 0
fi

merge_rc=0
git -C "$repo_root" subtree merge --prefix=server "$upstream_sha" \
  -m "Merge commit '$upstream_sha'" > "$output_dir/merge.log" 2>&1 || merge_rc=$?

if [[ "$merge_rc" -ne 0 ]]; then
  write_conflict_map
  write_metadata conflict "-"
  write_manifest
  echo "daily-upstream-sync prepare: conflict ($base_sha <- $upstream_sha)"
  exit 0
fi

result_sha="$(git -C "$repo_root" rev-parse HEAD)"
read -r commit first_parent second_parent extra < <(
  git -C "$repo_root" rev-list --parents -n 1 "$result_sha"
)
[[ "$commit" == "$result_sha" && "$first_parent" == "$base_sha" &&
   "$second_parent" == "$upstream_sha" && -z "${extra:-}" ]] ||
  fail "result does not have the frozen base and upstream as its two parents"
result_subject="$(git -C "$repo_root" show -s --format=%s "$result_sha")"
result_author="$(git -C "$repo_root" show -s --format='%an <%ae>' "$result_sha")"
result_committer="$(git -C "$repo_root" show -s --format='%cn <%ce>' "$result_sha")"
[[ "$result_subject" == "Merge commit '$upstream_sha'" ]] ||
  fail "result subject is not canonical"
[[ "$result_author" == "$canonical_name <$canonical_email>" ]] ||
  fail "result author is not canonical"
[[ "$result_committer" == "$canonical_name <$canonical_email>" ]] ||
  fail "result committer is not canonical"

outside_server="$(
  git -C "$repo_root" diff-tree --no-commit-id --name-only -r "$base_sha" "$result_sha" |
    awk '!/^server\//'
)"
[[ -z "$outside_server" ]] ||
  fail "clean merge changed paths outside server/: $outside_server"

bundle_ref="refs/happyherd/upstream-sync/result"
git -C "$repo_root" update-ref "$bundle_ref" "$result_sha"
git -C "$repo_root" bundle create "$output_dir/result.bundle" \
  "$bundle_ref" "^$base_sha"
git -C "$repo_root" bundle verify "$output_dir/result.bundle" >/dev/null
git -C "$repo_root" update-ref -d "$bundle_ref"

write_metadata clean "$result_sha"
write_manifest
echo "daily-upstream-sync prepare: clean ($base_sha <- $upstream_sha -> $result_sha)"
