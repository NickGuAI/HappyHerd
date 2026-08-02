#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-rollback-test.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
    printf 'release-rollback-test: %s\n' "$*" >&2
    exit 1
}

repo='ghcr.io/nickguai/happyherd'
current_sha="$(printf 'a%.0s' {1..40})"
previous_sha="$(printf 'b%.0s' {1..40})"
current_digest="$(printf 'c%.0s' {1..64})"
previous_digest="$(printf 'd%.0s' {1..64})"
current_image="$repo@sha256:$current_digest"
previous_image="$repo@sha256:$previous_digest"

mkdir -p "$TMP_ROOT/bin" "$TMP_ROOT/data" "$TMP_ROOT/logs" "$TMP_ROOT/cli"
printf 'test-only-secret-material-0123456789\n' > "$TMP_ROOT/master-secret"
chmod 0600 "$TMP_ROOT/master-secret"

CURRENT_SHA="$current_sha" PREVIOUS_SHA="$previous_sha" \
CURRENT_DIGEST="$current_digest" PREVIOUS_DIGEST="$previous_digest" \
MANIFEST_PATH="$TMP_ROOT/release.json" node <<'NODE'
import { writeFileSync } from 'node:fs';

const repo = 'ghcr.io/nickguai/happyherd';
const slot = (sha, digest) => ({
    image: `${repo}@sha256:${digest}`,
    immutableTag: `${repo}:sha-${sha}`,
    sourceSha: sha,
    smoke: {
        evidenceSha256: 'e'.repeat(64),
        health: { service: 'happy-server', status: 'ok' },
        result: 'healthy',
        verifiedAt: '2026-08-02T00:00:00.000Z',
    },
});
const manifest = {
    schemaVersion: 1,
    releaseId: '2026-08-02-test',
    repository: repo,
    current: slot(process.env.CURRENT_SHA, process.env.CURRENT_DIGEST),
    previous: slot(process.env.PREVIOUS_SHA, process.env.PREVIOUS_DIGEST),
    health: { path: '/health', expected: { service: 'happy-server', status: 'ok' } },
    rollback: {
        command: 'scripts/rollback-release.sh docs/releases/test.json /etc/happyherd/runtime.env',
    },
};
writeFileSync(process.env.MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

write_runtime_env() {
    local image="$1"
    printf '%s\n' \
        'HAPPYHERD_DOMAIN=happyherd.gehirn.ai' \
        'HAPPYHERD_PUBLIC_URL=https://happyherd.gehirn.ai' \
        'HAPPYHERD_PORT=20015' \
        "HAPPYHERD_DATA_DIR=$TMP_ROOT/data" \
        "HAPPYHERD_LOG_DIR=$TMP_ROOT/logs" \
        "HAPPYHERD_CLI_HOME=$TMP_ROOT/cli" \
        "HAPPYHERD_MASTER_SECRET_FILE=$TMP_ROOT/master-secret" \
        'HAPPYHERD_CONTAINER_NAME=happyherd' \
        "HAPPYHERD_IMAGE=$image" \
        > "$TMP_ROOT/runtime.env"
    chmod 0600 "$TMP_ROOT/runtime.env"
}

# Generated stubs expand these variables only when the stub is executed.
# shellcheck disable=SC2016
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" "$*" >> "$HAPPYHERD_TEST_DOCKER_LOG"' > "$TMP_ROOT/bin/docker"
# shellcheck disable=SC2016
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" "$*" >> "$HAPPYHERD_TEST_SYSTEMCTL_LOG"' > "$TMP_ROOT/bin/systemctl"
# shellcheck disable=SC2016
printf '%s\n' \
    '#!/usr/bin/env bash' \
    'count=0' \
    '[[ ! -f "$HAPPYHERD_TEST_CURL_COUNT" ]] || count="$(cat "$HAPPYHERD_TEST_CURL_COUNT")"' \
    'count=$((count + 1))' \
    'printf "%s\\n" "$count" > "$HAPPYHERD_TEST_CURL_COUNT"' \
    'if [[ "${HAPPYHERD_TEST_FAIL_FIRST_HEALTH:-0}" == 1 && "$count" == 1 ]]; then exit 22; fi' \
    'printf "%s\\n" '\''{"status":"ok","service":"happy-server"}'\''' \
    > "$TMP_ROOT/bin/curl"
chmod +x "$TMP_ROOT/bin/docker" "$TMP_ROOT/bin/systemctl" "$TMP_ROOT/bin/curl"

export PATH="$TMP_ROOT/bin:$PATH"
export HAPPYHERD_TEST_DOCKER_LOG="$TMP_ROOT/docker.log"
export HAPPYHERD_TEST_SYSTEMCTL_LOG="$TMP_ROOT/systemctl.log"
export HAPPYHERD_TEST_CURL_COUNT="$TMP_ROOT/curl-count"
export HAPPYHERD_ACTIVATION_ATTEMPTS=1
export HAPPYHERD_ACTIVATION_DELAY_SECONDS=0

node "$ROOT/scripts/verify-release-manifest.mjs" --self-test >/dev/null
node "$ROOT/scripts/verify-release-manifest.mjs" "$TMP_ROOT/release.json" >/dev/null

write_runtime_env "$current_image"
"$ROOT/scripts/rollback-release.sh" "$TMP_ROOT/release.json" "$TMP_ROOT/runtime.env" >/dev/null
grep -Fxq "HAPPYHERD_IMAGE=$previous_image" "$TMP_ROOT/runtime.env" || \
    fail 'one-command rollback did not select the previous digest'
grep -Fxq 'restart happyherd.service' "$TMP_ROOT/systemctl.log" || \
    fail 'one-command rollback did not restart the service'

write_runtime_env "$current_image"
: > "$TMP_ROOT/systemctl.log"
rm -f "$TMP_ROOT/curl-count"
export HAPPYHERD_TEST_FAIL_FIRST_HEALTH=1
if "$ROOT/scripts/rollback-release.sh" "$TMP_ROOT/release.json" "$TMP_ROOT/runtime.env" >/dev/null 2>&1; then
    fail 'an unhealthy rollback target was accepted'
fi
unset HAPPYHERD_TEST_FAIL_FIRST_HEALTH
grep -Fxq "HAPPYHERD_IMAGE=$current_image" "$TMP_ROOT/runtime.env" || \
    fail 'failed activation did not restore the prior digest'
[[ "$(grep -Fc 'restart happyherd.service' "$TMP_ROOT/systemctl.log")" -eq 2 ]] || \
    fail 'failed activation did not restart both target and restored release'

printf 'Release rollback tests passed.\n'
