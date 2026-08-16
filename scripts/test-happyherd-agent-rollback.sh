#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROLLBACK="$ROOT/scripts/rollback-happyherd-agent.sh"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-agent-rollback-test.XXXXXX")"

cleanup() {
    rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
    printf 'happyherd-agent-rollback-contract: %s\n' "$*" >&2
    exit 1
}

previous_sha="$(printf 'a%.0s' {1..40})"
target_sha="$(printf 'b%.0s' {1..40})"
release_root="$TMP_ROOT/releases"
current_link="$TMP_ROOT/current"
bridge_env="$TMP_ROOT/bridge.env"
daemon_env="$TMP_ROOT/daemon.env"
event_log="$TMP_ROOT/events.log"
mkdir -p "$TMP_ROOT/bin" "$release_root/$previous_sha/scripts" "$release_root/$target_sha/scripts"
touch "$bridge_env" "$daemon_env" "$event_log"

for sha in "$previous_sha" "$target_sha"; do
    release="$release_root/$sha"
    mkdir -p "$release/daemon/bin" "$release/happyherd-agent/dist"
    printf '#!/usr/bin/env node\n' > "$release/daemon/bin/happy.mjs"
    printf 'export {};\n' > "$release/happyherd-agent/dist/index.mjs"
    chmod 0755 "$release/daemon/bin/happy.mjs"
    SOURCE_SHA="$sha" MANIFEST="$release/build-manifest.json" node <<'NODE'
const fs = require('node:fs');
fs.writeFileSync(process.env.MANIFEST, `${JSON.stringify({
  source: { happyHerdSha: process.env.SOURCE_SHA },
})}\n`);
NODE
done

# Generated stubs expand variables only when they are executed.
# shellcheck disable=SC2016
printf '%s\n' '#!/usr/bin/env bash' 'if [[ "$1" == -u ]]; then printf "0\n"; else /usr/bin/id "$@"; fi' > "$TMP_ROOT/bin/id"
# shellcheck disable=SC2016
printf '%s\n' '#!/usr/bin/env bash' 'printf "systemctl %s\n" "$*" >> "$HAPPYHERD_AGENT_ROLLBACK_EVENT_LOG"' > "$TMP_ROOT/bin/systemctl"
# shellcheck disable=SC2016
printf '%s\n' \
    '#!/usr/bin/env bash' \
    '[[ "$1" == -u ]] || exit 2' \
    'shift 2' \
    '[[ "${1:-}" != -- ]] || shift' \
    '"$@"' \
    > "$TMP_ROOT/bin/runuser"
chmod 0755 "$TMP_ROOT/bin/id" "$TMP_ROOT/bin/systemctl" "$TMP_ROOT/bin/runuser"

write_release_stubs() {
    local sha="$1"
    local validator_status="$2"
    local start_status="$3"
    local release="$release_root/$sha"
    # shellcheck disable=SC2016
    printf '%s\n' \
        '#!/usr/bin/env bash' \
        'printf "start %s\n" "$(basename "$(dirname "$(dirname "$(readlink -f "$0")")")")" >> "$HAPPYHERD_AGENT_ROLLBACK_EVENT_LOG"' \
        "exit $start_status" \
        > "$release/scripts/start-host-daemon.sh"
    # shellcheck disable=SC2016
    printf '%s\n' \
        '#!/usr/bin/env bash' \
        'printf "validate %s %s\n" "$(basename "$(dirname "$(dirname "$(readlink -f "$0")")")")" "$2" >> "$HAPPYHERD_AGENT_ROLLBACK_EVENT_LOG"' \
        '[[ "$2" == template ]] && exit 0' \
        "exit $validator_status" \
        > "$release/scripts/validate-happyherd-agent-runtime.sh"
    # shellcheck disable=SC2016
    printf '%s\n' \
        '#!/usr/bin/env bash' \
        'printf "health %s\n" "$(basename "$(dirname "$(dirname "$(readlink -f "$0")")")")" >> "$HAPPYHERD_AGENT_ROLLBACK_EVENT_LOG"' \
        'exit 0' \
        > "$release/scripts/health-happyherd-agent.sh"
    chmod 0755 "$release/scripts/"*.sh
}

write_release_stubs "$previous_sha" 0 0
write_release_stubs "$target_sha" 0 0
ln -s "$release_root/$previous_sha" "$current_link"

export PATH="$TMP_ROOT/bin:$PATH"
export HAPPYHERD_AGENT_ROLLBACK_EVENT_LOG="$event_log"
"$ROLLBACK" "$target_sha" "$release_root" "$current_link" "$bridge_env" "$daemon_env" >/dev/null
[[ "$(readlink -f "$current_link")" == "$release_root/$target_sha" ]] || fail 'successful rollback did not select target release'
if ! grep -Fxq "validate $target_sha runtime" "$event_log"; then
    sed -n '1,80p' "$event_log" >&2
    fail 'successful rollback skipped target runtime validation'
fi
grep -Fxq "health $target_sha" "$event_log" || fail 'successful rollback skipped target health verification'

rm "$current_link"
ln -s "$release_root/$previous_sha" "$current_link"
: > "$event_log"
write_release_stubs "$target_sha" 1 0
if "$ROLLBACK" "$target_sha" "$release_root" "$current_link" "$bridge_env" "$daemon_env" >/dev/null 2>&1; then
    fail 'rollback accepted a target that failed runtime validation'
fi
[[ "$(readlink -f "$current_link")" == "$release_root/$previous_sha" ]] || fail 'failed rollback did not restore previous release'
grep -Fxq "start $previous_sha" "$event_log" || fail 'failed rollback did not hand daemon back to previous release'
[[ "$(grep -Fc 'systemctl start happyherd-agent.service' "$event_log")" -ge 1 ]] || fail 'failed rollback did not restore bridge service'

printf 'HappyHerd Agent rollback contract tests passed.\n'
