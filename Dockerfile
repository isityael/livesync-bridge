# Stage 1: Cache modules and transpilation artifacts
#
# Policy: prefer glibc-based images for networked apps (Service DNS, CouchDB client).
FROM harbor.m0sh1.cc/dhi/deno:2.7.4-dev@sha256:1c0fbab3c21d0574e19966f77f0acebc474ef77ee38b782213f5fc47beff9976 AS builder

WORKDIR /app
ENV DENO_DIR=/deno-dir \
  DENO_NO_UPDATE_CHECK=1 \
  DENO_NO_PROMPT=1

# Copy manifests first for better layer reuse.
COPY deno.jsonc deno.lock ./

# Copy runtime sources (submodule `lib/` is required for import resolution).
COPY main.ts Hub.ts Peer.ts PeerCouchDB.ts PeerStorage.ts types.ts util.ts ./
COPY stubs ./stubs
COPY lib ./lib

# Patch bare JSON imports in the lib submodule to add the import attribute
# required by Deno 2.x (upstream uses Obsidian's bundler which handles this).
RUN find lib/src/common/messages/ -name '*.ts' \
  -exec sed -i 's/from "\(.*\.json\)";/from "\1" with { type: "json" };/g' {} +

# Install npm deps from lock file, then cache all modules.
RUN deno install --allow-import --frozen --lock=deno.lock \
  && deno cache --allow-import --frozen --lock=deno.lock main.ts \
  && mkdir -p /app/data /app/dat

# Stage 2: Runtime
FROM harbor.m0sh1.cc/dhi/deno:2.7.4@sha256:38d563303129c702a18c14215e1e26066269fd46a074d431cb59efd56dd46fc0

WORKDIR /app
ENV DENO_DIR=/deno-dir \
  DENO_NO_UPDATE_CHECK=1 \
  DENO_NO_PROMPT=1

COPY --from=builder --chown=1000:1000 /deno-dir /deno-dir
COPY --from=builder --chown=1000:1000 /app/node_modules /app/node_modules
COPY --from=builder --chown=1000:1000 /app/deno.jsonc /app/deno.lock /app/
COPY --from=builder --chown=1000:1000 /app/main.ts /app/Hub.ts /app/Peer.ts /app/PeerCouchDB.ts /app/PeerStorage.ts /app/types.ts /app/util.ts /app/
COPY --from=builder --chown=1000:1000 /app/stubs /app/stubs
COPY --from=builder --chown=1000:1000 /app/lib /app/lib

VOLUME /app/dat
VOLUME /app/data

USER 1000:1000

CMD ["deno", "run", "--cached-only", "-A", "main.ts"]
# rebuilt with buildx + signing 2026-02-22
