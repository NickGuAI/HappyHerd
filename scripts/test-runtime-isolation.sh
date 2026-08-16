#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-isolation.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

write_config() {
    local target="$1"
    local domain="$2"
    local public_url="$3"
    local port="$4"
    local data_dir="$5"
    local log_dir="$6"
    local cli_home="$7"
    local secret_file="$8"
    local openai_secret_file="${9:-}"
    local image_digest
    image_digest="$(printf 'a%.0s' {1..64})"

    {
        printf '%s\n' \
            "HAPPYHERD_DOMAIN=$domain" \
            "HAPPYHERD_PUBLIC_URL=$public_url" \
            "HAPPYHERD_PORT=$port" \
            "HAPPYHERD_DATA_DIR=$data_dir" \
            "HAPPYHERD_LOG_DIR=$log_dir" \
            "HAPPYHERD_CLI_HOME=$cli_home" \
            "HAPPYHERD_MASTER_SECRET_FILE=$secret_file" \
            'HAPPYHERD_CONTAINER_NAME=happyherd' \
            "HAPPYHERD_IMAGE=ghcr.io/example/happyherd@sha256:$image_digest"
        if [[ -n "$openai_secret_file" ]]; then
            printf 'HAPPYHERD_OPENAI_API_KEY_FILE=%s\n' "$openai_secret_file"
        fi
    } > "$target"
}

expect_rejected() {
    local env_file="$1"
    if "$ROOT/scripts/validate-runtime-isolation.sh" "$env_file" template >/dev/null 2>&1; then
        printf 'error: unsafe config was accepted: %s\n' "$env_file" >&2
        exit 1
    fi
}

expect_runtime_rejected() {
    local env_file="$1"
    if "$ROOT/scripts/validate-runtime-isolation.sh" "$env_file" runtime >/dev/null 2>&1; then
        printf 'error: unsafe runtime config was accepted: %s\n' "$env_file" >&2
        exit 1
    fi
}

write_config \
    "$TMP_ROOT/safe.env" \
    "happyherd.example.com" \
    "https://happyherd.example.com" \
    "20015" \
    "$TMP_ROOT/data" \
    "$TMP_ROOT/logs" \
    "$TMP_ROOT/cli" \
    "$TMP_ROOT/secret" \
    "$TMP_ROOT/openai-secret"
"$ROOT/scripts/validate-runtime-isolation.sh" "$TMP_ROOT/safe.env" template >/dev/null
env -u HOME "$ROOT/scripts/validate-runtime-isolation.sh" "$TMP_ROOT/safe.env" template >/dev/null
mkdir -p "$TMP_ROOT/data" "$TMP_ROOT/logs" "$TMP_ROOT/cli"
printf 'test-only-secret-material-0123456789\n' > "$TMP_ROOT/secret"
printf 'test-only-openai-material-0123456789\n' > "$TMP_ROOT/openai-secret"
chmod 0600 "$TMP_ROOT/secret"
chmod 0600 "$TMP_ROOT/openai-secret"
"$ROOT/scripts/validate-runtime-isolation.sh" "$TMP_ROOT/safe.env" runtime >/dev/null

write_config "$TMP_ROOT/secondary.env" "secondary.happyherd.example.com" "https://secondary.happyherd.example.com" "20001" "$TMP_ROOT/secondary-data" "$TMP_ROOT/secondary-logs" "$TMP_ROOT/secondary-cli" "$TMP_ROOT/secondary-secret"
"$ROOT/scripts/validate-runtime-isolation.sh" "$TMP_ROOT/secondary.env" template >/dev/null

write_config "$TMP_ROOT/url-mismatch.env" "secondary.happyherd.example.com" "https://happyherd.example.com" "20001" "$TMP_ROOT/data" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/url-mismatch.env"

write_config "$TMP_ROOT/invalid-port.env" "secondary.happyherd.example.com" "https://secondary.happyherd.example.com" "70000" "$TMP_ROOT/data" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/invalid-port.env"

write_config "$TMP_ROOT/invalid-domain.env" "invalid..example.com" "https://invalid..example.com" "20001" "$TMP_ROOT/data" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/invalid-domain.env"

write_config "$TMP_ROOT/herd.env" "happyherd.example.com" "https://happyherd.example.com" "20015" "$HOME/.herd/happyherd" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/herd.env"

write_config "$TMP_ROOT/happy.env" "happyherd.example.com" "https://happyherd.example.com" "20015" "$TMP_ROOT/data" "$TMP_ROOT/logs" "$HOME/.happy" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/happy.env"

write_config "$TMP_ROOT/secondary-herd.env" "secondary.happyherd.example.com" "https://secondary.happyherd.example.com" "20001" "/home/.herd/happyherd" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
env -u HOME "$ROOT/scripts/validate-runtime-isolation.sh" "$TMP_ROOT/secondary-herd.env" template >/dev/null 2>&1 && {
    printf 'error: secondary profile legacy Herd state was accepted without HOME\n' >&2
    exit 1
}

