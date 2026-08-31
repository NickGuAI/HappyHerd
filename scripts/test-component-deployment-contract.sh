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
[[ -f "$ROOT/scripts/lib/cli-command-migration.sh" ]] || \
    fail 'host CLI command-migration helper is missing'

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
grep -Fq '__HAPPYHERD_DAEMON_USER__' "$ROOT/deploy/happyherd-daemon.cron" || \
    fail 'Linux daemon cron source does not defer the run account to installation'
grep -Fq "id \"\$RUN_USER\"" "$ROOT/scripts/install-linux-daemon-bootstrap.sh" || \
    fail 'Linux daemon bootstrap does not validate the selected host account'
grep -Fq "awk -v run_user=\"\$RUN_USER\"" "$ROOT/scripts/install-linux-daemon-bootstrap.sh" || \
    fail 'Linux daemon bootstrap does not render the selected host account'
if grep -En '@reboot happyherd-runtime|HAPPY_HOME_DIR=/var/lib/happyherd-runtime' \
    "$ROOT/deploy/happyherd-daemon.cron" "$ROOT/deploy/happyherd-daemon.env.example" >/dev/null; then
    fail 'host daemon lane still assumes a synthetic happyherd-runtime account'
fi
grep -Fq 'HAPPYHERD_DAEMON_CLI=/usr/local/bin/happyherd' "$ROOT/deploy/happyherd-daemon.env.example" || \
    fail 'daemon does not select the independently installed Happy CLI'
grep -Fq "runuser -u \"\$BUILD_USER\"" "$ROOT/scripts/install-host-cli.sh" || \
    fail 'root CLI installation can contaminate the checkout with root-owned build output'
grep -Fq "HAPPYHERD_LINK=\"\${2:-/usr/local/bin/happyherd}\"" "$ROOT/scripts/install-host-cli.sh" || \
    fail 'host CLI install does not expose the happyherd command'
grep -Fq "ln -sfn \"\$TARGET/bin/happy.mjs\" \"\$HAPPYHERD_LINK\"" "$ROOT/scripts/install-host-cli.sh" || \
    fail 'host happyherd command does not point directly to the CLI entry'
grep -Fq -- '--filter @happyherd/cli --fail-if-no-match build' "$ROOT/scripts/install-host-cli.sh" || \
    fail 'host installer does not build the public CLI package'
grep -Fq -- '--filter happy-agent --fail-if-no-match build' "$ROOT/scripts/install-host-cli.sh" || \
    fail 'host installer does not build the CLI workspace dependency'
# shellcheck disable=SC2016
grep -Fq 'remove_exact_legacy_happy_link "$LEGACY_HAPPY_LINK" "$TARGET"' "$ROOT/scripts/install-host-cli.sh" || \
    fail 'host installer does not apply exact legacy-link cleanup'
grep -Fq "settings.serverUrl = 'http://127.0.0.1:3005'" "$ROOT/scripts/start-host-daemon.sh" || \
    fail 'fresh host daemon bootstrap does not persist the local server default'
grep -Fq "runuser -u \"\$BUILD_USER\"" "$ROOT/scripts/install-agent-runtime.sh" || \
    fail 'root agent installation can contaminate the checkout with root-owned build output'
grep -Fq '/usr/local/lib/happyherd-agent/dist/index.mjs' "$ROOT/deploy/happyherd-agent.service" || \
    fail 'governed agent does not use its independent stable package path'
grep -Fq "docker pull \"\$IMAGE\"" "$ROOT/scripts/deploy-server.sh" || \
    fail 'server deploy does not pull an operator-selected image'
grep -Fq "systemctl restart \"\$SERVICE\"" "$ROOT/scripts/deploy-server.sh" || \
    fail 'server deploy does not restart the central systemd service'
grep -Fq "docker buildx create --name \"\$BUILDER\" --driver docker-container" \
    "$ROOT/scripts/build-server-image.sh" || \
    fail 'server build does not isolate its cache in a disposable HappyHerd builder'
grep -Fq "docker buildx rm \"\$BUILDER\"" "$ROOT/scripts/build-server-image.sh" || \
    fail 'server build does not remove its disposable builder and cache'
grep -Fq "docker image prune --all --force --filter 'label=org.opencontainers.image.title=HappyHerd'" \
    "$ROOT/scripts/deploy-server.sh" || \
    fail 'server deploy does not remove only unused HappyHerd images'
if grep -En 'docker (builder|system) prune' \
    "$ROOT/scripts/build-server-image.sh" "$ROOT/scripts/deploy-server.sh" >/dev/null; then
    fail 'server build or deploy uses global Docker pruning'
fi
grep -Fq 'Manual rollback: rerun this command with a previously published tag.' "$ROOT/scripts/deploy-server.sh" || \
    fail 'server deploy does not document explicit manual rollback'

if grep -ERn --exclude='test-component-deployment-contract.sh' \
    --exclude='deployment-guardrail-audit.md' \
    --exclude='public-launcher-release.md' \
    --exclude-dir='happyherd-agent-runtime' \
    '/opt/happyherd/(current|releases)|HAPPYHERD_RELEASE_SHA|releaseSha' \
    "$ROOT/deploy" "$ROOT/docs" "$ROOT/scripts" "$ROOT/server/Dockerfile" >/dev/null; then
    fail 'lockstep release identity remains in deployment sources'
fi

