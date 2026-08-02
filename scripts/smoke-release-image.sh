#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_REF="${1:-}"
EVIDENCE_FILE="${2:-}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/happyherd-image-smoke.XXXXXX")"
CONTAINER_NAME="happyherd-smoke-$$"
DATA_VOLUME="happyherd-smoke-data-$$"
CLI_VOLUME="happyherd-smoke-cli-$$"

cleanup() {
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker volume rm -f "$DATA_VOLUME" "$CLI_VOLUME" >/dev/null 2>&1 || true
    rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ "$IMAGE_REF" =~ ^[a-z0-9.-]+(/[a-z0-9._-]+)+@sha256:[0-9a-f]{64}$ ]] || \
    die 'pass an immutable image reference ending in @sha256:<64 hex characters>'

for command_name in curl docker node sha256sum; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command not found: $command_name"
done

docker image inspect "$IMAGE_REF" >/dev/null 2>&1 || docker pull "$IMAGE_REF"

docker volume create "$DATA_VOLUME" >/dev/null
docker volume create "$CLI_VOLUME" >/dev/null
master_secret="$(printf '%s' "happyherd-smoke-$IMAGE_REF" | sha256sum | awk '{print $1}')"

docker run --detach \
    --name "$CONTAINER_NAME" \
    --publish 127.0.0.1::3005 \
    --volume "$DATA_VOLUME:/data" \
    --volume "$CLI_VOLUME:/happyherd-cli" \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=256m \
    --security-opt no-new-privileges:true \
    --cap-drop ALL \
    --env HOST=0.0.0.0 \
    --env PORT=3005 \
    --env DATA_DIR=/data \
    --env PGLITE_DIR=/data/pglite \
    --env PUBLIC_URL=https://happyherd.gehirn.ai \
    --env HANDY_MASTER_SECRET="$master_secret" \
    --env HAPPY_HOME_DIR=/happyherd-cli \
    --env 'HAPPY_INJECT_HTML_CONFIG={"serverUrl":"https://happyherd.gehirn.ai","disableAnalytics":true}' \
    "$IMAGE_REF" >/dev/null

host_port="$(docker port "$CONTAINER_NAME" 3005/tcp | awk -F: 'NR == 1 { print $NF }')"
[[ "$host_port" =~ ^[0-9]+$ ]] || die 'could not resolve the ephemeral host port'
base_url="http://127.0.0.1:$host_port"

health_body=''
for _attempt in $(seq 1 60); do
    if health_body="$(curl --fail --silent --show-error --max-time 2 "$base_url/health" 2>/dev/null)"; then
        break
    fi
    sleep 1
done

node -e '
const body = JSON.parse(process.argv[1]);
if (body.status !== "ok" || body.service !== "happy-server") process.exit(1);
' "$health_body" || die "health response was not healthy: $health_body"

root_file="$TMP_ROOT/root.html"
curl --fail --silent --show-error --max-time 5 "$base_url/" > "$root_file"
grep -Eq '<div[^>]+id="root"|<div[^>]+id=root' "$root_file" || \
    die 'root route did not serve the bundled Web application'
docker exec "$CONTAINER_NAME" test -f /app/webapp/index.html || \
    die 'runtime image does not contain the bundled Web application'

source_sha="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE_REF")"
brand_sha="$(docker image inspect --format '{{ index .Config.Labels "ai.gehirn.happyherd.brand.sha256" }}' "$IMAGE_REF")"
expected_brand_sha="$(sha256sum "$ROOT/branding/hervald-logo-mark-black.png" | awk '{print $1}')"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || die 'image has no immutable source revision label'
[[ "$brand_sha" == "$expected_brand_sha" ]] || die 'image does not identify the approved Hervald asset'

if [[ -n "$EVIDENCE_FILE" ]]; then
    mkdir -p "$(dirname "$EVIDENCE_FILE")"
    IMAGE_REF="$IMAGE_REF" SOURCE_SHA="$source_sha" BRAND_SHA="$brand_sha" \
        HEALTH_BODY="$health_body" ROOT_SHA="$(sha256sum "$root_file" | awk '{print $1}')" \
        node <<'NODE' > "$EVIDENCE_FILE"
const evidence = {
    schemaVersion: 1,
    image: process.env.IMAGE_REF,
    sourceSha: process.env.SOURCE_SHA,
    brandAssetSha256: process.env.BRAND_SHA,
    health: JSON.parse(process.env.HEALTH_BODY),
    rootHtmlSha256: process.env.ROOT_SHA,
    result: 'healthy',
};
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
NODE
fi

printf 'Release image smoke passed: %s\n' "$IMAGE_REF"
