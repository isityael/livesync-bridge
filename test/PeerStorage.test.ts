import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DispatchFun } from "../Peer.ts";
import { PeerStorage } from "../PeerStorage.ts";
import { installLocalStorage } from "../runtime/node_compat.ts";
import type { FileData, PeerStorageConf } from "../types.ts";

function textData(text: string): FileData {
  return {
    ctime: Date.now(),
    mtime: Date.now(),
    size: text.length,
    data: [text],
  };
}

function storagePeer(
  baseDir: string,
  dispatch: DispatchFun = async () => {},
  ignorePaths: string[] = [],
): PeerStorage {
  installLocalStorage(path.join(baseDir, ".state"));
  localStorage.clear();
  const conf: PeerStorageConf = {
    type: "storage",
    name: "test-storage",
    baseDir,
    scanOfflineChanges: true,
    ignorePaths,
  };
  return new PeerStorage(conf, dispatch);
}

describe("PeerStorage", () => {
  it("rejects writes outside baseDir", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-bridge-"));
    try {
      const baseDir = path.join(root, "vault");
      await mkdir(baseDir);
      const peer = storagePeer(baseDir);

      const result = await peer.put("../escape.md", textData("owned"));

      expect(result).toBe(false);
      await expect(
        readFile(path.join(root, "escape.md"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes safe paths under baseDir", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-bridge-"));
    try {
      const baseDir = path.join(root, "vault");
      await mkdir(baseDir);
      const peer = storagePeer(baseDir);

      const result = await peer.put("notes/example.md", textData("ok"));

      expect(result).toBe(true);
      await expect(
        readFile(path.join(baseDir, "notes/example.md"), "utf8"),
      ).resolves.toBe("ok");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects incoming writes to ignored paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-bridge-"));
    try {
      const baseDir = path.join(root, "vault");
      await mkdir(baseDir);
      const peer = storagePeer(baseDir, async () => {}, [
        ".basic-memory-config",
      ]);

      const result = await peer.put(
        ".basic-memory-config/memory.db-wal",
        textData("runtime state"),
      );

      expect(result).toBe(false);
      await expect(
        readFile(
          path.join(baseDir, ".basic-memory-config/memory.db-wal"),
          "utf8",
        ),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects incoming deletions for ignored paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-bridge-"));
    try {
      const baseDir = path.join(root, "vault");
      const ignoredDir = path.join(baseDir, ".basic-memory-config");
      const ignoredFile = path.join(ignoredDir, "memory.db");
      await mkdir(ignoredDir, { recursive: true });
      await writeFile(ignoredFile, "runtime state");
      const peer = storagePeer(baseDir, async () => {}, [
        ".basic-memory-config",
      ]);

      const result = await peer.delete(".basic-memory-config/memory.db");

      expect(result).toBe(false);
      await expect(readFile(ignoredFile, "utf8")).resolves.toBe(
        "runtime state",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats repeated delete races as successful", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-bridge-"));
    try {
      const baseDir = path.join(root, "vault");
      await mkdir(baseDir);
      const peer = storagePeer(baseDir);

      await expect(peer.delete("missing.md")).resolves.toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs processor commands with filename and mode placeholders", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-bridge-"));
    try {
      const baseDir = path.join(root, "vault");
      const logFile = path.join(root, "processor.log");
      await mkdir(baseDir);
      const conf: PeerStorageConf = {
        type: "storage",
        name: "test-storage",
        baseDir,
        processor: {
          cmd: process.execPath,
          args: [
            "-e",
            "import { appendFileSync } from 'node:fs'; appendFileSync(process.argv[1], `${process.env.mode}:${process.env.filename}\\n`)",
            logFile,
            "$filename",
            "$mode",
          ],
        },
      };
      const peer = new PeerStorage(conf, async () => {});

      await expect(peer.put("notes/example.md", textData("ok"))).resolves.toBe(
        true,
      );

      await vi.waitFor(async () => {
        const log = await readFile(logFile, "utf8");
        expect(log).toContain("modified:");
        expect(log).toContain(path.join(baseDir, "notes/example.md"));
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retries the same destination write after its processor fails once", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-bridge-"));
    try {
      installLocalStorage(root, true);
      localStorage.clear();
      const baseDir = path.join(root, "vault");
      const marker = path.join(root, "processor-attempted");
      await mkdir(baseDir);
      const conf: PeerStorageConf = {
        type: "storage",
        name: "test-storage",
        baseDir,
        processor: {
          cmd: process.execPath,
          args: [
            "-e",
            "import { existsSync, writeFileSync } from 'node:fs'; const marker = process.argv[1]; if (!existsSync(marker)) { writeFileSync(marker, 'failed once'); process.exit(1); }",
            marker,
          ],
        },
      };
      const peer = new PeerStorage(conf, async () => {});
      const data = textData("retry me");

      await expect(peer.put("notes/retry.md", data)).resolves.toBe(false);
      await expect(peer.put("notes/retry.md", data)).resolves.toBe(true);
      await expect(
        readFile(path.join(baseDir, "notes/retry.md"), "utf8"),
      ).resolves.toBe("retry me");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retries the same destination delete after its processor fails once", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-bridge-"));
    try {
      installLocalStorage(root, true);
      localStorage.clear();
      const baseDir = path.join(root, "vault");
      const marker = path.join(root, "processor-attempted");
      await mkdir(baseDir);
      await writeFile(path.join(baseDir, "retry.md"), "delete me");
      const conf: PeerStorageConf = {
        type: "storage",
        name: "test-storage",
        baseDir,
        processor: {
          cmd: process.execPath,
          args: [
            "-e",
            "import { existsSync, writeFileSync } from 'node:fs'; const marker = process.argv[1]; if (!existsSync(marker)) { writeFileSync(marker, 'failed once'); process.exit(1); }",
            marker,
          ],
        },
      };
      const peer = new PeerStorage(conf, async () => {});

      await expect(peer.delete("retry.md")).resolves.toBe(false);
      await expect(peer.delete("retry.md")).resolves.toBe(true);
      await expect(readFile(path.join(baseDir, "retry.md"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scans offline changed files before watching", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-bridge-"));
    const seen: string[] = [];
    try {
      const baseDir = path.join(root, "vault");
      await mkdir(path.join(baseDir, "notes"), { recursive: true });
      await writeFile(path.join(baseDir, "notes/example.md"), "offline");
      const peer = storagePeer(baseDir, async (_peer, pathSrc) => {
        seen.push(pathSrc);
      });

      await peer.scanOfflineChanges();

      await vi.waitFor(() => {
        expect(seen).toContain("notes/example.md");
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

it("converts every Windows separator and preserves POSIX backslash filenames", () => {
  const peer = new PeerStorage(
    { type: "storage", name: "paths", baseDir: "" },
    async () => {},
  );
  peer.pathSeparator = "\\";
  expect(peer.toPosixPath("a\\b\\c.md")).toBe("a/b/c.md");
  expect(peer.isUnsafeVaultPath("a\\b/c.md")).toBe(true);
  peer.pathSeparator = "/";
  expect(peer.toPosixPath("a\\b/c.md")).toBe("a\\b/c.md");
  expect(peer.isUnsafeVaultPath("a\\b/c.md")).toBe(false);
});

it("ignores deletion events from siblings and similar root prefixes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "livesync-upstream-"));
  try {
    const dispatch = vi.fn(async () => {});
    const peer = storagePeer(path.join(root, "vault"), dispatch);
    await peer.dispatchDeleted(path.join(root, "other", "note.md"));
    await peer.dispatchDeleted(path.join(root, "vault-other", "note.md"));
    expect(dispatch).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps existing data when an empty payload claims nonzero bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "livesync-upstream-"));
  try {
    const peer = storagePeer(root);
    await writeFile(path.join(root, "note.md"), "keep");
    expect(await peer.put("note.md", { ...textData(""), size: 4 })).toBe(false);
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("keep");
    expect(await peer.put("note.md", textData("replacement"))).toBe(true);
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(
      "replacement",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("uses the vault path for incoming repeat reservations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "livesync-upstream-"));
  try {
    const peer = storagePeer(root);
    expect(await peer.put("nested/note.md", textData("remote"))).toBe(true);
    expect(peer.cache.has("nested/note.md")).toBe(true);
    expect(peer.cache.has(path.join(root, "nested/note.md"))).toBe(false);
    expect(await peer.put("nested/note.md", textData("local edit"))).toBe(true);
    expect(await readFile(path.join(root, "nested/note.md"), "utf8")).toBe(
      "local edit",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("waits for watcher close and clears the active watcher", async () => {
  const peer = new PeerStorage(
    { type: "storage", name: "watch", baseDir: "" },
    async () => {},
  );
  let finish!: () => void;
  const close = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  peer.watcher = { close } as unknown as NonNullable<PeerStorage["watcher"]>;
  let stopped = false;
  const stopping = peer.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(peer.watcher).toBeUndefined();
  expect(stopped).toBe(false);
  finish();
  await stopping;
  expect(stopped).toBe(true);
});
