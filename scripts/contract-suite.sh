#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server_root="$repo_root/server"
expected_pnpm="10.11.0"

fail() {
  echo "contract-suite: $*" >&2
  exit 1
}

[[ -z "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]] ||
  fail "worktree must be clean"
[[ "$(cd "$server_root" && pnpm --version)" == "$expected_pnpm" ]] ||
  fail "pnpm $expected_pnpm is required"

export APP_ENV=development
export CI=1
export EXPO_NO_TELEMETRY=1
# The host service exports NODE_ENV=production. Vitest normally supplies its
# own test environment, but preserves an already-exported value; React's
# production test renderer intentionally omits act(). Pin the contract suite to
# the test runtime so verification is independent of the caller's shell.
export NODE_ENV=test

"$repo_root/scripts/verify-lineage.sh"
"$repo_root/scripts/verify-patch-discipline.sh"
node "$repo_root/scripts/lint-source.mjs"
node "$repo_root/scripts/verify-product-identity.mjs"
"$repo_root/scripts/validate-runtime-isolation.sh" \
  "$repo_root/deploy/runtime.env.example" template
"$repo_root/scripts/test-runtime-isolation.sh"
"$repo_root/scripts/test-release-daemon-contract.sh"
"$repo_root/scripts/test-install-host-release.sh"
"$repo_root/scripts/test-release-image-contract.sh"
"$repo_root/scripts/test-release-rollback.sh"
"$repo_root/scripts/test-upstream-sync-provenance.sh"
"$repo_root/scripts/test-owned-merge-provenance.sh"
node "$repo_root/scripts/verify-a5-evidence.mjs" --self-test

shellcheck -x "$repo_root"/scripts/*.sh "$repo_root"/scripts/lib/*.sh

cd "$server_root"
pnpm --filter happy-app --fail-if-no-match typecheck
pnpm --filter happy-app --fail-if-no-match test --run
pnpm --filter @slopus/happy-wire --fail-if-no-match test
pnpm --filter happy-agent --fail-if-no-match test
pnpm --filter happy --fail-if-no-match test
pnpm --filter ./packages/happy-server --fail-if-no-match typecheck
pnpm --filter ./packages/happy-server --fail-if-no-match test

echo "contract-suite: ok"
