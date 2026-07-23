import { describe, expect, it } from "vitest";
import { Hub } from "../Hub.ts";
import { HealthStatus } from "../runtime/health.ts";
import { TombstoneSafetyGuard } from "../runtime/sync_safety.ts";
import type { Peer } from "../Peer.ts";

describe("Hub tombstone propagation", () => {
  it("blocks remote deletes until a baseline is confirmed and when the bound is exceeded", async () => {
    const guard = new TombstoneSafetyGuard(1);
    const hub = new Hub({ peers: [] }, new HealthStatus(), guard);
    const source = {
      config: { type: "storage", name: "local", baseDir: "", group: "notes" },
      normalLog: () => {},
    } as unknown as Peer;
    let remoteDeletes = 0;
    const remote = {
      config: {
        type: "couchdb",
        name: "remote",
        baseDir: "",
        group: "notes",
      },
      delete: async () => {
        remoteDeletes += 1;
        return true;
      },
    } as unknown as Peer;
    hub.peers = [source, remote];

    await hub.dispatch(source, "first.md", false);
    guard.confirmBaseline("12");
    await hub.dispatch(source, "second.md", false);
    await hub.dispatch(source, "third.md", false);

    expect(remoteDeletes).toBe(1);
  });
});
