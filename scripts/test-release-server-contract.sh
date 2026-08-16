#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILDER="$ROOT/scripts/build-release-artifacts.sh"

fail() {
    printf 'release-server-contract: %s\n' "$*" >&2
    exit 1
}

grep -Fq -- 'pnpm --filter happy-server-self-host --fail-if-no-match build' "$BUILDER" || \
    fail 'release builder does not build the publishable self-host server'

for payload in bin dist prisma index.cjs package.json README.md; do
    grep -Fq "packages/happy-server-self-host/$payload" "$BUILDER" || \
        fail "release builder omits self-host server payload: $payload"
done

if grep -Fq 'packages/happy-server/dist' "$BUILDER"; then
    fail 'release builder still reads the private server package nonexistent dist directory'
fi

printf 'Release server contract tests passed.\n'
