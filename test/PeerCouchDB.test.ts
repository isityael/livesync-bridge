import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PeerCouchDB } from "../PeerCouchDB.ts";
import { installLocalStorage } from "../runtime/node_compat.ts";
import type { PeerCouchDBConf } from "../types.ts";

function couchPeer(stateDir: string): PeerCouchDB {
  installLocalStorage(stateDir);
  localStorage.clear();
  const config: PeerCouchDBConf = {
    type: "couchdb",
    name: "test-couch",
    baseDir: "",
    url: "http://127.0.0.1:5984",
    database: "obsidian",
    username: "test",
    password: "test",
    passphrase: "",
    obfuscatePassphrase: "",
  };
  return new PeerCouchDB(config, async () => {});
}

describe("PeerCouchDB watch checkpoints", () => {
  it("fully replays remote-only notes, tombstones, conflicts, and ignore rules before confirming a baseline", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-couch-"));
    const dispatched: Array<{ path: string; deleted: boolean }> = [];
    const lifecycle: string[] = [];
    try {
      installLocalStorage(root, true);
      localStorage.clear();
      const config: PeerCouchDBConf = {
        type: "couchdb",
        name: "test-couch",
        baseDir: "",
        url: "http://127.0.0.1:5984",
        database: "obsidian",
        username: "test",
        password: "test",
        passphrase: "",
        obfuscatePassphrase: "",
        ignorePaths: [".obsidian"],
      };
      const peer = new PeerCouchDB(
        config,
        async (_source, notePath, data) => {
          dispatched.push({ path: notePath, deleted: data === false });
        },
        {
          beginReplay: () => lifecycle.push("replay:start"),
          completeReplay: () => lifecycle.push("replay:complete"),
          recordRemoteActivity: (conflicts: number) =>
            lifecycle.push(`activity:${conflicts}`),
          recordCheckpoint: (checkpoint: string) =>
            lifecycle.push(`checkpoint:${checkpoint}`),
          confirmBaseline: (checkpoint: string) =>
            lifecycle.push(`baseline:${checkpoint}`),
          invalidateBaseline: () => lifecycle.push("baseline:invalid"),
        },
      );
      peer.setSetting("remote-created", "old-database");
      peer.setSetting("since", "stale-sequence");

      let watchSince: string | number | undefined;
      peer.man = {
        ready: { promise: Promise.resolve() },
        since: "stale-sequence",
        rawGet: async () => ({ created: "new-database" }),
        liveSyncLocalDB: {
          localDatabase: {
            info: async () => ({ db_name: "obsidian", doc_count: 4 }),
          },
        },
        followUpdates: async (
          callback: (entry: Record<string, any>, seq: string) => Promise<void>,
          interested: (entry: Record<string, any>) => boolean,
        ) => {
          const entries = [
            {
              path: "remote-only.md",
              type: "plain",
              data: ["remote"],
              ctime: 1,
              mtime: 1,
              size: 6,
            },
            {
              path: "conflict.md",
              type: "plain",
              data: ["resolved"],
              ctime: 2,
              mtime: 2,
              size: 8,
              _conflicts: ["1-a", "1-b"],
            },
            {
              path: "deleted.md",
              type: "plain",
              data: [],
              ctime: 3,
              mtime: 3,
              size: 0,
              deleted: true,
            },
            {
              path: ".obsidian/private.json",
              type: "plain",
              data: ["secret"],
              ctime: 4,
              mtime: 4,
              size: 6,
            },
          ];
          let sequence = 0;
          for (const entry of entries) {
            sequence += 1;
            if (interested(entry)) {
              await callback(entry, `${sequence}`);
            }
          }
          return "4";
        },
        beginWatch: () => {
          watchSince = peer.man.since;
        },
      } as never;

      await peer.start();

      expect(dispatched).toEqual([
        { path: "remote-only.md", deleted: false },
        { path: "conflict.md", deleted: false },
        { path: "deleted.md", deleted: true },
      ]);
      expect(lifecycle).toEqual(
        expect.arrayContaining([
          "baseline:invalid",
          "replay:start",
          "activity:2",
          "checkpoint:4",
          "baseline:4",
          "replay:complete",
        ]),
      );
      expect(peer.getSetting("since")).toBe("4");
      expect(watchSince).toBe("4");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not advance or confirm a checkpoint when replay dispatch crashes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-couch-"));
    const confirmed: string[] = [];
    try {
      installLocalStorage(root, true);
      localStorage.clear();
      const config: PeerCouchDBConf = {
        type: "couchdb",
        name: "test-couch",
        baseDir: "",
        url: "http://127.0.0.1:5984",
        database: "obsidian",
        username: "test",
        password: "test",
        passphrase: "",
        obfuscatePassphrase: "",
      };
      const peer = new PeerCouchDB(
        config,
        async () => {
          throw new Error("filesystem unavailable");
        },
        {
          beginReplay: () => {},
          completeReplay: () => {},
          recordRemoteActivity: () => {},
          recordCheckpoint: () => {},
          confirmBaseline: (checkpoint: string) => confirmed.push(checkpoint),
          invalidateBaseline: () => {},
        },
      );
      peer.man = {
        ready: { promise: Promise.resolve() },
        since: "now",
        rawGet: async () => ({ created: "database" }),
        liveSyncLocalDB: {
          localDatabase: {
            info: async () => ({ db_name: "obsidian", doc_count: 1 }),
          },
        },
        followUpdates: async (
          callback: (entry: Record<string, any>, seq: string) => Promise<void>,
        ) => {
          await callback(
            {
              path: "remote-only.md",
              type: "plain",
              data: ["remote"],
              ctime: 1,
              mtime: 1,
              size: 6,
            },
            "1",
          );
          return "1";
        },
        beginWatch: () => {},
      } as never;

      await expect(peer.start()).rejects.toThrow("filesystem unavailable");
      expect(peer.getSetting("since")).toBe("0");
      expect(confirmed).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("always clears replay health state when replay fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-couch-"));
    let activeReplays = 0;
    try {
      installLocalStorage(root, true);
      localStorage.clear();
      const peer = couchPeer(root);
      peer.setSetting("remote-created", "old");
      peer.man = {
        ready: { promise: Promise.resolve() },
        since: "now",
        rawGet: async () => ({ created: "new" }),
        liveSyncLocalDB: {
          localDatabase: {
            info: async () => ({ db_name: "obsidian", doc_count: 1 }),
          },
        },
        followUpdates: async () => {
          throw new Error("changes feed failed");
        },
        beginWatch: () => {},
      } as never;
      Object.assign(peer, {
        runtime: {
          beginReplay: () => {
            activeReplays += 1;
          },
          completeReplay: () => {
            activeReplays -= 1;
          },
          recordRemoteActivity: () => {},
          recordCheckpoint: () => {},
          confirmBaseline: () => {},
          invalidateBaseline: () => {},
        },
      });

      await expect(peer.start()).rejects.toThrow("changes feed failed");
      expect(activeReplays).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses sequence zero after a remote database rebuild", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-couch-"));
    try {
      const peer = couchPeer(root);
      peer.setSetting("remote-created", "old-database");
      peer.setSetting("since", "stale-sequence");

      let watchSince: string | number | undefined;
      peer.man = {
        ready: { promise: Promise.resolve() },
        since: "stale-sequence",
        rawGet: async () => ({ created: "new-database" }),
        liveSyncLocalDB: {
          localDatabase: {
            info: async () => ({ db_name: "obsidian", doc_count: 1 }),
          },
        },
        beginWatch: () => {
          watchSince = peer.man.since;
        },
        followUpdates: async () => "0",
      } as never;

      await peer.start();

      expect(watchSince).toBe("0");
      expect(peer.getSetting("since")).toBe("0");
      expect(peer.getSetting("remote-created")).toBe("new-database");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists the sequence only after processing a watched change", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-couch-"));
    try {
      const peer = couchPeer(root);
      peer.setSetting("remote-created", "same-database");
      peer.setSetting("baseline-remote", "same-database");
      peer.setSetting("since", "12-old");

      let watchCallback:
        | ((entry: Record<string, any>, seq?: string | number) => Promise<void>)
        | undefined;
      peer.man = {
        ready: { promise: Promise.resolve() },
        since: "12-old",
        rawGet: async () => ({ created: "same-database" }),
        liveSyncLocalDB: {
          localDatabase: {
            info: async () => ({ db_name: "obsidian", doc_count: 1 }),
          },
        },
        beginWatch: (callback: typeof watchCallback) => {
          watchCallback = callback;
        },
      } as never;

      await peer.start();
      expect(watchCallback).toBeDefined();

      await watchCallback?.(
        {
          type: "plain",
          path: "notes/example.md",
          data: ["hello"],
          ctime: 1,
          mtime: 1,
          size: 5,
          deleted: false,
        },
        "13-new",
      );

      expect(peer.man.since).toBe("13-new");
      expect(peer.getSetting("since")).toBe("13-new");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
