# Standalone happyherd-server: single container, no external dependencies
# Uses PGlite (embedded Postgres), local filesystem storage, no Redis

# Stage 1: install the dependencies needed by the self-host server and Web app.
FROM oven/bun:1.3.11 AS bun-runtime
FROM node:20 AS deps

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

RUN apt-get update && apt-get install -y python3 make g++ build-essential && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts ./scripts
COPY patches ./patches

RUN mkdir -p packages/happyherd-app packages/happyherd-server packages/happyherd-server-self-host packages/happyherd-cli packages/happyherd-control-agent packages/happyherd-wire

COPY packages/happyherd-app/package.json packages/happyherd-app/
COPY packages/happyherd-server/package.json packages/happyherd-server/
COPY packages/happyherd-server-self-host/package.json packages/happyherd-server-self-host/
COPY packages/happyherd-cli/package.json packages/happyherd-cli/
# pnpm packs injected workspace dependencies during this filtered install, so
# their lifecycle builds need the same source inputs that invalidate this layer.
COPY packages/happyherd-control-agent packages/happyherd-control-agent
COPY packages/happyherd-wire packages/happyherd-wire

# Workspace postinstall requirements
COPY packages/happyherd-app/patches packages/happyherd-app/patches
COPY packages/happyherd-app/scripts/setup-pdfjs-web.mjs packages/happyherd-app/scripts/setup-pdfjs-web.mjs
COPY packages/happyherd-server/prisma packages/happyherd-server/prisma
COPY packages/happyherd-server-self-host/scripts packages/happyherd-server-self-host/scripts
COPY packages/happyherd-cli/scripts packages/happyherd-cli/scripts
COPY packages/happyherd-cli/tools packages/happyherd-cli/tools

RUN SKIP_HAPPYHERD_WIRE_BUILD=1 pnpm \
    --filter happyherd-server-self-host... \
    --filter happyherd-server... \
    --filter happyherd-app... \
    install --frozen-lockfile

# Stage 2: build the API and the branded Web client served by that API.
FROM deps AS builder

ARG HAPPYHERD_PUBLIC_URL=https://happyherd.example.com
ARG HAPPYHERD_REPOSITORY_DISPLAY=
ARG HAPPYHERD_REPOSITORY_URL=
ARG HAPPYHERD_ISSUE_URL=
ARG HAPPYHERD_SUPPORT_URL=

ENV APP_ENV=production
ENV CI=1
ENV EXPO_NO_TELEMETRY=1
ENV EXPO_PUBLIC_HAPPYHERD_SERVER_URL=$HAPPYHERD_PUBLIC_URL
ENV EXPO_PUBLIC_HAPPYHERD_REPOSITORY_DISPLAY=$HAPPYHERD_REPOSITORY_DISPLAY
ENV EXPO_PUBLIC_HAPPYHERD_REPOSITORY_URL=$HAPPYHERD_REPOSITORY_URL
ENV EXPO_PUBLIC_HAPPYHERD_ISSUE_URL=$HAPPYHERD_ISSUE_URL
ENV EXPO_PUBLIC_HAPPYHERD_SUPPORT_URL=$HAPPYHERD_SUPPORT_URL

COPY packages/happyherd-app ./packages/happyherd-app
COPY packages/happyherd-cli ./packages/happyherd-cli
COPY packages/happyherd-wire ./packages/happyherd-wire
COPY packages/happyherd-server ./packages/happyherd-server
COPY packages/happyherd-server-self-host ./packages/happyherd-server-self-host

RUN pnpm --filter @happyherd/wire --fail-if-no-match build
RUN pnpm --filter happyherd-server --fail-if-no-match generate
RUN pnpm --filter happyherd-server-self-host --fail-if-no-match build
RUN pnpm --filter happyherd-server-self-host --fail-if-no-match bundle:webapp

# Stage 3: runtime
FROM node:20-slim AS runner

ARG HAPPYHERD_SOURCE_SHA=unknown
ARG HAPPYHERD_SOURCE_URL=https://example.com/happyherd
ARG HAPPYHERD_CREATED=unknown
ARG HAPPYHERD_VERSION=dev

LABEL org.opencontainers.image.title="HappyHerd" \
      org.opencontainers.image.description="HappyHerd self-host server and branded Web client" \
      org.opencontainers.image.source="$HAPPYHERD_SOURCE_URL" \
      org.opencontainers.image.revision="$HAPPYHERD_SOURCE_SHA" \
      org.opencontainers.image.created="$HAPPYHERD_CREATED" \
      org.opencontainers.image.version="$HAPPYHERD_VERSION"

WORKDIR /repo/packages/happyherd-server-self-host

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PGLITE_DIR=/data/pglite
ENV PRISMA_QUERY_ENGINE_LIBRARY=/repo/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node

COPY --from=builder /repo/node_modules /repo/node_modules
COPY --from=builder /repo/packages/happyherd-server-self-host /repo/packages/happyherd-server-self-host

# Persistent storage is mounted explicitly by the deployment environment at
# /data. Do not declare a Docker VOLUME here: managed builders such as Railway
# reject image-owned volumes, while Docker operators already pass `-v ...:/data`.
EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl --fail --silent --show-error http://127.0.0.1:3005/health >/dev/null || exit 1

CMD ["sh", "-c", "node bin/happyherd-server.cjs migrate && exec node bin/happyherd-server.cjs serve"]
