# Standalone happy-server: single container, no external dependencies
# Uses PGlite (embedded Postgres), local filesystem storage, no Redis

# Stage 1: install dependencies. Every base is pinned to an immutable manifest
# digest so rebuilding a source revision cannot silently change the toolchain.
FROM oven/bun:1.3.11@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7 AS bun-runtime
FROM node:20@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5 AS deps

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

RUN apt-get update && apt-get install -y python3 make g++ build-essential && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts ./scripts
COPY patches ./patches

RUN mkdir -p packages/happy-app packages/happy-server packages/happy-server-self-host packages/happy-cli packages/happy-agent packages/happy-wire

COPY packages/happy-app/package.json packages/happy-app/
COPY packages/happy-server/package.json packages/happy-server/
COPY packages/happy-server-self-host/package.json packages/happy-server-self-host/
COPY packages/happy-cli/package.json packages/happy-cli/
COPY packages/happy-agent/package.json packages/happy-agent/
COPY packages/happy-wire/package.json packages/happy-wire/

# Workspace postinstall requirements
COPY packages/happy-app/patches packages/happy-app/patches
COPY packages/happy-server/prisma packages/happy-server/prisma
COPY packages/happy-cli/scripts packages/happy-cli/scripts
COPY packages/happy-cli/tools packages/happy-cli/tools

RUN SKIP_HAPPY_WIRE_BUILD=1 pnpm install --frozen-lockfile

# Stage 2: build the API and the branded Web client served by that API.
FROM deps AS builder

ARG HAPPYHERD_PUBLIC_URL=https://happyherd.gehirn.ai

ENV APP_ENV=production
ENV CI=1
ENV EXPO_NO_TELEMETRY=1
ENV EXPO_PUBLIC_HAPPY_SERVER_URL=$HAPPYHERD_PUBLIC_URL

COPY packages/happy-app ./packages/happy-app
COPY packages/happy-cli ./packages/happy-cli
COPY packages/happy-wire ./packages/happy-wire
COPY packages/happy-server ./packages/happy-server
COPY packages/happy-server-self-host ./packages/happy-server-self-host

RUN pnpm --filter @slopus/happy-wire --fail-if-no-match build
RUN pnpm --filter happy-server-self-host --fail-if-no-match build
RUN pnpm --filter happy-server-self-host --fail-if-no-match bundle:webapp

# Stage 3: runtime
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runner

ARG HAPPYHERD_SOURCE_SHA=unknown
ARG HAPPYHERD_SOURCE_URL=https://github.com/NickGuAI/HappyHerd
ARG HAPPYHERD_CREATED=unknown
ARG HAPPYHERD_VERSION=dev
ARG HAPPYHERD_BRAND_SHA256=unknown

LABEL org.opencontainers.image.title="HappyHerd" \
      org.opencontainers.image.description="HappyHerd self-host server and branded Web client" \
      org.opencontainers.image.source="$HAPPYHERD_SOURCE_URL" \
      org.opencontainers.image.revision="$HAPPYHERD_SOURCE_SHA" \
      org.opencontainers.image.created="$HAPPYHERD_CREATED" \
      org.opencontainers.image.version="$HAPPYHERD_VERSION" \
      ai.gehirn.happyherd.brand.sha256="$HAPPYHERD_BRAND_SHA256"

WORKDIR /repo/packages/happy-server-self-host

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PGLITE_DIR=/data/pglite
ENV PRISMA_QUERY_ENGINE_LIBRARY=/repo/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node

COPY --from=builder /repo/node_modules /repo/node_modules
COPY --from=builder /repo/packages/happy-server-self-host /repo/packages/happy-server-self-host

VOLUME /data
EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl --fail --silent --show-error http://127.0.0.1:3005/health >/dev/null || exit 1

CMD ["sh", "-c", "node bin/happy-server.cjs migrate && exec node bin/happy-server.cjs serve"]