if grep -ERn --exclude='test-component-deployment-contract.sh' \
    --exclude='deployment-guardrail-audit.md' \
    --exclude='public-launcher-release.md' \
    'build-release-artifacts|verify-reproducible-build|verify-release-manifest|automatic rollback|digest-only' \
    "$ROOT/.dev" "$ROOT/docs" "$ROOT/scripts" >/dev/null; then
    fail 'lockstep release instructions remain'
fi

if grep -En -- '--read-only|no-new-privileges|--cap-drop|noexec,nosuid|unknown runtime config key' \
    "$ROOT/scripts/run-container.sh" "$ROOT/scripts/lib/runtime-config.sh" >/dev/null; then
    fail 'unapproved server runtime guard remains'
fi

if grep -En '^FROM .*@sha256:' "$ROOT/server/Dockerfile" >/dev/null; then
    fail 'server build still requires immutable base-image digests'
fi

if grep -En '^[[:space:]]*VOLUME([[:space:]]|$)' "$ROOT/server/Dockerfile" >/dev/null; then
    fail 'server image declares storage ownership instead of using an operator-managed /data mount'
fi

grep -Fq 'deployment-guardrail-audit.md' "$ROOT/docs/deployment.md" || \
    fail 'human-reviewed deployment guardrail inventory is not linked'
grep -Fq 'without explicit human approval recorded' "$ROOT/AGENTS.md" || \
    fail 'development guide does not require human approval for new guardrails'

fixture="$(mktemp -d)"
cleanup_fixture() {
    rm -rf "$fixture"
}
trap cleanup_fixture EXIT
mkdir -p "$fixture/home" "$fixture/bin"

# Exercise the exact cleanup policy used by the host installer. An exact old
# HappyHerd symlink is removed; an unrelated command at the same path survives.
# shellcheck source=scripts/lib/cli-command-migration.sh
source "$ROOT/scripts/lib/cli-command-migration.sh"
legacy_target="$fixture/cli-target"
legacy_link="$fixture/happy"
mkdir -p "$legacy_target/bin"
ln -s "$legacy_target/bin/happy.mjs" "$legacy_link"
remove_exact_legacy_happy_link "$legacy_link" "$legacy_target"
[[ ! -e "$legacy_link" && ! -L "$legacy_link" ]] ||
    fail 'exact previously managed host happy symlink was preserved'
ln -s /opt/unrelated/happy "$legacy_link"
remove_exact_legacy_happy_link "$legacy_link" "$legacy_target"
[[ -L "$legacy_link" && "$(readlink "$legacy_link")" == /opt/unrelated/happy ]] ||
    fail 'unmanaged host happy symlink was removed'

cat > "$fixture/bin/happyherd" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$HAPPYHERD_TEST_LOG"
SH
chmod 755 "$fixture/bin/happyherd"
cat > "$fixture/daemon.env" <<EOF
HAPPY_HOME_DIR=$fixture/home/.happyherd
HAPPYHERD_DAEMON_CLI=$fixture/bin/happyherd
PATH=$PATH
EOF
HAPPYHERD_TEST_LOG="$fixture/daemon.log" HOME="$fixture/home" \
    env -u HAPPY_SERVER_URL -u HAPPY_WEBAPP_URL \
    "$ROOT/scripts/start-host-daemon.sh" "$fixture/daemon.env"
node -e '
const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (s.serverUrl !== "http://127.0.0.1:3005" || s.webappUrl !== "http://127.0.0.1:3005") process.exit(1);
' "$fixture/home/.happyherd/settings.json"
grep -Fxq 'daemon start' "$fixture/daemon.log"
node -e '
const fs = require("node:fs");
const p = process.argv[1];
const s = JSON.parse(fs.readFileSync(p, "utf8"));
s.serverUrl = "https://remote.example";
s.webappUrl = "https://remote.example";
fs.writeFileSync(p, JSON.stringify(s));
' "$fixture/home/.happyherd/settings.json"
HAPPYHERD_TEST_LOG="$fixture/daemon.log" HOME="$fixture/home" \
    env -u HAPPY_SERVER_URL -u HAPPY_WEBAPP_URL \
    "$ROOT/scripts/start-host-daemon.sh" "$fixture/daemon.env"
node -e '
const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (s.serverUrl !== "https://remote.example" || s.webappUrl !== "https://remote.example") process.exit(1);
' "$fixture/home/.happyherd/settings.json"

cat > "$fixture/bin/docker" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$HAPPYHERD_TEST_DOCKER_LOG"
if [ "$1" = buildx ] && [ "$2" = rm ]; then
    exit 1
fi
SH
chmod 755 "$fixture/bin/docker"
HAPPYHERD_TEST_DOCKER_LOG="$fixture/docker.log" PATH="$fixture/bin:$PATH" \
    "$ROOT/scripts/build-server-image.sh" \
    --image ghcr.io/example/happyherd:contract \
    --push > "$fixture/build.log" 2>&1
grep -Fq 'buildx build' "$fixture/docker.log"
grep -Fxq 'push ghcr.io/example/happyherd:contract' "$fixture/docker.log"
grep -Fq 'buildx rm happyherd-server-' "$fixture/docker.log"
[[ "$(grep -Fc 'buildx rm happyherd-server-' "$fixture/docker.log")" -eq 1 ]]
grep -Fq 'warning: failed to remove disposable Buildx builder:' "$fixture/build.log"

printf 'Component deployment contract tests passed.\n'
