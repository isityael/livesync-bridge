# Stage 1: install dependencies and bundle the bridge.
ARG NODE_BUILDER_IMAGE=dhi.io/node:26.5.0-alpine3.24-dev@sha256:7baafaf015c3e137546e0b001fbc2f3f3e0d6de3ad06d1e702fcb744302107e4
ARG NODE_RUNTIME_IMAGE=dhi.io/node:26.5.0-alpine3.24@sha256:54bbd76f445f53dda9ecc0f303e7f1e31a2c8ea96639fbb138621aeb8ff4d9a4

FROM ${NODE_BUILDER_IMAGE} AS builder

WORKDIR /app
ENV NODE_ENV=development

# Copy manifests first for better layer reuse.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
RUN corepack enable \
  && pnpm install --frozen-lockfile --ignore-scripts

# Copy runtime sources (submodule `lib/` is required for import resolution).
COPY scripts ./scripts
COPY runtime ./runtime
COPY stubs ./stubs
COPY types ./types
COPY lib ./lib
COPY main.ts Hub.ts Peer.ts PeerCouchDB.ts PeerStorage.ts types.ts util.ts ./

RUN pnpm run build \
  && mkdir -p /app/data /app/dat

# Stage 2: runtime
FROM ${NODE_RUNTIME_IMAGE}

WORKDIR /app
ENV LSB_STATE_DIR=/app/dat \
  NODE_ENV=production

COPY --from=builder --chown=node:node /app/dist /app/dist
COPY --from=builder --chown=node:node /app/package.json /app/pnpm-lock.yaml /app/
COPY --from=builder --chown=node:node /app/dat /app/dat
COPY --from=builder --chown=node:node /app/data /app/data

VOLUME /app/dat
VOLUME /app/data

USER node

CMD ["node", "dist/main.js"]
