#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
evidence_dir="${1:?usage: verify-daily-upstream-sync-evidence.sh EVIDENCE_DIR [--materialize]}"
mode="${2:-}"
origin_url="${HAPPYHERD_SYNC_ORIGIN_URL:?missing HAPPYHERD_SYNC_ORIGIN_URL}"
upstream_url="${HAPPYHERD_SYNC_UPSTREAM_URL:-https://github.com/slopus/happy.git}"
expected_base="${HAPPYHERD_SYNC_EXPECTED_BASE:?missing HAPPYHERD_SYNC_EXPECTED_BASE}"
expected_upstream="${HAPPYHERD_SYNC_EXPECTED_UPSTREAM:?missing HAPPYHERD_SYNC_EXPECTED_UPSTREAM}"
expected_outcome="${HAPPYHERD_SYNC_EXPECTED_OUTCOME:?missing HAPPYHERD_SYNC_EXPECTED_OUTCOME}"
canonical_name="HappyHerd Maintainers"
canonical_email="maintainers@happyherd.example"
bundle_ref="refs/happyherd/upstream-sync/result"

fail() {
  echo "daily-upstream-sync verify: $*" >&2
  exit 1
}

is_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

metadata_value() {
  local key="$1"
  awk -F '\t' -v key="$key" '$1 == key { print $2 }' "$evidence_dir/metadata.tsv"
}

[[ -d "$evidence_dir" ]] || fail "missing evidence directory: $evidence_dir"
[[ -z "$mode" || "$mode" == "--materialize" ]] || fail "unknown mode: $mode"
is_sha "$expected_base" || fail "expected base is not a commit SHA"
is_sha "$expected_upstream" || fail "expected upstream is not a commit SHA"
[[ "$expected_outcome" == "noop" || "$expected_outcome" == "clean" ||
   "$expected_outcome" == "conflict" ]] || fail "unexpected expected outcome"

mapfile -t entries < <(find "$evidence_dir" -mindepth 1 -maxdepth 1 -printf '%f\t%y\n' | sort)
for entry in "${entries[@]}"; do
  [[ "${entry#*$'\t'}" == "f" ]] || fail "evidence contains a non-regular entry: $entry"
done

[[ -f "$evidence_dir/MANIFEST.sha256" ]] || fail "missing MANIFEST.sha256"
[[ -f "$evidence_dir/metadata.tsv" ]] || fail "missing metadata.tsv"

declare -A manifest_files=()
while IFS= read -r line; do
  [[ "$line" =~ ^[0-9a-f]{64}[[:space:]][[:space:]][A-Za-z0-9._-]+$ ]] ||
    fail "malformed manifest line"
  filename="${line:66}"
  [[ -z "${manifest_files[$filename]:-}" ]] || fail "duplicate manifest file: $filename"
  manifest_files[$filename]=1
done < "$evidence_dir/MANIFEST.sha256"

(
  cd "$evidence_dir"
  sha256sum --check --strict MANIFEST.sha256 >/dev/null
) || fail "evidence file hash mismatch"

metadata_lines="$(wc -l < "$evidence_dir/metadata.tsv")"
[[ "$metadata_lines" -eq 5 ]] || fail "metadata must contain exactly five records"
while IFS=$'\t' read -r key value extra; do
  [[ "$key" =~ ^(format|outcome|base_sha|upstream_sha|result_sha)$ ]] ||
    fail "unexpected metadata key: $key"
  [[ -n "$value" && -z "${extra:-}" ]] || fail "malformed metadata record: $key"
done < "$evidence_dir/metadata.tsv"

format="$(metadata_value format)"
outcome="$(metadata_value outcome)"
base_sha="$(metadata_value base_sha)"
upstream_sha="$(metadata_value upstream_sha)"
result_sha="$(metadata_value result_sha)"

[[ "$format" == "1" ]] || fail "unsupported evidence format: $format"
[[ "$outcome" == "$expected_outcome" ]] || fail "outcome differs from immutable job output"
[[ "$base_sha" == "$expected_base" ]] || fail "base differs from immutable job output"
[[ "$upstream_sha" == "$expected_upstream" ]] || fail "upstream differs from immutable job output"

declare -a expected_files=(MANIFEST.sha256 merge.log metadata.tsv)
case "$outcome" in
  noop)
    [[ "$result_sha" == "$base_sha" ]] || fail "noop result is not the frozen base"
    ;;
  clean)
    is_sha "$result_sha" || fail "clean result is not a commit SHA"
    expected_files+=(result.bundle)
    ;;
  conflict)
    [[ "$result_sha" == "-" ]] || fail "conflict result must be '-'"
    expected_files+=(conflict-map.tsv conflict-stages.zlist conflict-status.zlist)
    ;;
