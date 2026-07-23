import { join as joinPosix } from "node:path/posix";
import type { FileInfo } from "./lib/src/API/DirectFileManipulatorV2.ts";

import {
  FilePathWithPrefix,
  LOG_LEVEL,
  LOG_LEVEL_DEBUG,
  LOG_LEVEL_INFO,
  LOG_LEVEL_NOTICE,
} from "./lib/src/common/types.ts";
import { FileData, PeerConf } from "./types.ts";
import { Logger } from "octagonal-wheels/common/logger.js";
import { LRUCache } from "octagonal-wheels/memory/LRUCache.js";
import { computeHash } from "./util.ts";

export type DispatchFun = (
  source: Peer,
  path: string,
  data: FileData | false,
) => Promise<void>;

export abstract class Peer {
  config: PeerConf;
  // hub: Hub;
  dispatchToHub: DispatchFun;
  constructor(conf: PeerConf, dispatcher: DispatchFun) {
    this.config = conf;
    this.dispatchToHub = dispatcher;
  }
  toLocalPath(path: string) {
    const relativeJoined = joinPosix(this.config.baseDir, path);
    const relative = relativeJoined == "." ? "" : relativeJoined;
    const ret = relative.startsWith("_") ? "/" + relative : relative;
    // this.debugLog(`**TOLOCAL: ${path} => ${ret}`);
    return ret;
  }
  toGlobalPath(pathSrc: string) {
    let path = pathSrc.startsWith("_") ? pathSrc.substring(1) : pathSrc;
    if (path.startsWith(this.config.baseDir)) {
      path = path.substring(this.config.baseDir.length);
    }
    // this.debugLog(`**TOLOCAL: ${pathSrc} => ${path}`);
    return path;
  }
  protected isSafeRelativePath(path: string): boolean {
    if (!path || path.includes("\0")) return false;
    if (path.startsWith("/") || path.startsWith("\\")) return false;

    const parts = path.split(/[\\/]+/);
    return !parts.some((part) => part === "..");
  }
  private globToRegex(glob: string): RegExp {
    const escaped = glob
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
  }
  protected shouldIgnoreRelativePath(relativePath: string): boolean {
    const patterns = this.config.ignorePaths ?? [];
    if (patterns.length === 0) return false;

    const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const segments = normalizedPath.split("/").filter(Boolean);
    if (segments.length === 0) return false;

    for (const rawPattern of patterns) {
      const pattern = rawPattern
        .trim()
        .replace(/^\.\/+/, "")
        .replace(/\/+$/, "");
      if (!pattern) continue;
      const matcher = this.globToRegex(pattern);

      if (pattern.includes("/")) {
        if (matcher.test(normalizedPath)) return true;
        continue;
      }

      if (segments.some((segment) => matcher.test(segment))) return true;
    }

    return false;
  }
  acceptsPath(relativePath: string): boolean {
    return !this.shouldIgnoreRelativePath(relativePath);
  }
  abstract delete(path: string): Promise<boolean>;
  abstract put(path: string, data: FileData): Promise<boolean>;
  abstract get(path: FilePathWithPrefix): Promise<false | FileData>;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  cache = new LRUCache<string, string>(300, 10000000, true);
  async isRepeating(path: string, data: FileData | false) {
    const d = await computeHash(data === false ? ["\u0001Deleted"] : data.data);

    if (this.cache.has(path) && this.cache.get(path) == d) {
      return true;
    }
    this.cache.set(path, d);
    return false;
  }
  receiveLog(message: string, level?: LOG_LEVEL) {
    Logger(`[${this.config.name}] <-- ${message}`, level ?? LOG_LEVEL_INFO);
  }
  sendLog(message: string, level?: LOG_LEVEL) {
    Logger(`[${this.config.name}] --> ${message}`, level ?? LOG_LEVEL_INFO);
  }
  normalLog(message: string, level?: LOG_LEVEL) {
    Logger(`[${this.config.name}] ${message}`, level ?? LOG_LEVEL_INFO);
  }
  debugLog(message: string, level?: LOG_LEVEL) {
    Logger(`[${this.config.name}] ${message}`, level ?? LOG_LEVEL_DEBUG);
  }
  _getKey(key: string) {
    return `${this.config.name}-${this.config.type}-${this.config.baseDir}-${key}`;
  }
  private isMalformedLocalStorageError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return error.message
      .toLowerCase()
      .includes("database disk image is malformed");
  }
  private resetLocalStorage(): boolean {
    try {
      localStorage.clear();
      return true;
    } catch (error) {
      this.normalLog(
        `Failed to reset localStorage: ${
          error instanceof Error ? error.message : String(error)
        }`,
        LOG_LEVEL_NOTICE,
      );
      return false;
    }
  }
  setSetting(key: string, value: string) {
    const storageKey = this._getKey(key);
    try {
      return localStorage.setItem(storageKey, value);
    } catch (error) {
      if (!this.isMalformedLocalStorageError(error)) {
        throw error;
      }
      this.normalLog(
        `Malformed localStorage detected while writing "${storageKey}". Resetting local state and retrying.`,
        LOG_LEVEL_NOTICE,
      );
      if (!this.resetLocalStorage()) {
        throw error;
      }
      return localStorage.setItem(storageKey, value);
    }
  }
  getSetting(key: string) {
    const storageKey = this._getKey(key);
    try {
      return localStorage.getItem(storageKey);
    } catch (error) {
      if (!this.isMalformedLocalStorageError(error)) {
        throw error;
      }
      this.normalLog(
        `Malformed localStorage detected while reading "${storageKey}". Resetting local state and returning empty value.`,
        LOG_LEVEL_NOTICE,
      );
      if (!this.resetLocalStorage()) {
        return null;
      }
      try {
        return localStorage.getItem(storageKey);
      } catch (_retryError) {
        return null;
      }
    }
  }
  compareDate(a: FileInfo, b: FileInfo) {
    const aMTime = ~~((a?.mtime ?? 0) / 1000);
    const bMTime = ~~((b?.mtime ?? 0) / 1000);
    return aMTime - bMTime;
  }
}
