#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILDER="$ROOT/scripts/build-release-artifacts.sh"
WORKSPACE="$ROOT/server/pnpm-workspace.yaml"

fail() {
    printf 'release-daemon-contract: %s\n' "$*" >&2
    exit 1
}

grep -Fq 'injectWorkspacePackages: true' "$WORKSPACE" || \
    fail 'workspace packages are not injected for a lockfile-backed deployment'
grep -Fq -- '--filter happy --fail-if-no-match deploy' "$BUILDER" || \
    fail 'release builder does not create a pruned daemon deployment'
grep -Fq -- 'install --prod --frozen-lockfile --offline' "$BUILDER" || \
    fail 'daemon production dependencies are not installed from the frozen lockfile'
grep -Fq -- '--config.prefer-symlinked-executables=true' "$BUILDER" || \
    fail 'daemon executable shims are not configured to remain relocatable'
grep -Fq 'node_modules/.modules.yaml' "$BUILDER" || \
    fail 'build-host pnpm metadata is not excluded from the daemon archive'
# The contract intentionally matches a literal shell variable.
# shellcheck disable=SC2016
grep -Fq 'node "$STAGE/daemon/bin/happy.mjs" auth status' "$BUILDER" || \
    fail 'release builder has no clean-directory daemon smoke probe'

# The contract intentionally matches a literal shell variable.
# shellcheck disable=SC2016
if grep -Fq 'cp -a packages/happy-cli/dist "$STAGE/daemon/dist"' "$BUILDER"; then
    fail 'release builder still packages compiled files without runtime dependencies'
fi

printf 'Release daemon contract tests passed.\n'