esac

for filename in "${expected_files[@]}"; do
  [[ -f "$evidence_dir/$filename" ]] || fail "missing evidence file: $filename"
  if [[ "$filename" != "MANIFEST.sha256" ]]; then
    [[ -n "${manifest_files[$filename]:-}" ]] || fail "unhashed evidence file: $filename"
  fi
done
[[ "${#entries[@]}" -eq "${#expected_files[@]}" ]] ||
  fail "evidence contains unexpected files"
[[ "${#manifest_files[@]}" -eq "$((${#expected_files[@]} - 1))" ]] ||
  fail "manifest file set does not match evidence file set"

[[ "$(git -C "$repo_root" rev-parse HEAD)" == "$base_sha" ]] ||
  fail "verification checkout is not the frozen base"
[[ -z "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]] ||
  fail "verification checkout is not clean"

git -C "$repo_root" fetch --no-tags "$origin_url" "$base_sha" >/dev/null
git -C "$repo_root" fetch --no-tags "$upstream_url" "$upstream_sha" >/dev/null
git -C "$repo_root" cat-file -e "${base_sha}^{commit}"
git -C "$repo_root" cat-file -e "${upstream_sha}^{commit}"

if [[ "$outcome" == "noop" ]]; then
  git -C "$repo_root" merge-base --is-ancestor "$upstream_sha" "$base_sha" ||
    fail "noop upstream is not reachable from the frozen base"
  echo "daily-upstream-sync verify: noop evidence is valid"
  exit 0
fi

if [[ "$outcome" == "conflict" ]]; then
  [[ -s "$evidence_dir/conflict-status.zlist" ]] || fail "conflict status evidence is empty"
  [[ -s "$evidence_dir/conflict-stages.zlist" ]] || fail "conflict stage evidence is empty"
  conflict_header="$(head -n 1 "$evidence_dir/conflict-map.tsv")"
  [[ "$conflict_header" == $'path\tconflict type\taffected function\tinvariant\tHappy behavior\tHappyHerd behavior\tselected/required decision' ]] ||
    fail "conflict map header is invalid"
  [[ "$(wc -l < "$evidence_dir/conflict-map.tsv")" -gt 1 ]] ||
    fail "conflict map contains no paths"
  awk -F '\t' '
    NR == 1 { next }
    NF != 7 { exit 1 }
    $1 == "" || $2 == "" || $3 == "" || $4 == "" ||
      $5 == "" || $6 == "" || $7 == "" { exit 1 }
    $3 !~ /^UNRESOLVED - / || $4 !~ /^UNRESOLVED - / ||
      $5 !~ /^UNRESOLVED - / || $6 !~ /^UNRESOLVED - / ||
      $7 !~ /^OPERATOR REQUIRED - / { exit 1 }
  ' "$evidence_dir/conflict-map.tsv" ||
    fail "conflict map does not satisfy the seven-field decision contract"
  echo "daily-upstream-sync verify: conflict evidence is valid"
  exit 0
fi

git -C "$repo_root" bundle verify "$evidence_dir/result.bundle" >/dev/null
mapfile -t bundle_heads < <(git -C "$repo_root" bundle list-heads "$evidence_dir/result.bundle")
[[ "${#bundle_heads[@]}" -eq 1 &&
   "${bundle_heads[0]}" == "$result_sha $bundle_ref" ]] ||
  fail "bundle does not advertise exactly the recorded result"

git -C "$repo_root" fetch "$evidence_dir/result.bundle" \
  "$bundle_ref:$bundle_ref" >/dev/null
git -C "$repo_root" fsck --strict --connectivity-only "$result_sha" >/dev/null

read -r commit first_parent second_parent extra < <(
  git -C "$repo_root" rev-list --parents -n 1 "$result_sha"
)
[[ "$commit" == "$result_sha" && "$first_parent" == "$base_sha" &&
   "$second_parent" == "$upstream_sha" && -z "${extra:-}" ]] ||
  fail "result does not have the frozen commits as its two parents"
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
[[ -z "$outside_server" ]] || fail "result changed paths outside server/: $outside_server"

if [[ "$mode" == "--materialize" ]]; then
  if git -C "$repo_root" remote get-url upstream >/dev/null 2>&1; then
    git -C "$repo_root" remote set-url upstream "$upstream_url"
  else
    git -C "$repo_root" remote add upstream "$upstream_url"
  fi
  git -C "$repo_root" update-ref refs/remotes/upstream/main "$upstream_sha"
  git -C "$repo_root" checkout --detach --force "$result_sha"
  [[ -z "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]] ||
    fail "materialized result is not clean"
fi

echo "daily-upstream-sync verify: clean evidence is valid ($result_sha)"
