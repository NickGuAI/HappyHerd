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
            "HAPPYHERD_IMAGE=ghcr.io/nickguai/happyherd@sha256:$image_digest"
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
    "happyherd.gehirn.ai" \
    "https://happyherd.gehirn.ai" \
    "20015" \
    "$TMP_ROOT/data" \
    "$TMP_ROOT/logs" \
    "$TMP_ROOT/cli" \
    "$TMP_ROOT/secret" \
    "$TMP_ROOT/openai-secret"
"$ROOT/scripts/validate-runtime-isolation.sh" "$TMP_ROOT/safe.env" template >/dev/null
mkdir -p "$TMP_ROOT/data" "$TMP_ROOT/logs" "$TMP_ROOT/cli"
printf 'test-only-secret-material-0123456789\n' > "$TMP_ROOT/secret"
printf 'test-only-openai-material-0123456789\n' > "$TMP_ROOT/openai-secret"
chmod 0600 "$TMP_ROOT/secret"
chmod 0600 "$TMP_ROOT/openai-secret"
"$ROOT/scripts/validate-runtime-isolation.sh" "$TMP_ROOT/safe.env" runtime >/dev/null

write_config "$TMP_ROOT/baolab.env" "baolab.gehirn.ai" "https://baolab.gehirn.ai" "20001" "$TMP_ROOT/bao-data" "$TMP_ROOT/bao-logs" "$TMP_ROOT/bao-cli" "$TMP_ROOT/bao-secret"
"$ROOT/scripts/validate-runtime-isolation.sh" "$TMP_ROOT/baolab.env" template >/dev/null

write_config "$TMP_ROOT/url-mismatch.env" "baolab.gehirn.ai" "https://happyherd.gehirn.ai" "20001" "$TMP_ROOT/data" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/url-mismatch.env"

write_config "$TMP_ROOT/invalid-port.env" "baolab.gehirn.ai" "https://baolab.gehirn.ai" "70000" "$TMP_ROOT/data" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/invalid-port.env"

write_config "$TMP_ROOT/invalid-domain.env" "bao..gehirn.ai" "https://bao..gehirn.ai" "20001" "$TMP_ROOT/data" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/invalid-domain.env"

write_config "$TMP_ROOT/herd.env" "happyherd.gehirn.ai" "https://happyherd.gehirn.ai" "20015" "$HOME/.herd/happyherd" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/herd.env"

write_config "$TMP_ROOT/happy.env" "happyherd.gehirn.ai" "https://happyherd.gehirn.ai" "20015" "$TMP_ROOT/data" "$TMP_ROOT/logs" "$HOME/.happy" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/happy.env"

write_config "$TMP_ROOT/qmherd.env" "happyherd.gehirn.ai" "https://happyherd.gehirn.ai" "20015" "$TMP_ROOT/qmherd-data" "$TMP_ROOT/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
expect_rejected "$TMP_ROOT/qmherd.env"

write_config "$TMP_ROOT/overlap.env" "happyherd.gehirn.ai" "https://happyherd.gehirn.ai" "20015" "$TMP_ROOT/state" "$TMP_ROOT/state/logs" "$TMP_ROOT/cli" "$TMP_ROOT/secret"
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
"$ROOT/scripts/validate-runtime-isolation.sh" "$TMP_ROOT/baolab.env" template >/dev/null
unset HAPPYHERD_OPENAI_API_KEY_FILE

grep -Fq 'User=ec2-user' "$ROOT/deploy/happyherd-daemon.service"
grep -Fq 'daemon start-sync' "$ROOT/deploy/happyherd-daemon.service"
grep -Fq 'HAPPY_HOME_DIR=/home/ec2-user/.happyherd' "$ROOT/deploy/happyherd-daemon.env.example"

printf 'Runtime isolation contract tests passed.\n'
