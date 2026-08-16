#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-/etc/happyherd/daemon.env}"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ -r "$ENV_FILE" ]] || die "host daemon environment is not readable: $ENV_FILE"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DAEMON_CLI="${HAPPYHERD_DAEMON_CLI:-/opt/happyherd/current/daemon/bin/happy.mjs}"
[[ -x "$DAEMON_CLI" ]] || die "HappyHerd daemon CLI is not executable: $DAEMON_CLI"

resolved_cli="$(readlink -f "$DAEMON_CLI")"
release_manifest="$(dirname "$(dirname "$(dirname "$resolved_cli")")")/build-manifest.json"
unset HAPPYHERD_RELEASE_SHA
if [[ -f "$release_manifest" ]]; then
    HAPPYHERD_RELEASE_SHA="$(node -e "const m=require(process.argv[1]); const s=m.source?.happyHerdSha; if(!/^[0-9a-f]{40}$/.test(s??'')||m.source?.originMainSha!==s)process.exit(1); process.stdout.write(s)" "$release_manifest")"
    export HAPPYHERD_RELEASE_SHA
fi

# This is intentionally the upstream detached lifecycle. The bootstrap exits
# after readiness is confirmed, leaving the daemon and provider sessions out of
# a HappyHerd-owned service cgroup.
"$DAEMON_CLI" daemon start

if [[ -n "${HAPPYHERD_RELEASE_SHA:-}" ]]; then
    happy_home_dir="${HAPPY_HOME_DIR:-${HOME:-}}"
    [[ -n "$happy_home_dir" ]] || die 'HAPPY_HOME_DIR or HOME is required to verify daemon release identity'
    daemon_state="$happy_home_dir/daemon.state.json"
    release_ready=false

    for _ in {1..50}; do
        if node -e '
            const fs = require("node:fs");
            const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            process.exit(state.releaseSha === process.argv[2] ? 0 : 1);
        ' "$daemon_state" "$HAPPYHERD_RELEASE_SHA" >/dev/null 2>&1; then
            release_ready=true
            break
        fi
        sleep 0.1
    done

    [[ "$release_ready" == true ]] || \
        die "daemon did not report release SHA $HAPPYHERD_RELEASE_SHA in $daemon_state"
fi
