#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${HAPPYHERD_SERVER_IMAGE:-ghcr.io/example/happyherd:main}"
PUBLIC_URL="${HAPPYHERD_PUBLIC_URL:-https://happyherd.example.com}"
SOURCE_URL="${HAPPYHERD_SOURCE_URL:-https://example.com/happyherd}"
REPOSITORY_DISPLAY="${HAPPYHERD_REPOSITORY_DISPLAY:-example/happyherd}"
REPOSITORY_URL="${HAPPYHERD_REPOSITORY_URL:-https://example.com/happyherd}"
ISSUE_URL="${HAPPYHERD_ISSUE_URL:-https://example.com/happyherd/issues}"
PUSH=false

usage() {
    printf 'Usage: %s [--image REPOSITORY:TAG] [--push]\n' "$0"
}

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --image)
            [[ $# -ge 2 ]] || die '--image requires a value'
            IMAGE="$2"
            shift 2
            ;;
        --push)
            PUSH=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            die "unknown argument: $1"
            ;;
    esac
done

command -v docker >/dev/null 2>&1 || die 'docker is required'
[[ "$IMAGE" =~ ^[a-z0-9.-]+(/[a-z0-9._-]+)+:[A-Za-z0-9._-]+$ ]] || \
    die "server image must be a normal repository:tag reference: $IMAGE"

SOURCE_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || printf unknown)"
CREATED="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
VERSION="${IMAGE##*:}"

# The Dockerfile builds only the self-host server and the Web bundle it serves.
# CLI/daemon, mobile, and governed-agent releases are independent lanes.
docker build \
    --pull \
    --file "$ROOT/server/Dockerfile" \
    --tag "$IMAGE" \
    --build-arg "HAPPYHERD_PUBLIC_URL=$PUBLIC_URL" \
    --build-arg "HAPPYHERD_REPOSITORY_DISPLAY=$REPOSITORY_DISPLAY" \
    --build-arg "HAPPYHERD_REPOSITORY_URL=$REPOSITORY_URL" \
    --build-arg "HAPPYHERD_ISSUE_URL=$ISSUE_URL" \
    --build-arg "HAPPYHERD_SOURCE_SHA=$SOURCE_SHA" \
    --build-arg "HAPPYHERD_SOURCE_URL=$SOURCE_URL" \
    --build-arg "HAPPYHERD_CREATED=$CREATED" \
    --build-arg "HAPPYHERD_VERSION=$VERSION" \
    "$ROOT/server"

if [[ "$PUSH" == true ]]; then
    docker push "$IMAGE"
fi

printf 'HappyHerd server image ready: %s\n' "$IMAGE"
