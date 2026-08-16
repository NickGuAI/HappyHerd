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
grep -Fq -- 'fetch --prod --frozen-lockfile --ignore-scripts' "$BUILDER" || \
    fail 'daemon production closure is not prefetched from its generated frozen lockfile'
grep -Fq -- 'install --prod --frozen-lockfile --offline' "$BUILDER" || \
    fail 'daemon production dependencies are not installed from the frozen lockfile'
awk '
    /fetch --prod --frozen-lockfile --ignore-scripts/ { fetch_line = NR }
    /install --prod --frozen-lockfile --offline/ { install_line = NR }
    END { exit !(fetch_line && install_line && fetch_line < install_line) }
' "$BUILDER" || fail 'daemon dependency closure is not prefetched before offline materialization'
grep -Fq -- '--config.prefer-symlinked-executables=true' "$BUILDER" || \
    fail 'daemon executable shims are not configured to remain relocatable'
[[ "$(grep -Fc -- '--config.prefer-symlinked-executables=true' "$BUILDER")" -ge 2 ]] || \
    fail 'both daemon prefetch and offline materialization must request relocatable executable shims'
grep -Fq 'node_modules/.modules.yaml' "$BUILDER" || \
    fail 'build-host pnpm metadata is not excluded from the daemon archive'
# The contract intentionally matches literal shell variables.
# shellcheck disable=SC2016
grep -Fq 'OUT_DIR="$ROOT/$OUT_DIR"' "$BUILDER" || \
    fail 'relative artifact output is not anchored before the builder changes directories'
# The contract intentionally matches a literal shell variable.
# shellcheck disable=SC2016
grep -Fq 'node "$STAGE/daemon/bin/happy.mjs" auth status' "$BUILDER" || \
    fail 'release builder has no clean-directory daemon smoke probe'
grep -Fq 'happyherd-release.json' "$BUILDER" || \
    fail 'daemon artifact does not embed its immutable HappyHerd source identity'
grep -Fq 'assert-origin-main.sh' "$BUILDER" || \
    fail 'release builder does not require HEAD to equal live origin/main'
grep -Fq 'originMainSha' "$BUILDER" || \
    fail 'release manifest does not carry verified origin/main provenance'

# The contract intentionally matches a literal shell variable.
# shellcheck disable=SC2016
if grep -Fq 'cp -a packages/happy-cli/dist "$STAGE/daemon/dist"' "$BUILDER"; then
    fail 'release builder still packages compiled files without runtime dependencies'
fi

printf 'Release daemon contract tests passed.\n'
