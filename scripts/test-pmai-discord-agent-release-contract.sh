#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILDER="$ROOT/scripts/build-release-artifacts.sh"
INSTALLER="$ROOT/scripts/install-host-release.sh"

fail() {
    printf 'pmai-discord-release-contract: %s\n' "$*" >&2
    exit 1
}

grep -Fq -- 'pnpm --filter @happyherd/pmai-discord-agent --fail-if-no-match build' "$BUILDER" || \
    fail 'release builder does not build the PMAI Discord Agent'
grep -Fq -- '--filter @happyherd/pmai-discord-agent --fail-if-no-match deploy' "$BUILDER" || \
    fail 'release builder does not create a locked bridge deployment'
# The contract intentionally matches the literal shell variable in the builder.
# shellcheck disable=SC2016
grep -Fq 'happyherd-pmai-discord-agent-${platform}.tar.gz' "$BUILDER" || \
    fail 'release builder does not archive the bridge by platform'
grep -Fq 'pmai-discord-agent/dist/index.mjs' "$INSTALLER" || \
    fail 'host installer does not verify the bridge entrypoint'
grep -Fq 'daemon/bin/rg' "$INSTALLER" || \
    fail 'host installer does not verify the bundled sandbox ripgrep'
grep -Fq 'PMAI_DISCORD_TOKEN_ROTATION_RECEIPT_FILE=' "$ROOT/deploy/pmai-discord-agent.env.example" || \
    fail 'production profile has no token-rotation gate'
grep -Fq 'ExecStartPre=+' "$ROOT/deploy/pmai-discord-agent.service" || \
    fail 'bridge unit does not run root-owned runtime validation before privilege drop'
grep -Fq 'HAPPYHERD_RELEASE_SHA' "$ROOT/scripts/start-host-daemon.sh" || \
    fail 'daemon handoff is not bound to the immutable release commit'
grep -Fq 'startedWithCliVersion.endsWith' "$ROOT/scripts/validate-pmai-discord-agent-runtime.sh" || \
    fail 'runtime validator does not verify daemon release identity'
grep -Fq 'pmai-broker.localhost' "$ROOT/scripts/test-pmai-discord-agent-sandbox.sh" || \
    fail 'release has no sandbox-to-loopback broker canary'
grep -Fq 'provision-pmai-happy-account.sh' "$ROOT/docs/runtime-isolation.md" || \
    fail 'release does not document dedicated HappyHerd account provisioning'
grep -Fq 'codex --version' "$ROOT/scripts/validate-pmai-discord-agent-runtime.sh" || \
    fail 'runtime validator does not preflight the dedicated Codex executable'
grep -Fq 'node scripts/unpack-tools.cjs' "$ROOT/scripts/build-release-artifacts.sh" || \
    fail 'release builder does not unpack the bundled sandbox tools'
grep -Fq 'daemon/bin/rg' "$ROOT/scripts/build-release-artifacts.sh" || \
    fail 'release builder does not expose bundled ripgrep on the daemon PATH'
grep -Fq 'rg --version' "$ROOT/scripts/validate-pmai-discord-agent-runtime.sh" || \
    fail 'runtime validator does not execute bundled ripgrep as the agent user'
grep -Fq '/list' "$ROOT/scripts/validate-pmai-discord-agent-runtime.sh" || \
    fail 'runtime validator does not probe the detached daemon control endpoint'

printf 'PMAI Discord Agent release contract tests passed.\n'
