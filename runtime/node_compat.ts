import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { opendir, rename, stat } from "node:fs/promises";
import path from "node:path";

const MALFORMED_LOCAL_STORAGE_MARKER = "database disk image is malformed";
const CORRUPT_LOCAL_STORAGE_FILES = new Set([
  "local_storage",
  "local_storage-shm",
  "local_storage-wal",
  "local_storage.json",
]);

class FileLocalStorage implements Storage {
  private data = new Map<string, string>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
    this.persist();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
    this.persist();
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
    this.persist();
  }

  private load(): void {
    try {
      const payload = JSON.parse(readFileSyncCompat(this.filePath)) as Record<
        string,
        string
      >;
      this.data = new Map(
        Object.entries(payload).map(([key, value]) => [key, String(value)]),
      );
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw new Error(MALFORMED_LOCAL_STORAGE_MARKER, { cause: error });
    }
  }

  private persist(): void {
    mkdirSyncCompat(path.dirname(this.filePath));
    writeFileSyncCompat(
      this.filePath,
      JSON.stringify(Object.fromEntries(this.data), null, 2),
    );
  }
}

function readFileSyncCompat(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function writeFileSyncCompat(filePath: string, data: string): void {
  writeFileSync(filePath, data);
}

function mkdirSyncCompat(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function isMalformedLocalStorageError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes(MALFORMED_LOCAL_STORAGE_MARKER);
}

export function localStorageStateDir(): string {
  return process.env.LSB_STATE_DIR ?? "./dat";
}

export function installLocalStorage(
  stateDir = localStorageStateDir(),
  force = false,
): void {
  const existing = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  if (
    !force &&
    existing &&
    "value" in existing &&
    existing.value !== undefined
  ) {
    return;
  }
  const locationDataDir = path.join(stateDir, "location_data");
  const localStorageFile = path.join(locationDataDir, "local_storage.json");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new FileLocalStorage(localStorageFile),
    writable: true,
  });
}

export function assertLocalStorageHealthy(): void {
  const healthKey = "__lsb_local_storage_healthcheck__";
  localStorage.setItem(healthKey, "1");
  localStorage.removeItem(healthKey);
}

export async function removeCorruptLocalStorageFiles(
  dir: string,
): Promise<number> {
  let removed = 0;
  let entries;
  try {
    entries = await opendir(dir);
  } catch (error) {
    if (isNotFoundError(error)) {
      return 0;
    }
    throw error;
  }

  for await (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += await removeCorruptLocalStorageFiles(entryPath);
      continue;
    }
    if (entry.isFile() && CORRUPT_LOCAL_STORAGE_FILES.has(entry.name)) {
      await rename(entryPath, `${entryPath}.corrupt-${Date.now()}`);
      removed += 1;
    }
  }
  return removed;
}

export async function recoverMalformedLocalStorage(
  stateDir: string,
  stage: string,
  error: unknown,
): Promise<boolean> {
  if (!isMalformedLocalStorageError(error)) {
    return false;
  }

  const reason = error instanceof Error ? error.message : String(error);
  console.error(
    `[livesync-bridge] malformed localStorage detected during ${stage}: ${reason}`,
  );

  const locationDataDir = path.join(stateDir, "location_data");
  const removedFiles = await removeCorruptLocalStorageFiles(locationDataDir);
  console.error(
    `[livesync-bridge] quarantined ${removedFiles} corrupted localStorage files under ${locationDataDir}`,
  );

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new FileLocalStorage(
      path.join(locationDataDir, "local_storage.json"),
    ),
    writable: true,
  });

  try {
    assertLocalStorageHealthy();
    console.log("[livesync-bridge] localStorage recovery succeeded");
    return true;
  } catch (probeError) {
    const probeMessage =
      probeError instanceof Error ? probeError.message : String(probeError);
    console.error(
      `[livesync-bridge] localStorage recovery probe failed: ${probeMessage}`,
    );
    return false;
  }
}

export interface WalkEntry {
  path: string;
  isFile: boolean;
}

export async function* walkFiles(root: string): AsyncGenerator<WalkEntry> {
  const rootStat = await stat(root);
  if (rootStat.isFile()) {
    yield { path: root, isFile: true };
    return;
  }

  for await (const entry of await opendir(root)) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
    } else {
      yield { path: entryPath, isFile: entry.isFile() };
    }
  }
}
