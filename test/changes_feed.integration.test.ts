import PouchDB from "pouchdb-core";
import MemoryAdapter from "pouchdb-adapter-memory";
import HttpAdapter from "pouchdb-adapter-http";
import { afterEach, describe, expect, it } from "vitest";
import { DurableDirectFileManipulator } from "../runtime/durable_manipulator.ts";

PouchDB.plugin(MemoryAdapter);
PouchDB.plugin(HttpAdapter);

const databases: Array<PouchDB.Database> = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.destroy()));
});

function manipulatorFor(
  database: PouchDB.Database,
): DurableDirectFileManipulator {
  const manipulator = Object.create(
    DurableDirectFileManipulator.prototype,
  ) as DurableDirectFileManipulator;
  Object.assign(manipulator, {
    since: "0",
    watching: false,
    liveSyncLocalDB: { localDatabase: database },
    getByMeta: async (doc: unknown) => doc,
  });
  return manipulator;
}

describe("durable PouchDB changes-feed processing", () => {
  it("awaits concurrent change callbacks before resolving the replay sequence", async () => {
    const database = new PouchDB("changes-concurrency", { adapter: "memory" });
    databases.push(database);
    await database.bulkDocs([
      {
        _id: "first",
        path: "first.md",
        type: "plain",
        data: ["first"],
        ctime: 1,
        mtime: 1,
        size: 5,
      },
      {
        _id: "second",
        path: "second.md",
        type: "plain",
        data: ["second"],
        ctime: 2,
        mtime: 2,
        size: 6,
      },
    ]);
    const manipulator = manipulatorFor(database);
    const completed: string[] = [];

    const sequence = await manipulator.followUpdates(async (doc) => {
      if (doc.path === "first.md") {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      completed.push(doc.path);
    });

    expect(completed).toEqual(["first.md", "second.md"]);
    expect(Number(sequence)).toBeGreaterThanOrEqual(2);
  });

  it("rejects replay when an asynchronous destination callback fails", async () => {
    const database = new PouchDB("changes-callback-error", {
      adapter: "memory",
    });
    databases.push(database);
    await database.put({
      _id: "remote-only",
      path: "remote-only.md",
      type: "plain",
      data: ["preserve me"],
      ctime: 1,
      mtime: 1,
      size: 11,
    });
    const manipulator = manipulatorFor(database);

    await expect(
      manipulator.followUpdates(async () => {
        await Promise.resolve();
        throw new Error("destination unavailable");
      }),
    ).rejects.toThrow("destination unavailable");
  });

  it("preserves remote-only, conflict, and tombstone entries through a real feed", async () => {
    const database = new PouchDB("changes-content-safety", {
      adapter: "memory",
    });
    databases.push(database);
    await database.bulkDocs([
      {
        _id: "remote-only",
        path: "remote-only.md",
        type: "plain",
        data: ["preserve me"],
        ctime: 1,
        mtime: 1,
        size: 11,
      },
      {
        _id: "tombstone",
        path: "tombstone.md",
        type: "plain",
        data: [],
        deleted: true,
        ctime: 4,
        mtime: 4,
        size: 0,
      },
    ]);
    await database.bulkDocs(
      [
        {
          _id: "conflict",
          _rev: "1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          _revisions: {
            start: 1,
            ids: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
          },
          path: "conflict.md",
          type: "plain",
          data: ["first branch"],
          ctime: 2,
          mtime: 2,
          size: 12,
        },
        {
          _id: "conflict",
          _rev: "1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          _revisions: {
            start: 1,
            ids: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
          },
          path: "conflict.md",
          type: "plain",
          data: ["second branch"],
          ctime: 3,
          mtime: 3,
          size: 13,
        },
      ],
      { new_edits: false },
    );
    const manipulator = manipulatorFor(database);
    const destination = new Map<string, unknown>();

    await manipulator.followUpdates(async (doc) => {
      destination.set(doc.path, doc.deleted ? false : doc.data);
    });

    expect(destination.get("remote-only.md")).toEqual(["preserve me"]);
    expect(destination.has("conflict.md")).toBe(true);
    expect(destination.get("tombstone.md")).toBe(false);
  });

  it("propagates a real feed error instead of returning the old checkpoint", async () => {
    const database = new PouchDB("http://127.0.0.1:1/unavailable");
    const manipulator = manipulatorFor(database);

    await expect(
      manipulator.followUpdates(async () => {}),
    ).rejects.toBeDefined();
  });

  it("stops reconnecting a failing live watcher at the configured bound", async () => {
    const database = new PouchDB("changes-watch-bound", { adapter: "memory" });
    databases.push(database);
    await database.put({
      _id: "bad-destination",
      path: "bad-destination.md",
      type: "plain",
      data: ["retry"],
      ctime: 1,
      mtime: 1,
      size: 5,
    });
    const manipulator = manipulatorFor(database);
    let failures = 0;

    manipulator.beginWatch(
      async () => {
        throw new Error("destination unavailable");
      },
      undefined,
      () => {
        failures += 1;
        return failures < 2;
      },
      0,
    );

    await expect.poll(() => failures, { timeout: 1_000 }).toBe(2);
    expect(manipulator.watching).toBe(false);
  });

  it("does not reconnect an intentionally stopped watcher", async () => {
    const database = new PouchDB("changes-watch-stop", { adapter: "memory" });
    databases.push(database);
    const manipulator = manipulatorFor(database);
    let failures = 0;

    manipulator.beginWatch(
      async () => {},
      undefined,
      () => {
        failures += 1;
        return true;
      },
      0,
    );
    manipulator.endWatch();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(failures).toBe(0);
    expect(manipulator.watching).toBe(false);
  });
});
