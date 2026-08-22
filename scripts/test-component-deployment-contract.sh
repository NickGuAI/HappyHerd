#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
    printf 'component-deployment-contract: %s\n' "$*" >&2
    exit 1
}

required=(
    scripts/build-server-image.sh
    scripts/deploy-server.sh
    scripts/install-server-service.sh
    scripts/install-host-cli.sh
    scripts/install-linux-daemon-bootstrap.sh
    scripts/install-agent-runtime.sh
)
for relative in "${required[@]}"; do
    [[ -x "$ROOT/$relative" ]] || fail "$relative is missing or not executable"
done

[[ -f "$ROOT/.github/workflows/server-image.yml" ]] || \
    fail '.github/workflows/server-image.yml is missing'

obsolete=(
    scripts/build-release-artifacts.sh
    scripts/build-release-image.sh
    scripts/assert-origin-main.sh
    scripts/verify-reproducible-build.sh
    scripts/verify-release-manifest.mjs
    scripts/install-host-release.sh
    scripts/activate-release.sh
    scripts/rollback-release.sh
    scripts/smoke-release-image.sh
)
for relative in "${obsolete[@]}"; do
    [[ ! -e "$ROOT/$relative" ]] || fail "obsolete lockstep release file remains: $relative"
done

grep -Fq '/usr/local/lib/happyherd/run-container.sh' "$ROOT/deploy/happyherd.service" || \
    fail 'server unit does not use the stable server support path'
grep -Fq '/usr/local/lib/happyherd/start-host-daemon.sh' "$ROOT/deploy/happyherd-daemon.cron" || \
    fail 'Linux daemon bootstrap does not use its stable path'
grep -Fq 'HAPPYHERD_DAEMON_CLI=/usr/local/bin/happy' "$ROOT/deploy/happyherd-daemon.env.example" || \
    fail 'daemon does not select the independently installed Happy CLI'
grep -Fq "runuser -u \"\$BUILD_USER\"" "$ROOT/scripts/install-host-cli.sh" || \
    fail 'root CLI installation can contaminate the checkout with root-owned build output'
grep -Fq "runuser -u \"\$BUILD_USER\"" "$ROOT/scripts/install-agent-runtime.sh" || \
    fail 'root agent installation can contaminate the checkout with root-owned build output'
grep -Fq '/usr/local/lib/happyherd-agent/dist/index.mjs' "$ROOT/deploy/happyherd-agent.service" || \
    fail 'governed agent does not use its independent stable package path'
grep -Fq "docker pull \"\$IMAGE\"" "$ROOT/scripts/deploy-server.sh" || \
    fail 'server deploy does not pull an operator-selected image'
grep -Fq "systemctl restart \"\$SERVICE\"" "$ROOT/scripts/deploy-server.sh" || \
    fail 'server deploy does not restart the central systemd service'
grep -Fq 'Manual rollback: rerun this command with a previously published tag.' "$ROOT/scripts/deploy-server.sh" || \
    fail 'server deploy does not document explicit manual rollback'

if rg -n '/opt/happyherd/(current|releases)|HAPPYHERD_RELEASE_SHA|releaseSha' \
    "$ROOT/deploy" "$ROOT/docs" "$ROOT/scripts" "$ROOT/server/Dockerfile" \
    --glob '!test-component-deployment-contract.sh' \
    --glob '!deployment-guardrail-audit.md' \
    --glob '!public-launcher-release.md' \
    --glob '!happyherd-agent-runtime/**' >/dev/null; then
    fail 'lockstep release identity remains in deployment sources'
fi

if rg -n 'build-release-artifacts|verify-reproducible-build|verify-release-manifest|automatic rollback|digest-only' \
    "$ROOT/.dev" "$ROOT/docs" "$ROOT/scripts" \
    --glob '!test-component-deployment-contract.sh' \
    --glob '!deployment-guardrail-audit.md' \
    --glob '!public-launcher-release.md' >/dev/null; then
    fail 'lockstep release instructions remain'
fi

if rg -n -- '--read-only|no-new-privileges|--cap-drop|noexec,nosuid|unknown runtime config key' \
    "$ROOT/scripts/run-container.sh" "$ROOT/scripts/lib/runtime-config.sh" >/dev/null; then
    fail 'unapproved server runtime guard remains'
fi

if rg -n '^FROM .*@sha256:' "$ROOT/server/Dockerfile" >/dev/null; then
    fail 'server build still requires immutable base-image digests'
fi

grep -Fq 'deployment-guardrail-audit.md' "$ROOT/docs/deployment.md" || \
    fail 'human-reviewed deployment guardrail inventory is not linked'
grep -Fq 'without explicit human approval recorded' "$ROOT/AGENTS.md" || \
    fail 'development guide does not require human approval for new guardrails'

printf 'Component deployment contract tests passed.\n'
