# Stage 1: Cache modules and transpilation artifacts
#
# Policy: prefer glibc-based images for networked apps (Service DNS, CouchDB client).
FROM harbor.m0sh1.cc/dhi/deno:2.6.10-dev@sha256:de7269a9b492638e8e9bdfbee16d1b8825056f1de2111f6f090d283e38dd60e3 AS builder

WORKDIR /app
ENV DENO_DIR=/deno-dir \
    DENO_NO_UPDATE_CHECK=1 \
    DENO_NO_PROMPT=1

# Copy manifests first for better layer reuse.
COPY deno.jsonc deno.lock ./

# Copy runtime sources (submodule `lib/` is required for import resolution).
COPY main.ts Hub.ts Peer.ts PeerCouchDB.ts PeerStorage.ts types.ts util.ts ./
COPY lib ./lib

# Note: --allow-import required by Deno 2.6.8+ for stricter import policy.
RUN deno cache --allow-import --frozen --lock=deno.lock main.ts \
  && mkdir -p /app/data /app/dat

# Stage 2: Runtime
FROM harbor.m0sh1.cc/dhi/deno:2.6.10@sha256:1a37225c2e1d91593ea62f930a5a98088f8c71e5bf80e453a555b1fcc6ea7318

WORKDIR /app
ENV DENO_DIR=/deno-dir \
    DENO_NO_UPDATE_CHECK=1 \
    DENO_NO_PROMPT=1

COPY --from=builder --chown=1000:1000 /deno-dir /deno-dir
COPY --from=builder --chown=1000:1000 /app/deno.jsonc /app/deno.lock /app/
COPY --from=builder --chown=1000:1000 /app/main.ts /app/Hub.ts /app/Peer.ts /app/PeerCouchDB.ts /app/PeerStorage.ts /app/types.ts /app/util.ts /app/
COPY --from=builder --chown=1000:1000 /app/lib /app/lib

VOLUME /app/dat
VOLUME /app/data

USER 1000:1000

CMD ["deno", "run", "--cached-only", "-A", "main.ts"]
# rebuilt with buildx + signing 2026-02-22
