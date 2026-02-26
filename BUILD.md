# livesync-bridge - Custom DHI Build

Patched fork of [vrtmrz/livesync-bridge](https://github.com/vrtmrz/livesync-bridge) for
CouchDB ↔ filesystem bidirectional sync (Obsidian LiveSync ↔ Basic Memory).

## Patches Applied

1. **Removed `trystero` import** from `deno.jsonc` — P2P/Nostr replication not needed;
   the bgWorker is already mocked in the import map.
2. **Custom Dockerfile** using DHI hardened Deno images with `--allow-import` flag
   (required by Deno 2.6.9's stricter import policy).

## Build

Uses the shared build pipeline from `tools/ci/build-sign-push.fish`.

```bash
# From the infra repo root:

# Build only (local validation)
tools/ci/build-sign-push.fish \
  -n livesync-bridge \
  -c tools/cli/docker/livesync-bridge \
  -t v0.1.13 \
  -p linux/amd64

# Build + push + sign + attest (full supply chain)
tools/ci/build-sign-push.fish \
  -n livesync-bridge \
  -c tools/cli/docker/livesync-bridge \
  -t v0.1.13 \
  -p linux/amd64 \
  --push --latest
```

## Base Images

- Builder: `harbor.m0sh1.cc/dhi/deno:2.7.1-dev` (root, Debian 13)
- Runtime: `harbor.m0sh1.cc/dhi/deno:2.7.1` (non-root, Debian 13)

## Upstream

Cloned with `git clone --recurse-submodules https://github.com/vrtmrz/livesync-bridge.git`.
The `lib/` directory is the `livesync-commonlib` submodule.
