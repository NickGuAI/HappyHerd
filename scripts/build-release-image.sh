#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPOSITORY="${HAPPYHERD_IMAGE_REPOSITORY:-ghcr.io/example/happyherd}"
PUBLIC_URL="${HAPPYHERD_PUBLIC_URL:-https://happyherd.example.com}"
SOURCE_URL="${HAPPYHERD_SOURCE_URL:-https://example.com/happyherd}"
REPOSITORY_DISPLAY="${HAPPYHERD_REPOSITORY_DISPLAY:-}"
REPOSITORY_URL="${HAPPYHERD_REPOSITORY_URL:-}"
ISSUE_URL="${HAPPYHERD_ISSUE_URL:-}"
PUSH=false

usage() {
    printf 'Usage: %s [--push] [--repository IMAGE_REPOSITORY]\n' "$0"
}

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --push)
            PUSH=true
            shift
            ;;
        --repository)
            [[ $# -ge 2 ]] || die '--repository requires a value'
            REPOSITORY="$2"
            shift 2
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

for command_name in docker git sha256sum; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command not found: $command_name"
done

[[ "$REPOSITORY" =~ ^[a-z0-9.-]+(/[a-z0-9._-]+)+$ ]] || die "invalid image repository: $REPOSITORY"
[[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=normal)" ]] || \
    die 'release images must be built from a clean worktree'

SOURCE_SHA="$(git -C "$ROOT" rev-parse HEAD)"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'could not resolve a full source SHA'
CREATED="$(git -C "$ROOT" show -s --format=%cI HEAD)"
VERSION="sha-${SOURCE_SHA}"
IMAGE_TAG="${REPOSITORY}:${VERSION}"
BRAND_SHA256="$(sha256sum "$ROOT/branding/hervald-logo-mark-black.png" | awk '{print $1}')"

docker build \
    --pull \
    --file "$ROOT/server/Dockerfile" \
    --tag "$IMAGE_TAG" \
    --build-arg "HAPPYHERD_PUBLIC_URL=$PUBLIC_URL" \
    --build-arg "HAPPYHERD_REPOSITORY_DISPLAY=$REPOSITORY_DISPLAY" \
    --build-arg "HAPPYHERD_REPOSITORY_URL=$REPOSITORY_URL" \
    --build-arg "HAPPYHERD_ISSUE_URL=$ISSUE_URL" \
    --build-arg "HAPPYHERD_SOURCE_SHA=$SOURCE_SHA" \
    --build-arg "HAPPYHERD_SOURCE_URL=$SOURCE_URL" \
    --build-arg "HAPPYHERD_CREATED=$CREATED" \
    --build-arg "HAPPYHERD_VERSION=$VERSION" \
    --build-arg "HAPPYHERD_BRAND_SHA256=$BRAND_SHA256" \
    "$ROOT/server"

actual_revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE_TAG")"
actual_brand="$(docker image inspect --format '{{ index .Config.Labels "org.happyherd.brand.sha256" }}' "$IMAGE_TAG")"
[[ "$actual_revision" == "$SOURCE_SHA" ]] || die 'built image revision label does not match source'
[[ "$actual_brand" == "$BRAND_SHA256" ]] || die 'built image brand label does not match approved asset'

printf 'HAPPYHERD_IMAGE_TAG=%s\n' "$IMAGE_TAG"

if [[ "$PUSH" == true ]]; then
    docker push "$IMAGE_TAG"
    repo_digest="$(docker image inspect --format '{{ range .RepoDigests }}{{ println . }}{{ end }}' "$IMAGE_TAG" | awk -v repo="$REPOSITORY@" 'index($0, repo) == 1 { print; exit }')"
    [[ "$repo_digest" =~ ^${REPOSITORY}@sha256:[0-9a-f]{64}$ ]] || \
        die 'registry did not return an immutable repository digest'
    printf 'HAPPYHERD_IMAGE_DIGEST=%s\n' "$repo_digest"
fi