write_config "$TMP_ROOT/retired-happy.env" "happyherd.example.com" "https://happyherd.example.com" "20015" "$TMP_ROOT/retired-happy-data" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/retired-happy.env"

write_config "$TMP_ROOT/overlap.env" "happyherd.example.com" "https://happyherd.example.com" "20015" "$TMP_ROOT/state" "$TMP_ROOT/state/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/overlap.env"

chmod 0644 "$TMP_ROOT/openai-secret"
expect_runtime_rejected "$TMP_ROOT/safe.env"
chmod 0600 "$TMP_ROOT/openai-secret"

mkdir -p "$TMP_ROOT/bin"
cat > "$TMP_ROOT/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '<call>' "$@" >> "$HAPPYHERD_TEST_DOCKER_LOG"
EOF
chmod +x "$TMP_ROOT/bin/docker"
export HAPPYHERD_TEST_DOCKER_LOG="$TMP_ROOT/docker.log"
PATH="$TMP_ROOT/bin:$PATH" "$ROOT/scripts/run-container.sh" "$TMP_ROOT/safe.env"
grep -Fxq '0.0.0.0:20015:3005' "$HAPPYHERD_TEST_DOCKER_LOG"
grep -Fxq "$TMP_ROOT/openai-secret:/run/secrets/openai-api-key:ro" "$HAPPYHERD_TEST_DOCKER_LOG"
grep -Fxq 'OPENAI_API_KEY_FILE=/run/secrets/openai-api-key' "$HAPPYHERD_TEST_DOCKER_LOG"
if grep -Fq 'test-only-openai-material' "$HAPPYHERD_TEST_DOCKER_LOG"; then
    printf 'error: provider secret leaked into Docker arguments\n' >&2
    exit 1
fi

export HAPPYHERD_OPENAI_API_KEY_FILE="$TMP_ROOT/ambient-secret"
"$ROOT/scripts/validate-runtime-isolation.sh" "$TMP_ROOT/secondary.env" template >/dev/null
unset HAPPYHERD_OPENAI_API_KEY_FILE

[[ ! -e "$ROOT/deploy/happyherd-daemon.service" ]] || {
    printf 'error: host daemon systemd unit must not exist\n' >&2
    exit 1
}
grep -Fq '@reboot happyherd-runtime /opt/happyherd/current/scripts/start-host-daemon.sh' "$ROOT/deploy/happyherd-daemon.cron"
# The contract intentionally matches the literal runtime variable.
# shellcheck disable=SC2016
grep -Fq '"$DAEMON_CLI" daemon start' "$ROOT/scripts/start-host-daemon.sh"
if grep -Fq 'daemon start-sync' "$ROOT/scripts/start-host-daemon.sh" "$ROOT/deploy/happyherd-daemon.cron"; then
    printf 'error: host bootstrap bypasses the upstream detached daemon lifecycle\n' >&2
    exit 1
fi
grep -Fq 'HAPPY_HOME_DIR=/var/lib/happyherd-runtime/.happyherd' "$ROOT/deploy/happyherd-daemon.env.example"
grep -Fq '/var/lib/happyherd-runtime/.local/bin' "$ROOT/deploy/happyherd-daemon.env.example"

mkdir -p "$TMP_ROOT/daemon-bin"
# Provider availability is session-scoped. A broken installed provider and an
# absent provider must not prevent the machine daemon from coming online.
cat > "$TMP_ROOT/daemon-bin/claude" <<'EOF'
#!/usr/bin/env bash
printf 'error: provider preflight must not run during daemon bootstrap\n' >&2
exit 99
EOF
chmod +x "$TMP_ROOT/daemon-bin/claude"
cat > "$TMP_ROOT/daemon-bin/happy.mjs" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$HAPPYHERD_BOOTSTRAP_TEST_LOG"
EOF
chmod +x "$TMP_ROOT/daemon-bin/happy.mjs"
cat > "$TMP_ROOT/daemon.env" <<EOF
HAPPY_HOME_DIR=$TMP_ROOT/happy-home
PATH=$TMP_ROOT/daemon-bin:/usr/bin:/bin
HAPPYHERD_DAEMON_CLI=$TMP_ROOT/daemon-bin/happy.mjs
EOF
export HAPPYHERD_BOOTSTRAP_TEST_LOG="$TMP_ROOT/daemon-bootstrap.log"
"$ROOT/scripts/start-host-daemon.sh" "$TMP_ROOT/daemon.env"
grep -Fxq 'daemon start' "$HAPPYHERD_BOOTSTRAP_TEST_LOG"

printf 'Runtime isolation contract tests passed.\n'
