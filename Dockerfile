# Stage 1: install dependencies and bundle the bridge.
#
# Policy: prefer glibc-based images for networked apps (Service DNS, CouchDB client).
ARG NODE_IMAGE=dhi.io/node:26.3.0-debian13-dev@sha256:c728b507f13a8fc9510cc1ae64359b2d047584f7bf1c643e2d2a524881becd88

FROM ${NODE_IMAGE} AS builder

WORKDIR /app
ENV NODE_ENV=development \
  npm_config_audit=false \
  npm_config_fund=false

# Copy manifests first for better layer reuse.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# Copy runtime sources (submodule `lib/` is required for import resolution).
COPY scripts ./scripts
COPY runtime ./runtime
COPY stubs ./stubs
COPY types ./types
COPY lib ./lib
COPY main.ts Hub.ts Peer.ts PeerCouchDB.ts PeerStorage.ts types.ts util.ts ./

RUN npm run build \
  && mkdir -p /app/data /app/dat

# Stage 2: runtime
FROM ${NODE_IMAGE}

WORKDIR /app
ENV LSB_STATE_DIR=/app/dat \
  NODE_ENV=production

COPY --from=builder --chown=node:node /app/dist /app/dist
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json /app/

RUN mkdir -p /app/data /app/dat \
  && chown -R node:node /app

VOLUME /app/dat
VOLUME /app/data

USER node

CMD ["node", "dist/main.js"]
