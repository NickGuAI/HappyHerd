#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

expected_upstream="https://github.com/slopus/happy.git"
base_sha="971d608923f175d3d63af7c204e8c036206b3e99"
base_tag="happy-upstream-base-2026-08-02"
base_tree="6d164e9b8cbd254becf3e3a4d26179830d74d547"
materialization_sha="b88bb71822dcb2e3ad4183f2135f10c7b9cba238"

actual_upstream="$(git remote get-url upstream)"
if [[ "$actual_upstream" != "$expected_upstream" ]]; then
  echo "lineage: upstream URL mismatch: $actual_upstream" >&2
  exit 1
fi

actual_tag="$(git rev-parse "${base_tag}^{commit}")"
if [[ "$actual_tag" != "$base_sha" ]]; then
  echo "lineage: base tag moved: $actual_tag" >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$base_sha" HEAD; then
  echo "lineage: upstream base is not an ancestor of HEAD" >&2
  exit 1
fi

actual_base_tree="$(git rev-parse "${base_sha}^{tree}")"
actual_import_tree="$(git rev-parse "${materialization_sha}:server")"
if [[ "$actual_base_tree" != "$base_tree" || "$actual_import_tree" != "$base_tree" ]]; then
  echo "lineage: pristine imported tree does not match the recorded upstream tree" >&2
  exit 1
fi

if ! git cat-file -e "HEAD:server"; then
  echo "lineage: server/ subtree is missing" >&2
  exit 1
fi

echo "lineage: ok ($base_tag -> ${base_sha:0:12})"
