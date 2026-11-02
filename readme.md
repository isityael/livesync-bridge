# LiveSync Bridge

## m0sh1.cc fork

This Forgejo-first fork is maintained for the m0sh1.cc self-hosted LiveSync
tooling stack. The canonical repository is
`https://git.m0sh1.cc/isityael/livesync-bridge`; GitHub is maintained as a public
push mirror at `https://github.com/isityael/livesync-bridge`.

![screenshot](https://github.com/vrtmrz/livesync-bridge/assets/45774780/457f8909-14e4-4d86-bcf9-24fad7d3342a)

## What is this?

This is a custom replicator between Self-hosted LiveSync remote vaults and
storage. **The Unified Version of filesystem-livesync and livesync-classroom**.

A Vault or storage can be synchronised with vaults or storage. You can even combine them. Of course, different passphrases for each vault could be used.
And, you can synchronize documents under the specified folder on the vault, to another vault's specified one.

Of course, it is multi-directional!

# How to use

## Prerequisites

- [Node.js 26](https://nodejs.org/) and PNPM 12.6.0 via Corepack are required.

## Simply run

1. Clone the GitHub Repository

```git
git clone --recursive https://github.com/isityael/livesync-bridge
```

2. Open the config file dat/config.sample.json, edit and save to
   dat/config.json. (You do not have to worry, the sample is in the following
   section).
3. Simply run like this.

```bash
$ corepack enable
$ pnpm install --frozen-lockfile
$ pnpm run build
$ pnpm start
```

Note: If you want to scan all storage and databases from the beginning, please run with `--reset`.

CouchDB resume positions are saved separately for each peer name, `baseDir`,
server URL (including any proxy path), and database name. Credentials are not
part of this identity. Existing checkpoints without a remote identity are not
reused, so the first connection after upgrading reads remote changes from the
beginning. Keep the Deno `localStorage` data to retain resume positions across
restarts.

# Docker Instructions

1. Clone the GitHub Repository

```git
git clone --recursive https://github.com/isityael/livesync-bridge
```

2. Open the config file dat/config.sample.json, edit and save to
   dat/config.json. (The storage folder has to start with "data/" to be in the volume)

3. Simply run like this.

```bash
docker compose up -d
```

New container releases are published privately to
`git.m0sh1.cc/m0sh1-internal/livesync-bridge` by Woodpecker. Tag builds validate
once, build a candidate with provenance and an SBOM, block HIGH/CRITICAL
vulnerabilities with fixes available, and sign the candidate before promoting
release, SHA and `latest` tags. The GitHub mirror does not publish images.
Existing GHCR images are retained for recovery; they are not refreshed.

The publisher requires Woodpecker secrets `forgejo_package_username` and
`forgejo_package_token` with package write access to the private `m0sh1-internal`
organization. Existing DHI and Cosign secrets remain required. Consumers must
authenticate to Forgejo with package read access.

## Health and recovery

`GET /healthz` listens on port `8080` by default. Set `LSB_HEALTH_PORT` to
change the port. Kubernetes startup, readiness, and liveness probes may use the
same path: only `healthy` returns HTTP 200; `startup`, `stale`, and `unhealthy`
return HTTP 503. The response includes phase, checkpoint and remote-activity
times, conflict count, and replay state, but never credentials or note content.

Persist `LSB_STATE_DIR` across restarts. Malformed state is quarantined and
forces a full remote replay before local tombstones can be sent. Replay and
watch callbacks are processed durably in sequence; a failed destination write
does not advance the checkpoint. Each CouchDB destination has its own confirmed
baseline and per-checkpoint tombstone budget. Additional controls are:

- `LSB_MAX_CONSECUTIVE_FAILURES` (default `3`)
- `LSB_RETRY_DELAY_MS` (default `10000`)
- `LSB_STALE_AFTER_MS` (default `300000`)
- `LSB_MAX_TOMBSTONES_PER_CHECKPOINT` (default `10`)

# Configuration

The configuration file consists of the following structure. The basic example
below leaves hidden-file synchronisation disabled. To opt in, see
[Synchronising internal/hidden files](#synchronising-internalhidden-files).

```jsonc
{
  "peers": [
    {
      "type": "couchdb", // Type should be `couchdb or storage`
      "name": "test1", // Should be unique
      "group": "main", // we can omit this.
      "database": "test",
      "username": "admin",
      "password": "password",
      "url": "http://localhost:5984",
      "customChunkSize": 100,
      "minimumChunkSize": 20,
      "passphrase": "passphrase", // E2EE passphrase, if you do not enabled, leave it blank.
      "obfuscatePassphrase": "passphrase", // Path obfuscation passphrase, if you do not enabled, leave it blank. if enabled, set the same value of passphrase.
      "baseDir": "blog/", // Sharing folder
      "useRemoteTweaks": true, // Overwrite customChunkSize or minimumChunkSize, and check configuration matches
    },
    {
      "type": "couchdb",
      "name": "test2", // We can even synchronise the same databases as long as they have different names in here.
      "group": "main", // we can omit this.
      "database": "test2",
      "username": "admin",
      "passphrase": "passphrase",
      "password": "password",
      "url": "http://localhost:5984",
      "customChunkSize": 100,
      "minimumChunkSize": 20,
      "obfuscatePassphrase": "passphrase",
      "baseDir": "xxxx/",
    },
    {
      "type": "storage",
      "name": "storage-test1",
      "group": "main", // we can omit this.
      "baseDir": "./vault/", // The folder which have been synchronised.
      "processor": {
        // The processor configuration. You can omit this.
        "cmd": "script/test.sh", // The programme which run at file modification or deletion.
        "args": ["$filename", "$mode"],
        // The modified file is set to $filename. The mode is set to `deleted` or `modified`.
        // $filename and $mode have been set also in environment variables.
      },
      "scanOfflineChanges": true,
      "useChokidar": true, // Node runtime uses chokidar for filesystem watching.
    },
  ],
}
```

## Filesystem watcher limitations

The upstream Deno runtime uses `Deno.watchFs` by default. This fork uses Node and Chokidar; upstream setting `useChokidar` to `true`
selects Chokidar instead.

On Windows, renaming a watched directory containing subdirectories can fail
with an access-denied error when Chokidar uses its default event-based watching.
This includes changing only the letter case of a directory name and moving it
to another name in the same parent directory. This restriction affects normal use while the bridge is
running, including filesystem operations initiated outside the bridge.
Treat these directory-tree renames as unsupported with Chokidar's default
watching mode on Windows.

Chokidar also offers polling through the `CHOKIDAR_USEPOLLING=true` environment
variable. This periodically checks filesystem state and can increase CPU use.
Its behaviour for these directory renames has not been verified in the bridge
on Windows. See the [Chokidar 3.6 options](https://github.com/paulmillr/chokidar/blob/3.6.0/README.md#performance)
for the polling intervals and other trade-offs.

See the [upstream Chokidar report](https://github.com/paulmillr/chokidar/issues/1380)
and Microsoft's [directory rename constraints](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information).
The default `Deno.watchFs` backend can report a directory being created or
renamed without reporting changes to files inside it. A file written
immediately after its directory is created, or a child file at its new path
after an ordinary or case-only directory rename, can therefore be missed while the
bridge is running. These behaviours were reproducible on Linux before the
internal-file synchronisation change. Switching to Chokidar does not guarantee
that all child-event gaps are resolved; its Windows directory-rename
restriction is described above.

## Vaults with an ID key

Recent versions of Self-hosted LiveSync derive chunk IDs and obfuscated document IDs from a separate ID key. New vaults with E2EE get a random ID key by default. The bridge needs the same key, or the plugin cannot read the files the bridge writes. It then reports that not all files could be synchronised.

Copy the key on any device with **Show current recovery code** in the plugin settings, and set it as `idDerivationKey`:

```jsonc
{
  "type": "couchdb",
  "name": "test1",
  // ...
  "passphrase": "passphrase",
  "obfuscatePassphrase": "passphrase",
  "idDerivationKey": "sls-id-v1:0123...cdef", // The recovery code, or the 64-character hex key on its own
  "useRemoteTweaks": true,
}
```

With a key configured, the bridge uses ID derivation version 1 unless `idDerivationVersion` says otherwise. Keep the key private, like the passphrase.

## Synchronising internal/hidden files

This fork includes the bidirectional routing change; it remains opt-in.

Hidden-file synchronisation is optional and disabled by default. For each
CouchDB peer, `includeInternal` enables synchronisation only for matching hidden
files, in both directions. Omit the field or use `[]` to keep it disabled.

Self-hosted LiveSync stores internal documents with an `i:` prefix. The bridge
supports hidden files whose first Vault-root path component begins with a dot,
such as `.claude/settings.json` or `.settings.json`.

Set `includeInternal` to an array of
[minimatch](https://github.com/isaacs/minimatch) glob patterns matched against the
complete Vault-root path after removing the `i:` prefix. The following example
enables synchronisation for `.claude/` only:

```jsonc
{
  "type": "couchdb",
  "name": "test1",
  // ...
  "baseDir": "blog/",
  "includeInternal": [".claude/**"], // Share selected .claude files in both directions
}
```

A hidden file is included when its path matches any pattern. Patterns use the
`dot` option, so hidden subdirectories are matched too. A broad pattern such as
`**` still leaves ordinary notes on their ordinary route. Other internal paths,
such as `i:note.md`, are outside this feature.

Internal paths are relative to the Vault root, independently of `baseDir`.
The example selects ordinary documents below `blog/` and internal files below
`.claude/` at the Vault root. The internal document
`i:.claude/settings.json` maps to `.claude/settings.json` below the storage
peer's root. Local creation, edits, and deletion use that same internal document
on the return route, including after restart.

Each CouchDB peer applies its own `includeInternal` patterns in both directions.
Opting one peer in does not enable another peer. Each Obsidian client that
should synchronise these files also needs hidden-file synchronisation enabled
in its own LiveSync settings. An excluded hidden file has no ordinary fallback
route. Storage peers' sending exclusions remain separate; see
[Excluding paths from a storage peer](#excluding-paths-from-a-storage-peer).

On CouchDB peers, shared paths beginning with a dot are reserved for this
internal route. Ordinary documents such as `blog/.claude/settings.json` are
excluded, and a hidden Vault-root folder cannot serve as an ordinary sharing
folder. Before using an internal path, the bridge checks for a live ordinary
document at `baseDir` joined with that shared path. If one exists, the bridge
reports both paths and blocks the internal operation, preserving both documents
and any existing storage file. A failed collision check also blocks the
operation. A deleted ordinary document does not block it. The bridge does not
merge, migrate, or delete conflicting documents automatically.

Changing `includeInternal` or resolving a collision does not replay previously
skipped changes. A later source change can trigger synchronisation. To rescan
existing files, restart with `--reset`; this clears the stored scan and resume
state for all peers.

> [!CAUTION]
> This synchronises files that are normally hidden and internal. Such folders often hold tool configuration that can contain machine-specific paths, local settings, or secrets. Only include patterns you genuinely intend to share, and review what they match before enabling. The option is opt-in: leave it out to keep the default behaviour, where all internal/hidden files are skipped.

## Excluding paths from a storage peer

By default a storage peer synchronises every file below its `baseDir`. The
optional `ignore` field on a storage peer excludes paths from that. It takes an
array of [minimatch](https://github.com/isaacs/minimatch) glob patterns which
are matched against the path relative to `baseDir`:

```jsonc
{
  "type": "storage",
  "name": "storage-test1",
  "baseDir": "./vault/",
  "ignore": ["**/.git/**", "node_modules/**", "**/*.tmp"],
}
```

A path is excluded when it, or any directory containing it, matches any one of
the patterns. Patterns are matched with the `dot` option, so leading-dot folders
such as `.git/` are matched as expected. A pattern ending in `/**` also covers
the directory itself, so `**/.git/**` excludes `.git` as well as everything
inside it. Likewise, a pattern which matches a directory's name excludes
everything below that directory: `private` excludes `private/note.md`, and
`**/*.tmp` excludes the contents of a directory named `cache.tmp`.

Excluded directories are pruned while scanning: they are not descended into, and
nothing inside them is inspected or read. This matters for `scanOfflineChanges`,
because a repository such as `.git/` can hold tens of thousands of files which
would otherwise all be examined at every start. Excluded paths are also skipped
for live additions, changes and deletions.

Note that `ignore` only stops a storage peer from _sending_ its own changes.
Incoming changes from other peers are still accepted: a file which another peer
sends is still written, and a deletion which another peer sends is still
applied, even at an excluded path.

## Realistic example

| name                       | database_uri / path                       | CouchDB username | CouchDB password | vault E2EE passphrase | baseDir  |
| -------------------------- | ----------------------------------------- | ---------------- | ---------------- | --------------------- | -------- |
| private vault of Cornbread | http://localhost:5984/classroom_cornbread | cornbread        | tackle           | glucose               | shared/  |
| shared vault               | http://localhost:5984/classroom_shared    | common_user      | resu_nommoc      | cocoa                 |          |
| private vault of Vanilla   | http://localhost:5984/classroom_vanilla   | vanilla          | liberty          | smock                 | kyouyuu/ |
| storage                    | ./vault/                                  |                  |                  |                       |          |

Cornbread's every document under "shared" is synchronized with the top of the
shared vault:

| Cornbread          | shared            |
| ------------------ | ----------------- |
| document1          | _Not transferred_ |
| document2          | _Not transferred_ |
| shared/shared_doc1 | shared_doc1       |
| shared/sub/sub_doc | sub/sub_doc       |

Vanilla's every document under "kyouyuu" is synchronized with the top of the
shared vault:

| Vanilla                  | shared            |
| ------------------------ | ----------------- |
| documentA                | _Not transferred_ |
| documentB                | _Not transferred_ |
| kyouyuu/some_doc         | some_doc          |
| kyouyuu/sub/some_sub_doc | sub/some_sub_doc  |

Totally, all files are synchronized like this:

| Cornbread               | shared            | Vanilla                  |
| ----------------------- | ----------------- | ------------------------ |
| document1               | _Not transferred_ |                          |
| document2               | _Not transferred_ |                          |
|                         | _Not transferred_ | documentA                |
|                         | _Not transferred_ | documentB                |
| shared/shared_doc1      | shared_doc1       | kyouyuu/shared_doc1      |
| shared/some_doc         | some_doc          | kyouyuu/some_doc         |
| shared/sub/some_sub_doc | sub/some_sub_doc  | kyouyuu/sub/some_sub_doc |
| shared/sub/sub_doc      | sub/sub_doc       | kyouyuu/sub/sub_doc      |

... with the configuration below:

```jsonc
{
  "peers": [
    {
      "type": "couchdb", // Type should be `couchdb or storage`
      "name": "cornbread", // Should be unique
      "url": "http://localhost:5984",
      "database": "classroom_cornbread",
      "username": "cornbread",
      "password": "tackle",
      "passphrase": "glucose", // E2EE passphrase, if you do not enabled, leave it blank.
      "obfuscatePassphrase": "glucose", // Path obfuscation passphrase, if you do not enabled, leave it blank. if enabled, set the same value of passphrase.
      "customChunkSize": 100,
      "minimumChunkSize": 20,
      "baseDir": "shared/", // Sharing folder
    },
    {
      "type": "couchdb", // Type should be `couchdb or storage`
      "name": "shared", // Should be unique
      "url": "http://localhost:5984",
      "database": "classroom_shared",
      "username": "common_user",
      "password": "resu_nommoc",
      "passphrase": "cocoa", // E2EE passphrase, if you do not enabled, leave it blank.
      "obfuscatePassphrase": "cocoa", // Path obfuscation passphrase, if you do not enabled, leave it blank. if enabled, set the same value of passphrase.
      "customChunkSize": 100,
      "minimumChunkSize": 20,
      "baseDir": "", // Sharing folder
    },
    {
      "type": "couchdb",
      "name": "vanilla", // We can even synchronise the same databases as long as they have different names in here.
      "url": "http://localhost:5984",
      "database": "classroom_vanilla",
      "username": "vanilla",
      "password": "liberty",
      "passphrase": "smock",
      "obfuscatePassphrase": "smock",
      "customChunkSize": 100,
      "minimumChunkSize": 20,
      "baseDir": "kyouyuu/",
    },
    {
      "type": "storage",
      "name": "storage-test1",
      "baseDir": "./vault/", // The folder which have been synchronised.
    },
  ],
}
```

## Upstream integration

The October 2026 upstream service APIs and storage path/event fixes are integrated
while retaining the canonical Forgejo library submodule, Node 26 / DHI runtime,
PNPM 12.11.2, durable checkpoint callbacks, baseline and tombstone safeguards,
and transactional repeat reservations. Windows vault paths use forward slashes;
ambiguous backslash writes are rejected. Filesystem events outside a peer root
are ignored, and unlink events require confirmed absence before propagation.

Storage peers now also support upstream `ignore` minimatch globs for outbound
scans and live events, including pruning ignored directories. Incoming changes
remain accepted for that option. The existing `ignorePaths` / `LS_IGNORE_PATHS`
protection remains bilateral. ID-key recovery codes are normalized before
initialization and select derivation v1 unless explicitly configured otherwise.
Commonlib 0.1.40 preserves Node file birth times across in-place edits.

Fork resolutions preserve the existing HTTP health endpoint and bounded startup/watch
recovery rather than adopting the upstream Deno heartbeat, and keep internal
metadata excluded under the existing folder and tombstone contract. Upstream
Deno-only tests are replaced by native Vitest coverage for storage root isolation,
Windows separators, empty payloads, repeat keys and watcher shutdown. An invalid
empty CouchDB payload throws before checkpoint advancement so durable replay can
retry it safely. The real manipulator initialization smoke uses a mocked CouchDB
transport; this is not a live Vault restore test.

## Developer documentation

- [Internal-file synchronisation design](docs/design_docs/internal_file_synchronisation.md)
- [Internal-file synchronisation ADR](docs/adr/2026_10_internal_file_synchronisation.md)
