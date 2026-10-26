import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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

describe("upstream storage ignore and deletion semantics on Node", () => {
  it("matches dot directories, ancestors and minimatch glob patterns", () => {
    const peer = new PeerStorage(
      {
        type: "storage",
        name: "glob",
        baseDir: "",
        ignore: [
          "**/.git/**",
          "node_modules/**",
          "private",
          "**/*.tmp",
          "**/*.{bak,old}",
        ],
      },
      async () => {},
    );
    for (const value of [
      ".git",
      "nested/.git/config",
      "node_modules/pkg/index.js",
      "private/note.md",
      "cache.tmp/note.md",
      "nested/note.bak",
      "note.old",
    ])
      expect(peer.isIgnored(value)).toBe(true);
    for (const value of [
      "",
      "public/note.md",
      "nested/private/note.md",
      ".github/workflow.yml",
    ])
      expect(peer.isIgnored(value)).toBe(false);
  });
  it("accepts incoming writes and deletions at outbound-only ignored paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-ignore-"));
    try {
      const peer = storagePeer(root, undefined, [".state"]);
      peer.config.ignore = ["private/**"];
      expect(await peer.put("private/note.md", textData("incoming"))).toBe(
        true,
      );
      expect(await readFile(path.join(root, "private/note.md"), "utf8")).toBe(
        "incoming",
      );
      expect(await peer.delete("private/note.md")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("prunes excluded directories before opening them during offline scans", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-ignore-"));
    const hidden = path.join(root, "private");
    const seen: string[] = [];
    try {
      await mkdir(hidden);
      await writeFile(path.join(hidden, "secret.md"), "excluded");
      await writeFile(path.join(root, "public.md"), "visible");
      await writeFile(path.join(root, "skip.tmp"), "excluded");
      await chmod(hidden, 0);
      const peer = storagePeer(
        root,
        async (_source, name) => {
          seen.push(name);
        },
        [".state"],
      );
      peer.config.ignore = ["private", "**/*.tmp"];
      await peer.scanOfflineChanges();
      await vi.waitFor(() => expect(seen).toContain("public.md"));
      expect(seen).toEqual(["public.md"]);
    } finally {
      await chmod(hidden, 0o700);
      await rm(root, { recursive: true, force: true });
    }
  });
  it("drops ignored live changes and deletions including descendant paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-ignore-"));
    try {
      const dispatch = vi.fn(async () => {});
      const peer = storagePeer(root, dispatch, [".state"]);
      peer.config.ignore = ["private"];
      await mkdir(path.join(root, "private"));
      await writeFile(path.join(root, "private/note.md"), "excluded");
      await peer.dispatch(path.join(root, "private/note.md"));
      await peer.dispatchDeleted(path.join(root, "private/deleted.md"));
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("does not propagate a deletion if the file is recreated during the dispatch delay", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-recreate-"));
    try {
      const dispatch = vi.fn(async () => {});
      const peer = storagePeer(root, dispatch);
      const file = path.join(root, "note.md");
      const pending = peer.dispatchDeleted(file);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await writeFile(file, "recreated");
      await pending;
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("propagates recursive folder removal as per-file Node watcher deletions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-recursive-"));
    const seen: string[] = [];
    const peer = storagePeer(
      root,
      async (_source, name, data) => {
        if (data === false) seen.push(name);
      },
      [".state"],
    );
    try {
      peer.config.scanOfflineChanges = false;
      await mkdir(path.join(root, "folder/nested"), { recursive: true });
      await writeFile(path.join(root, "folder/a.md"), "a");
      await writeFile(path.join(root, "folder/nested/b.md"), "b");
      await peer.start();
      await new Promise<void>((resolve) =>
        peer.watcher!.once("ready", resolve),
      );
      await rm(path.join(root, "folder"), { recursive: true });
      await vi.waitFor(
        () =>
          expect(seen.sort()).toEqual(["folder/a.md", "folder/nested/b.md"]),
        { timeout: 4000 },
      );
    } finally {
      await peer.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});

it("reads the latest file contents after coalescing a queued watcher event", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "livesync-watcher-race-"));
  try {
    const seen: string[] = [];
    const peer = storagePeer(root, async (_peer, _path, data) => {
      if (data !== false) seen.push((data.data as string[]).join(""));
    });
    const file = path.join(root, "note.md");
    await writeFile(file, "stale");
    await peer.dispatch(file);
    await writeFile(file, "current");
    await vi.waitFor(() => expect(seen).toEqual(["current"]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
