import {
  LOG_LEVEL_INFO,
  LOG_LEVEL_NOTICE,
  LOG_LEVEL_VERBOSE,
} from "./lib/src/common/types.ts";
import { FileData, PeerStorageConf } from "./types.ts";
import { Logger } from "./lib/src/common/logger.ts";
import { delay, getDocData } from "./lib/src/common/utils.ts";
import { isPlainText } from "./lib/src/string_and_binary/path.ts";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  readFile as readFileBuffer,
  rm,
  stat as fsStat,
  utimes,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  format,
  isAbsolute,
  parse,
  relative,
  resolve,
} from "node:path";
import { format as posixFormat, parse as posixParse } from "node:path/posix";
import { scheduleOnceIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { DispatchFun, Peer } from "./Peer.ts";
import chokidar from "chokidar";

import { isNotFoundError, walkFiles } from "./runtime/node_compat.ts";
import type { Stats } from "node:fs";

export class PeerStorage extends Peer {
  declare config: PeerStorageConf;

  constructor(conf: PeerStorageConf, dispatcher: DispatchFun) {
    super(conf, dispatcher);
  }

  async delete(pathSrc: string): Promise<boolean> {
    if (this.shouldIgnoreRelativePath(pathSrc)) {
      this.receiveLog(` ${pathSrc} delete ignored`);
      return false;
    }
    const resolved = this.resolveStoragePath(pathSrc);
    if (!resolved) return false;
    const { localPath: lp, storagePath: path } = resolved;
    if (await this.isRepeating(lp, false)) {
      return false;
    }
    try {
      await rm(path);
      this.receiveLog(` ${path} deleted`);
    } catch (ex) {
      // Deletions can race (e.g., the file was already removed locally).
      // Treat ENOENT as success to avoid noisy crash-like logs.
      if (isNotFoundError(ex)) {
        this.receiveLog(` ${path} already deleted`);
        return true;
      }
      this.receiveLog(` ${path} delete failed`, LOG_LEVEL_NOTICE);
      Logger(ex, LOG_LEVEL_VERBOSE);
      return false;
    }
    this.runScript(path, true);
    return true;
  }
  async put(pathSrc: string, data: FileData): Promise<boolean> {
    if (this.shouldIgnoreRelativePath(pathSrc)) {
      this.receiveLog(` ${pathSrc} save ignored`);
      return false;
    }
    const resolved = this.resolveStoragePath(pathSrc);
    if (!resolved) return false;
    const { localPath: lp, storagePath: path } = resolved;
    if (await this.isRepeating(lp, data)) {
      this.receiveLog(`${lp} save repeating`);
      return false;
    }
    try {
      const dirName = dirname(path);
      try {
        await mkdir(dirName, { recursive: true });
      } catch (ex) {
        // While recursive is true, mkdir will not raise the `AlreadyExist`.
        Logger(ex, LOG_LEVEL_NOTICE);
      }
      const bytes =
        data.data instanceof Uint8Array
          ? data.data
          : new TextEncoder().encode(getDocData(data.data));
      await writeFile(path, bytes);
      await utimes(path, new Date(data.mtime), new Date(data.mtime));
      this.receiveLog(`${lp} saved`);
      await this.writeFileStat(pathSrc);
      this.runScript(path, false);
      return true;
    } catch (ex) {
      Logger(ex, LOG_LEVEL_INFO);
      this.receiveLog(`${lp} save failed`);
      return false;
    }
  }

  async runScript(filename: string, isDeleted: boolean): Promise<boolean> {
    if (!this.config.processor) return false;
    if (!this.config.processor.cmd) return false;

    // const result = [];
    try {
      // const startDate = new Date();
      const cmd = this.config.processor.cmd;
      const mode = isDeleted ? "deleted" : "modified";
      const args = this.config.processor.args.map((e) => {
        if (e == "$filename") return filename;
        if (e == "$mode") return mode;
        return e;
      });
      // const dateStr = startDate.toLocaleString();
      const scriptLineMessage = `Script: called ${cmd} with args ${JSON.stringify(
        args,
      )}`;
      this.normalLog(`Processor : ${scriptLineMessage}`);
      // const start = performance.now();
      const { code, stdoutText, stderrText } = await new Promise<{
        code: number | null;
        stdoutText: string;
        stderrText: string;
      }>((resolveProcess, rejectProcess) => {
        const child = spawn(cmd, args, {
          cwd: ".",
          env: {
            ...process.env,
            filename: filename,
            mode: mode,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        child.stdout.on("data", (chunk) => stdout.push(new Uint8Array(chunk)));
        child.stderr.on("data", (chunk) => stderr.push(new Uint8Array(chunk)));
        child.on("error", rejectProcess);
        child.on("close", (exitCode) => {
          resolveProcess({
            code: exitCode,
            stdoutText: Buffer.concat(stdout).toString("utf8"),
            stderrText: Buffer.concat(stderr).toString("utf8"),
          });
        });
      });
      // const end = performance.now();
      // result.push(`# Processor called: ${dateStr}\n`);
      // result.push(`command: \`${scriptLineMessage}\``);
      if (code === 0) {
        this.normalLog("Processor called: Performed successfully.");
        // result.push("Processor called: Performed successfully.")
        this.normalLog(stdoutText);
      } else {
        this.normalLog("Processor called: Performed but with some errors.");
        // result.push("Processor called: Performed but with some errors.")
        this.normalLog(stderrText, LOG_LEVEL_NOTICE);
      }
      // result.push(`\n- Spent ${Math.ceil(end - start) / 1000} ms`);
      // result.push("## --STDOUT--\n")
      // result.push("```\n" + stdoutText + "\n```");
      // result.push("## --STDERR--n")
      // result.push("```\n" + stderrText + "\n```");
      // const strResult = result.join("\n");
      return true;
    } catch (ex) {
      this.normalLog("Processor: Error on processing");
      // this.normalLog(ex);
      this.normalLog(JSON.stringify(ex, null, 2));
      return false;
    }
  }

  async get(pathSrc: string): Promise<false | FileData> {
    const resolved = this.resolveStoragePath(pathSrc);
    if (!resolved) return false;
    const path = resolved.storagePath;
    let stat: Stats;
    try {
      stat = await fsStat(path);
    } catch (ex) {
      if (isNotFoundError(ex)) {
        return false;
      }
      throw ex;
    }
    if (!stat.isFile()) {
      return false;
    }
    const ret: FileData = {
      ctime: stat.birthtime?.getTime() ?? stat.mtime?.getTime() ?? 0,
      mtime: stat.mtime?.getTime() ?? 0,
      size: stat.size,
      data: [],
    };
    if (isPlainText(path)) {
      ret.data = [await readFile(path, "utf8")];
    } else {
      ret.data = new Uint8Array(await readFileBuffer(path));
    }
    return ret;
  }
  watcher?: ReturnType<typeof chokidar.watch>;

  private shouldIgnoreAbsolutePath(pathAbs: string): boolean {
    const lP = this.storageRootPath();
    const relPath = this.toPosixPath(relative(lP, pathAbs));
    if (!relPath || relPath === ".") return false;
    if (relPath === ".." || relPath.startsWith("../")) return true;
    return this.shouldIgnoreRelativePath(relPath);
  }

  async dispatch(pathSrc: string) {
    const lP = this.storageRootPath();
    const path = this.toPosixPath(relative(lP, pathSrc));
    if (this.shouldIgnoreRelativePath(path)) {
      return;
    }

    const data = await this.get(path);

    if (data === false) return;

    scheduleOnceIfDuplicated(pathSrc, async () => {
      // console.log(data);
      await this.writeFileStat(path);
      await delay(250);
      if (!(await this.isRepeating(path, data))) {
        this.sendLog(`${path} change detected`);
        await this.dispatchToHub(this, this.toGlobalPath(path), data);
      }
      // else {
      //     this.sendLog(`${path} change repeating detected`);
      // }
    });
  }
  async dispatchDeleted(pathSrc: string) {
    const lP = this.storageRootPath();
    const path = this.toPosixPath(relative(lP, pathSrc));
    if (this.shouldIgnoreRelativePath(path)) {
      return;
    }
    await scheduleOnceIfDuplicated(pathSrc, async () => {
      await delay(250);
      if (!(await this.isRepeating(path, false))) {
        this.sendLog(`${path} delete detected`);
        await this.dispatchToHub(this, this.toGlobalPath(path), false);
      }
    });
  }

  toPosixPath(path: string) {
    const ret = posixFormat(parse(path));
    // this.debugLog(`**TOPOSIX ${path} -> ${ret}`)
    return ret;
  }
  toStoragePath(path: string) {
    const ret = resolve(format(posixParse(path)));
    // this.debugLog(`**TOSTORAGE ${path} -> ${ret}`)
    return ret;
  }
  private storageRootPath() {
    return this.toStoragePath(this.toLocalPath("."));
  }
  private resolveStoragePath(
    pathSrc: string,
  ): { localPath: string; storagePath: string } | false {
    if (!this.isSafeRelativePath(pathSrc)) {
      this.receiveLog(` ${pathSrc} rejected unsafe path`, LOG_LEVEL_NOTICE);
      return false;
    }

    const localPath = this.toLocalPath(pathSrc);
    const storageRoot = this.storageRootPath();
    const storageRelative = pathSrc.replace(/^\/+/, "");
    const storagePath = resolve(
      storageRoot,
      format(posixParse(storageRelative)),
    );
    const relPath = relative(storageRoot, storagePath);
    if (
      relPath === "" ||
      relPath === "." ||
      (!relPath.startsWith("..") && !isAbsolute(relPath))
    ) {
      return { localPath, storagePath };
    }

    this.receiveLog(
      ` ${pathSrc} rejected outside storage root`,
      LOG_LEVEL_NOTICE,
    );
    return false;
  }

  async writeFileStat(pathSrc: string, statSrc?: Stats) {
    const resolved = this.resolveStoragePath(pathSrc);
    if (!resolved) return false;
    const { localPath: lp, storagePath: path } = resolved;
    const key = `file-stat-${lp}`;
    const stat = statSrc ?? (await fsStat(path));
    if (!stat.isFile()) {
      return false;
    }
    const fileStat = `${stat.mtime?.getTime() ?? 0}-${stat.size}`;
    this.setSetting(key, fileStat);
  }

  async isChanged(pathSrc: string) {
    const resolved = this.resolveStoragePath(pathSrc);
    if (!resolved) return false;
    const { localPath: lp, storagePath: path } = resolved;
    const key = `file-stat-${lp}`;
    const last = this.getSetting(key);
    // console.log(`R:${key}`);
    // console.log(`RV:${last}`);

    const stat = await fsStat(path);
    if (!stat.isFile()) {
      return false;
    }
    if (!last) return true;
    const fileStat = `${stat.mtime?.getTime() ?? 0}-${stat.size}`;
    // console.log(`RVX:${fileStat}`);
    if (last !== fileStat) return true;
    return false;
  }
  async scanOfflineChanges(): Promise<void> {
    const lP = this.storageRootPath();
    for await (const entry of walkFiles(lP)) {
      if (entry.isFile) {
        const ePath = this.toPosixPath(relative(lP, entry.path));
        if (this.shouldIgnoreRelativePath(ePath)) {
          continue;
        }
        if (await this.isChanged(ePath)) {
          this.debugLog(`Offline changes detected: ${ePath}`);
          await this.dispatch(entry.path);
        }
      }
    }
  }

  async start() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    const lP = this.storageRootPath();
    this.normalLog(
      `Scan offline changes: ${
        this.config.scanOfflineChanges ? "Enabled, now starting..." : "Disabled"
      }`,
    );
    if (this.config.scanOfflineChanges) {
      await this.scanOfflineChanges();
    }
    this.watcher = chokidar.watch(lP, {
      ignoreInitial: true,
      ignored: (path) => this.shouldIgnoreAbsolutePath(String(path)),
      awaitWriteFinish: {
        stabilityThreshold: 500,
      },
    });

    this.watcher.on("change", async (path: string) => {
      const ePath = this.toPosixPath(relative(lP, path));
      if (!(await this.isChanged(ePath))) {
        // this.debugLog(`Not changed: ${ePath}`);
      } else {
        this.debugLog(`Changes detected: ${ePath}`);
        await this.dispatch(path);
      }
    });
    this.watcher.on("add", async (path: string) => {
      const ePath = this.toPosixPath(relative(lP, path));
      if (!(await this.isChanged(ePath))) {
        // this.debugLog(`Not changed: ${ePath}`);
      } else {
        this.debugLog(`New detected: ${ePath}`);
        await this.dispatch(path);
      }
    });
    this.watcher.on("unlink", async (path: string) => {
      const ePath = this.toPosixPath(relative(lP, path));
      this.debugLog(`Unlink detected: ${ePath}`);
      await this.dispatchDeleted(path);
    });
  }
  async stop() {
    this.watcher?.close();
    return await Promise.resolve();
  }
}
