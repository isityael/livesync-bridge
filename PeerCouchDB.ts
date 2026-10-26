import {
  FileInfo,
  MetaEntry,
  ReadyEntry,
} from "./lib/src/API/DirectFileManipulatorV2.ts";
import {
  FilePathWithPrefix,
  LOG_LEVEL_NOTICE,
  MILESTONE_DOCID,
  TweakValues,
} from "./lib/src/common/types.ts";
import { FileData, PeerCouchDBConf } from "./types.ts";
import { decodeBinary } from "./lib/src/string_and_binary/convert.ts";
import { isPlainText } from "./lib/src/string_and_binary/path.ts";
import { DispatchFun, Peer } from "./Peer.ts";
import {
  createBinaryBlob,
  createTextBlob,
  isDocContentSame,
  getDocData,
  unique,
} from "./lib/src/common/utils.ts";
import { DurableDirectFileManipulator } from "./runtime/durable_manipulator.ts";
import { normaliseIdDerivationKey } from "./util.ts";
import { minimatch } from "minimatch";
type ResolvedCouchDBPath = {
  sharedPath: string;
  databasePath: FilePathWithPrefix;
  internal: boolean;
};

export interface PeerRuntimeHooks {
  beginReplay(): void;
  completeReplay(): void;
  recordRemoteActivity(conflicts: number): void;
  recordCheckpoint(checkpoint: string): void;
  confirmBaseline(checkpoint: string): void;
  invalidateBaseline(): void;
  recordFailure?(error: unknown): boolean;
  resetFailures?(): void;
  watchRetryDelayMs?: number;
}

// export class PeerInstance()

