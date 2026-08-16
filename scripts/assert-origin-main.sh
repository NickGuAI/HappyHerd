#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

die() {
    printf 'origin-main: %s\n' "$*" >&2
    exit 1
}

for command_name in awk git; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command not found: $command_name"
done

HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
REMOTE_SHA="$(git -C "$ROOT" ls-remote --exit-code origin refs/heads/main | awk 'NR == 1 { print $1 }')" || \
    die 'could not resolve origin/main'
[[ "$HEAD_SHA" =~ ^[0-9a-f]{40}$ && "$REMOTE_SHA" =~ ^[0-9a-f]{40}$ ]] || \
    die 'HEAD and origin/main must resolve to full Git commit SHAs'
[[ "$HEAD_SHA" == "$REMOTE_SHA" ]] || \
    die "origin/main ($REMOTE_SHA) does not match HEAD ($HEAD_SHA)"

printf '%s\n' "$HEAD_SHA"
