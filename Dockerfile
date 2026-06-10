# Stage 1: Cache modules and transpilation artifacts
#
# Policy: prefer glibc-based images for networked apps (Service DNS, CouchDB client).
FROM dhi.io/deno:2.8.2-dev@sha256:5b377717ac37ee032d4ccc0ac90a0fc57579897477f88c4aced360008f05feb8 AS builder

WORKDIR /app
ENV DENO_DIR=/deno-dir \
  DENO_NO_UPDATE_CHECK=1 \
  DENO_NO_PROMPT=1

# Copy manifests first for better layer reuse.
COPY deno.jsonc ./

# Copy runtime sources (submodule `lib/` is required for import resolution).
COPY main.ts Hub.ts Peer.ts PeerCouchDB.ts PeerStorage.ts types.ts util.ts ./
COPY stubs ./stubs
COPY lib ./lib

# Patch bare JSON imports in the lib submodule to add the import attribute
# required by Deno 2.x (upstream uses Obsidian's bundler which handles this).
RUN find lib/src/common/messages/ -name '*.ts' \
  -exec sed -i 's/from "\(.*\.json\)";/from "\1" with { type: "json" };/g' {} +

# Install npm deps and cache all modules.
RUN deno install --allow-import \
  && deno cache --allow-import main.ts \
  && mkdir -p /app/data /app/dat

# Stage 2: Runtime
FROM dhi.io/deno:2.8.2@sha256:f5dd8eac871389d380e5b6b7c5ef9064321016f6fd09e5edea830a4b2bc48053

WORKDIR /app
ENV DENO_DIR=/deno-dir \
  DENO_NO_UPDATE_CHECK=1 \
  DENO_NO_PROMPT=1

COPY --from=builder --chown=1000:1000 /deno-dir /deno-dir
COPY --from=builder --chown=1000:1000 /app/node_modules /app/node_modules
COPY --from=builder --chown=1000:1000 /app/deno.jsonc /app/
COPY --from=builder --chown=1000:1000 /app/main.ts /app/Hub.ts /app/Peer.ts /app/PeerCouchDB.ts /app/PeerStorage.ts /app/types.ts /app/util.ts /app/
COPY --from=builder --chown=1000:1000 /app/stubs /app/stubs
COPY --from=builder --chown=1000:1000 /app/lib /app/lib

VOLUME /app/dat
VOLUME /app/data

USER 1000:1000

CMD ["deno", "run", "--cached-only", "--no-lock", "-A", "main.ts"]