export class PeerCouchDB extends Peer {
  man: DurableDirectFileManipulator;
  declare config: PeerCouchDBConf;
  private readonly runtime?: PeerRuntimeHooks;
  constructor(
    conf: PeerCouchDBConf,
    dispatcher: DispatchFun,
    runtime?: PeerRuntimeHooks,
    manipulator?: DurableDirectFileManipulator,
  ) {
    super(conf, dispatcher);
    const idDerivationKey = normaliseIdDerivationKey(
      this.config.idDerivationKey,
    );
    this.config.idDerivationKey = idDerivationKey;
    if (idDerivationKey) this.config.idDerivationVersion ??= 1;
    this.runtime = runtime;
    this.config.syncInternalFiles =
      (this.config.includeInternal?.length ?? 0) > 0;
    this.man = manipulator ?? new DurableDirectFileManipulator(conf);
    // Fetch remote since.
    this.man.since = this.getSetting("since") ?? "";
  }
  override _getKey(key: string): string {
    if (!["since", "remote-created", "baseline-remote"].includes(key))
      return super._getKey(key);
    const url = new URL(this.config.url);
    const endpoint = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    return `couchdb-checkpoint:${JSON.stringify([this.config.name, this.config.baseDir, endpoint, this.config.database, key])}`;
  }
  private _isCanonicalFilePath(path: string): boolean {
    return (
      path.length > 0 &&
      path
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== "..")
    );
  }
  private _resolveSharedPath(path: string): ResolvedCouchDBPath | false {
    if (
      !this._isCanonicalFilePath(path) ||
      ["i:", "ix:", "ps:", "h:", "f:"].some((prefix) => path.startsWith(prefix))
    )
      return false;
    if (path.startsWith(".")) {
      if (
        !this.config.includeInternal?.some((pattern) =>
          minimatch(path, pattern, { dot: true }),
        )
      )
        return false;
      return {
        sharedPath: path,
        databasePath: `i:${path}` as FilePathWithPrefix,
        internal: true,
      };
    }
    const databasePath = this.toLocalPath(path);
    if (
      !this._isCanonicalFilePath(databasePath) ||
      databasePath.startsWith(".")
    )
      return false;
    return {
      sharedPath: path,
      databasePath: databasePath as FilePathWithPrefix,
      internal: false,
    };
  }
  private _resolveMetadataPath(path: string): ResolvedCouchDBPath | false {
    if (path.startsWith("i:")) {
      const resolved = this._resolveSharedPath(path.substring(2));
      return resolved && resolved.internal ? resolved : false;
    }
    if (
      !this._isCanonicalFilePath(path) ||
      path.startsWith(".") ||
      path.includes(":")
    )
      return false;
    const baseDir = this.toLocalPath("").replace(/\/+$/, "");
    if (baseDir && !path.startsWith(`${baseDir}/`)) return false;
    const sharedPath = baseDir ? path.substring(baseDir.length + 1) : path;
    const resolved = this._resolveSharedPath(sharedPath);
    return resolved && !resolved.internal && resolved.databasePath === path
      ? resolved
      : false;
  }
  private async _canAccessPath(
    resolved: ResolvedCouchDBPath,
  ): Promise<boolean> {
    if (!resolved.internal) return true;
    const alias = this.toLocalPath(resolved.sharedPath) as FilePathWithPrefix;
    try {
      const aliasId = await this.man.path2id(alias);
      const existing = await this.man.rawGet<{
        deleted?: boolean;
        _deleted?: boolean;
      }>(aliasId);
      if (!existing || existing.deleted || existing._deleted) return true;
      this.normalLog(
        `Internal file blocked: ${resolved.databasePath} (ordinary document ${alias} shares ${resolved.sharedPath})`,
        LOG_LEVEL_NOTICE,
      );
    } catch {
      this.normalLog(
        `Internal file blocked: ${resolved.databasePath} (could not inspect ordinary document ${alias})`,
        LOG_LEVEL_NOTICE,
      );
    }
    return false;
  }
  private async _prepareOutgoingPath(
    path: string,
  ): Promise<ResolvedCouchDBPath | false> {
    const resolved = this._resolveSharedPath(path);
    if (!resolved) return false;
    await this.man.ready.promise;
    return (await this._canAccessPath(resolved)) ? resolved : false;
  }

  async delete(pathSrc: string): Promise<boolean> {
    if (this.shouldIgnoreRelativePath(pathSrc)) {
      this.receiveLog(` ${pathSrc} delete ignored`);
      return false;
    }
    const resolved = await this._prepareOutgoingPath(pathSrc);
    if (!resolved) return false;
    const path = resolved.databasePath;
    const reservation = await this.reserveChange(pathSrc, false);
    if (reservation.repeating) {
      return true;
    }
    try {
      const r = await this.man.delete(path);
      if (r) {
        reservation.commit();
        this.receiveLog(` ${path} deleted`);
      } else {
        reservation.rollback();
        this.receiveLog(` ${path} delete failed`, LOG_LEVEL_NOTICE);
      }
      return r;
    } catch (error) {
      reservation.rollback();
      throw error;
    }
  }
  async put(pathSrc: string, data: FileData): Promise<boolean> {
    if (this.shouldIgnoreRelativePath(pathSrc)) {
      this.receiveLog(` ${pathSrc} save ignored`);
      return false;
    }
    const resolved = await this._prepareOutgoingPath(pathSrc);
    if (!resolved) return false;
    const path = resolved.databasePath;
    const reservation = await this.reserveChange(pathSrc, data);
    if (reservation.repeating) {
      return true;
    }
    try {
      const type = isPlainText(path) ? "plain" : "newnote";
      const info: FileInfo = {
        ctime: data.ctime,
        mtime: data.mtime,
        size: data.size,
      };
      const saveData =
        data.data instanceof Uint8Array
          ? createBinaryBlob(data.data)
          : createTextBlob(data.data);
      const old = (await this.man.get(path as FilePathWithPrefix, true)) as
        | false
        | MetaEntry;
      // const old = await this.getMeta(path as FilePathWithPrefix);
      if (old && Math.abs(this.compareDate(info, old)) < 3600) {
        const oldDoc = await this.man.getByMeta(old);
        if (oldDoc && "data" in oldDoc) {
          const d =
            oldDoc.type == "plain"
              ? createTextBlob(oldDoc.data)
              : createBinaryBlob(new Uint8Array(decodeBinary(oldDoc.data)));
          if (await isDocContentSame(d, saveData)) {
            reservation.commit();
            this.normalLog(` Skipped (Same) ${path} `);
            return true;
          }
        }
      }
      const r = await this.man.put(path, saveData, info, type);
      if (r) {
        reservation.commit();
        this.receiveLog(` ${path} saved`);
      } else {
        reservation.rollback();
        this.receiveLog(` ${path} ignored`);
      }
      return r;
    } catch (error) {
      reservation.rollback();
      throw error;
    }
  }
  async get(pathSrc: FilePathWithPrefix): Promise<false | FileData> {
    const resolved = await this._prepareOutgoingPath(pathSrc);
    if (!resolved) return false;
    const path = resolved.databasePath;
    const ret = (await this.man.get(path)) as false | ReadyEntry;
    if (ret === false) {
      return false;
    }
    return {
      ctime: ret.ctime,
      mtime: ret.mtime,
      data:
        ret.type == "newnote"
          ? new Uint8Array(decodeBinary(ret.data))
          : ret.data,
      size: ret.size,
      deleted: ret.deleted,
    };
  }
  async getMeta(pathSrc: FilePathWithPrefix): Promise<false | FileData> {
    const resolved = await this._prepareOutgoingPath(pathSrc);
    if (!resolved) return false;
    const path = resolved.databasePath;
    const ret = (await this.man.get(path, true)) as false | MetaEntry;
    if (ret === false) {
      return false;
    }
    return {
      ctime: ret.ctime,
      mtime: ret.mtime,
      data: [],
      size: ret.size,
      deleted: ret.deleted,
    };
  }
  async start(): Promise<void> {
    await this.man.ready.promise;
    const w = await this.man.rawGet<Record<string, any>>(MILESTONE_DOCID);
    const remoteInfo = await this.man.liveSyncLocalDB.localDatabase.info();
    if (w && "tweak_values" in w) {
      if (this.config.useRemoteTweaks) {
        const tweaks = Object.values(w["tweak_values"])[0] as TweakValues;
        // console.log(tweaks)
        const orgConf = { ...this.config } as Record<string, any>;
        this.config.customChunkSize =
          tweaks.customChunkSize ?? this.config.customChunkSize;
        this.config.minimumChunkSize =
          tweaks.minimumChunkSize ?? this.config.minimumChunkSize;
        if (tweaks.encrypt && !this.config.passphrase) {
          throw new Error(
            "Remote database is encrypted but no passphrase provided.",
          );
        }
        if (tweaks.usePathObfuscation && !this.config.obfuscatePassphrase) {
          throw new Error(
            "Remote database is obfuscated but no obfuscate passphrase provided.",
          );
        }
        this.config.hashAlg = tweaks.hashAlg ?? this.config.hashAlg;
        this.config.maxAgeInEden =
          tweaks.maxAgeInEden ?? this.config.maxAgeInEden;
        this.config.maxTotalLengthInEden =
          tweaks.maxTotalLengthInEden ?? this.config.maxTotalLengthInEden;
        this.config.maxChunksInEden =
          tweaks.maxChunksInEden ?? this.config.maxChunksInEden;
        this.config.useEden = tweaks.useEden ?? this.config.useEden;
        if (!this.config.enableCompression != !tweaks.enableCompression) {
          throw new Error("Compression setting mismatched.");
        }
        this.config.useDynamicIterationCount =
          tweaks.useDynamicIterationCount ??
          this.config.useDynamicIterationCount;
        this.config.enableChunkSplitterV2 =
          tweaks.enableChunkSplitterV2 ?? this.config.enableChunkSplitterV2;
        this.config.chunkSplitterVersion =
          tweaks.chunkSplitterVersion ?? this.config.chunkSplitterVersion;
        this.config.E2EEAlgorithm =
          tweaks.E2EEAlgorithm ?? this.config.E2EEAlgorithm;
        this.config.minimumChunkSize =
          tweaks.minimumChunkSize ?? this.config.minimumChunkSize;
        this.config.customChunkSize =
          tweaks.customChunkSize ?? this.config.customChunkSize;
        this.config.doNotUseFixedRevisionForChunks =
          tweaks.doNotUseFixedRevisionForChunks ??
          this.config.doNotUseFixedRevisionForChunks;
        this.config.handleFilenameCaseSensitive =
          tweaks.handleFilenameCaseSensitive ??
          this.config.handleFilenameCaseSensitive;
        this.config.idDerivationVersion =
          tweaks.idDerivationVersion ?? this.config.idDerivationVersion;
        this.config.encryptInternalMetadata =
          tweaks.encryptInternalMetadata ?? this.config.encryptInternalMetadata;
        const newConf = { ...this.config } as Record<string, any>;
        this.man.options = this.config;
        await this.man.liveSyncLocalDB.initializeDatabase();
        // await this.man.managers.initManagers();
        const diff = unique([
          ...Object.keys(orgConf),
          ...Object.keys(tweaks),
        ]).filter((k) => orgConf[k] != newConf[k]);
        if (diff.length > 0) {
          this.normalLog(`Remote tweaks changed --->`);
          for (const diffKey of diff) {
            this.normalLog(
              `${diffKey}\t: ${orgConf[diffKey]} \t : ${newConf[diffKey]}`,
            );
          }
          this.normalLog(`<--- Remote tweaks changed`);
        }
      }
    }
    let remoteIdentity: string;
    if (!w) {
      const remoteDocCount = Number(remoteInfo.doc_count ?? 0);
      remoteIdentity = `missing-milestone:${
        (remoteInfo as { uuid?: string }).uuid ??
        remoteInfo.db_name ??
        this.config.database
      }`;
      if (remoteDocCount === 0) {
        this.normalLog(
          `Remote database looks like empty. fetch from the first.`,
        );
      } else {
        this.normalLog(
          `Remote database is populated (${remoteDocCount} docs) but missing the milestone document.`,
        );
      }
    } else {
      remoteIdentity = `${w.created}`;
    }

    const remoteChanged = this.getSetting("remote-created") !== remoteIdentity;
    const baselineConfirmed =
      this.getSetting("baseline-remote") === remoteIdentity;
    if (remoteChanged || !baselineConfirmed) {
      if (remoteChanged) {
        this.man.since = "0";
        this.normalLog(
          `Remote database looks like rebuilt. fetch from the first again.`,
        );
        this.setSetting("since", this.man.since);
      }
      this.setSetting("remote-created", remoteIdentity);
      this.runtime?.invalidateBaseline();
    } else {
      this.normalLog(`Watch starting from ${this.man.since}`);
    }

    const interested = (entry: MetaEntry) => {
      const resolved = this._resolveMetadataPath(entry.path);
      return (
        resolved !== false &&
        !this.shouldIgnoreRelativePath(resolved.sharedPath)
      );
    };
    const processEntry = async (
      entry: ReadyEntry & {
        _conflicts?: string[];
        _deleted?: boolean;
      },
      seq?: string | number,
    ) => {
      const conflicts = Array.isArray(entry._conflicts)
        ? entry._conflicts.length
        : 0;
      this.runtime?.recordRemoteActivity(conflicts);
      const resolved = this._resolveMetadataPath(entry.path);
      if (resolved && (await this._canAccessPath(resolved))) {
        const path = resolved.sharedPath;
        if (entry.deleted || entry._deleted) {
          this.sendLog(`${path} delete detected`);
          await this.dispatchDeleted(path);
        } else {
          const d =
            entry.type == "plain"
              ? entry.data
              : new Uint8Array(decodeBinary(entry.data));
          const docData = {
            ctime: entry.ctime,
            mtime: entry.mtime,
            size: entry.size,
            deleted: entry.deleted || entry._deleted,
            data: d,
          };
          this.sendLog(`${path} change detected`);
          await this.dispatch(path, docData);
        }
      }
      if (seq !== undefined) {
        this.man.since = `${seq}`;
        this.setSetting("since", this.man.since);
        this.runtime?.recordCheckpoint(this.man.since);
      }
      this.runtime?.resetFailures?.();
    };

    if (!baselineConfirmed) {
      this.runtime?.beginReplay();
      try {
        const lastSequence = await this.man.followUpdates(
          processEntry,
          interested,
        );
        this.man.since = `${lastSequence || this.man.since || "0"}`;
        this.setSetting("since", this.man.since);
        this.setSetting("baseline-remote", remoteIdentity);
        this.runtime?.recordCheckpoint(this.man.since);
        this.runtime?.confirmBaseline(this.man.since);
      } finally {
        this.runtime?.completeReplay();
      }
    } else {
      this.runtime?.confirmBaseline(this.man.since || "0");
    }

    this.man.beginWatch(
      processEntry,
      interested,
      (error) => {
        const shouldReconnect = this.runtime?.recordFailure?.(error) ?? false;
        if (shouldReconnect) {
          this.normalLog(
            "Live changes feed failed; reconnecting within the configured failure bound.",
            LOG_LEVEL_NOTICE,
          );
        }
        return shouldReconnect;
      },
      this.runtime?.watchRetryDelayMs,
    );
  }
  async dispatch(path: string, data: FileData | false) {
    if (data === false) return;
    if (
      data.size > 0 &&
      (data.data instanceof Uint8Array
        ? data.data.byteLength === 0
        : getDocData(data.data).length === 0)
    ) {
      throw new Error(
        `Empty update blocked: ${path} (${data.size} bytes reported, 0 bytes received)`,
      );
    }
    const reservation = await this.reserveChange(path, data);
    if (!reservation.repeating) {
      try {
        await this.dispatchToHub(this, path, data);
        reservation.commit();
      } catch (error) {
        reservation.rollback();
        throw error;
      }
    }
    // else {
    //     this.receiveLog(`${path} dispatch repeating`);
    // }
  }
  async dispatchDeleted(path: string) {
    const reservation = await this.reserveChange(path, false);
    if (!reservation.repeating) {
      try {
        await this.dispatchToHub(this, path, false);
        reservation.commit();
      } catch (error) {
        reservation.rollback();
        throw error;
      }
    }
  }
  async stop(): Promise<void> {
    this.man.endWatch();
    return await Promise.resolve();
  }
}
