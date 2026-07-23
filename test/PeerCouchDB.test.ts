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
