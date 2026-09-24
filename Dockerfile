# Stage 1: install dependencies and bundle the bridge.
ARG NODE_BUILDER_IMAGE=dhi.io/node:26.10.0-alpine3.24-dev@sha256:ff2c07e1681b1bcf1747b55ed54b900a327602a37975fb77487e2f795e822dfd
ARG NODE_RUNTIME_IMAGE=dhi.io/node:26.10.0-alpine3.24@sha256:f8d430e62687225dfa5a4b2033da9ca6b34285cb3e5aff6da80fda9e88987d7c

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
EXPOSE 8080

USER node

CMD ["node", "dist/main.js"]
