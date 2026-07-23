import { describe, expect, it } from "vitest";
import { Hub } from "../Hub.ts";
import { HealthStatus } from "../runtime/health.ts";
import type { Peer } from "../Peer.ts";

describe("Hub tombstone propagation", () => {
  it("authorizes tombstones independently for each CouchDB destination", async () => {
    const hub = new Hub({ peers: [] }, new HealthStatus(), 1);
    const source = {
      config: { type: "storage", name: "local", baseDir: "", group: "notes" },
      normalLog: () => {},
    } as unknown as Peer;
    let firstDeletes = 0;
    let secondDeletes = 0;
    const firstRemote = {
      config: {
        type: "couchdb",
        name: "first-remote",
        baseDir: "",
        group: "notes",
      },
      delete: async () => {
        firstDeletes += 1;
        return true;
      },
    } as unknown as Peer;
    const secondRemote = {
      config: {
        type: "couchdb",
        name: "second-remote",
        baseDir: "",
        group: "notes",
      },
      delete: async () => {
        secondDeletes += 1;
        return true;
      },
    } as unknown as Peer;
    hub.peers = [source, firstRemote, secondRemote];

    await hub.dispatch(source, "first.md", false);
    hub.confirmDestinationBaseline(firstRemote, "12");
    await hub.dispatch(source, "second.md", false);
    await hub.dispatch(source, "third.md", false);

    expect(firstDeletes).toBe(1);
    expect(secondDeletes).toBe(0);
  });

  it("rejects a dispatch when a destination reports that its write failed", async () => {
    const hub = new Hub({ peers: [] });
    const source = {
      config: { type: "couchdb", name: "remote", baseDir: "", group: "notes" },
    } as unknown as Peer;
    const destination = {
      config: { type: "storage", name: "local", baseDir: "", group: "notes" },
      put: async () => false,
    } as unknown as Peer;
    hub.peers = [source, destination];

    await expect(
      hub.dispatch(source, "remote-only.md", {
        ctime: 1,
        mtime: 1,
        size: 4,
        data: ["safe"],
      }),
    ).rejects.toThrow("local failed to save remote-only.md");
  });

  it("does not consume the tombstone budget when the destination delete fails", async () => {
    const hub = new Hub({ peers: [] }, new HealthStatus(), 1);
    const source = {
      config: { type: "storage", name: "local", baseDir: "", group: "notes" },
      normalLog: () => {},
    } as unknown as Peer;
    let attempts = 0;
    const destination = {
      config: { type: "couchdb", name: "remote", baseDir: "", group: "notes" },
      delete: async () => {
        attempts += 1;
        return attempts > 1;
      },
    } as unknown as Peer;
    hub.peers = [source, destination];
    hub.confirmDestinationBaseline(destination, "12");

    await expect(hub.dispatch(source, "retry.md", false)).rejects.toThrow(
      "remote failed to delete retry.md",
    );
    await hub.dispatch(source, "retry.md", false);

    expect(attempts).toBe(2);
  });
});
