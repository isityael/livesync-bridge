# Stage 1: Cache modules and transpilation artifacts
#
# Policy: prefer glibc-based images for networked apps (Service DNS, CouchDB client).
FROM harbor.m0sh1.cc/dhi/deno:2.7.1-dev@sha256:ff9db70c147d5989e612e3ca8ac70ae5f4606ccf5563d1935a21636935d0b740 AS builder

WORKDIR /app
ENV DENO_DIR=/deno-dir \
  DENO_NO_UPDATE_CHECK=1 \
  DENO_NO_PROMPT=1

# Copy manifests first for better layer reuse.
COPY deno.jsonc deno.lock ./

# Copy runtime sources (submodule `lib/` is required for import resolution).
COPY main.ts Hub.ts Peer.ts PeerCouchDB.ts PeerStorage.ts types.ts util.ts ./
COPY lib ./lib

# Install npm deps from lock file, then cache all modules.
RUN deno install --allow-import --frozen --lock=deno.lock \
  && deno cache --allow-import --frozen --lock=deno.lock main.ts \
  && mkdir -p /app/data /app/dat

# Stage 2: Runtime
FROM harbor.m0sh1.cc/dhi/deno:2.7.1@sha256:096f2cccb6950623b1a2c622c9d98c5520c98509da9e589ec44962b0e579c7d8

WORKDIR /app
ENV DENO_DIR=/deno-dir \
  DENO_NO_UPDATE_CHECK=1 \
  DENO_NO_PROMPT=1

COPY --from=builder --chown=1000:1000 /deno-dir /deno-dir
COPY --from=builder --chown=1000:1000 /app/node_modules /app/node_modules
COPY --from=builder --chown=1000:1000 /app/deno.jsonc /app/deno.lock /app/
COPY --from=builder --chown=1000:1000 /app/main.ts /app/Hub.ts /app/Peer.ts /app/PeerCouchDB.ts /app/PeerStorage.ts /app/types.ts /app/util.ts /app/
COPY --from=builder --chown=1000:1000 /app/lib /app/lib

VOLUME /app/dat
VOLUME /app/data

USER 1000:1000

CMD ["deno", "run", "--cached-only", "-A", "main.ts"]
# rebuilt with buildx + signing 2026-02-22
