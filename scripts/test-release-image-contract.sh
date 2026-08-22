#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$ROOT/server/Dockerfile"

fail() {
    printf 'release-image-contract: %s\n' "$*" >&2
    exit 1
}

grep -Fq 'FROM oven/bun:1.3.11@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7 AS bun-runtime' "$DOCKERFILE" || \
    fail 'Bun base image is not pinned to the approved digest'
grep -Fq 'FROM node:20@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5 AS deps' "$DOCKERFILE" || \
    fail 'Node build image is not pinned to the approved digest'
grep -Fq 'FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runner' "$DOCKERFILE" || \
    fail 'Node runtime image is not pinned to the approved digest'
grep -Fq 'COPY packages/happy-app ./packages/happy-app' "$DOCKERFILE" || \
    fail 'branded app source is absent from the image build'
grep -Fq 'COPY packages/happy-server-self-host/scripts packages/happy-server-self-host/scripts' "$DOCKERFILE" || \
    fail 'self-host install scripts are absent from the dependency stage'

grep -Fq -- '--filter happy-server-self-host...' "$DOCKERFILE" || \
    fail 'dependency install is not scoped to the self-host server graph'
grep -Fq -- '--filter happy-server...' "$DOCKERFILE" || \
    fail 'dependency install omits the API server graph'
grep -Fq -- '--filter happy-app...' "$DOCKERFILE" || \
    fail 'dependency install omits the bundled Web application graph'
grep -Fq -- 'pnpm --filter happy-server --fail-if-no-match generate' "$DOCKERFILE" || \
    fail 'Docker build does not generate Prisma from the copied API schema'

grep -Fq 'bundle:webapp' "$DOCKERFILE" || fail 'Web bundle is not built into the server image'
grep -Fq 'happy-server-self-host --fail-if-no-match build' "$DOCKERFILE" || \
    fail 'self-host package is not compiled into a standalone runtime'
grep -Fq "args.push('--external', dependency)" \
    "$ROOT/server/packages/happy-server-self-host/scripts/build-runtime.cjs" || \
    fail 'self-host runtime does not externalize its declared dependencies'
grep -Fq 'fs.cpSync(prismaSource, prismaTarget, { recursive: true })' \
    "$ROOT/server/packages/happy-server-self-host/scripts/build-runtime.cjs" || \
    fail 'self-host runtime does not copy the Prisma schema and migrations'
grep -Fq 'PRISMA_QUERY_ENGINE_LIBRARY=/repo/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node' "$DOCKERFILE" || \
    fail 'standalone runtime does not identify its native Prisma engine'
grep -Fq 'node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node' "$DOCKERFILE" || \
    fail 'standalone runtime does not contain its native Prisma engine'
grep -Fq 'COPY --from=builder /repo/packages/happy-server-self-host /repo/packages/happy-server-self-host' "$DOCKERFILE" || \
    fail 'runtime image does not contain the built self-host package'
grep -Fq 'HEALTHCHECK' "$DOCKERFILE" || fail 'runtime image has no container healthcheck'
grep -Fq 'org.opencontainers.image.revision' "$DOCKERFILE" || fail 'image has no source revision label'
grep -Fq 'org.happyherd.brand.sha256' "$DOCKERFILE" || fail 'image has no brand provenance label'
grep -Fq 'assert-origin-main.sh' "$ROOT/scripts/build-release-image.sh" || \
    fail 'release image builder does not require HEAD to equal live origin/main'
grep -Fq '@sha256:[0-9a-f]{64}' "$ROOT/scripts/smoke-release-image.sh" || \
    fail 'smoke runner does not reject mutable image references'
grep -Fq 'docker volume create' "$ROOT/scripts/smoke-release-image.sh" || \
    fail 'smoke runner does not provision writable Docker-managed state'
grep -Fq 'RUNTIME_WEBAPP_PATH="/repo/packages/happy-server-self-host/webapp/index.html"' \
    "$ROOT/scripts/smoke-release-image.sh" || \
    fail 'smoke runner does not verify the bundled Web application at the runtime package path'

printf 'Release image contract tests passed.\n'
