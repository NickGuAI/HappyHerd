#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

manifest="docs/owned-patches.tsv"
baseline="happyherd-owned-baseline-2026-08-02"

printf '%-14s %-12s %-12s %s\n' GATE STATE COMMIT SUBJECT
while IFS=$'\t' read -r gate state subject _; do
  [[ -z "$gate" || "$gate" == \#* ]] && continue

  mapfile -t matches < <(
    git log --format=$'%H\t%s' "${baseline}..HEAD" |
      awk -F '\t' -v wanted="$subject" '$2 == wanted { print $1 }'
  )

  if [[ "${#matches[@]}" -eq 1 ]]; then
    printf '%-14s %-12s %.12s     %s\n' "$gate" "$state" "${matches[0]}" "$subject"
  elif [[ "${#matches[@]}" -eq 0 ]]; then
    printf '%-14s %-12s %-12s %s\n' "$gate" "$state" MISSING "$subject"
  else
    printf '%-14s %-12s %-12s %s\n' "$gate" "$state" AMBIGUOUS "$subject"
  fi
done < "$manifest"
