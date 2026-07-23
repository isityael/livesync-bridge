import { Config, FileData } from "./types.ts";
import { Peer } from "./Peer.ts";
import { PeerStorage } from "./PeerStorage.ts";
import { PeerCouchDB } from "./PeerCouchDB.ts";
import { HealthStatus } from "./runtime/health.ts";
import { TombstoneSafetyGuard } from "./runtime/sync_safety.ts";

export class Hub {
  conf: Config;
  peers = [] as Peer[];
  private consecutiveFailures = 0;
  constructor(
    conf: Config,
    private readonly health = new HealthStatus(),
    private readonly tombstoneGuard = new TombstoneSafetyGuard(),
    private readonly failureLimit = 3,
    private readonly onFatalFailure: (error: unknown) => void = () => {},
  ) {
    this.conf = conf;
  }
  async start() {
    for (const p of this.peers) {
      await p.stop();
    }
    this.peers = [];
    for (const peer of this.conf.peers) {
      if (peer.type === "couchdb") {
        const p = new PeerCouchDB(peer, this.dispatch.bind(this), {
          beginReplay: () => this.health.beginReplay(),
          completeReplay: () => this.health.completeReplay(),
          recordRemoteActivity: (conflicts) =>
            this.health.recordRemoteActivity(conflicts),
          recordCheckpoint: () => this.health.recordCheckpoint(),
          confirmBaseline: (checkpoint) =>
            this.tombstoneGuard.confirmBaseline(checkpoint),
          invalidateBaseline: () => this.tombstoneGuard.invalidateBaseline(),
          recordFailure: (error) => this.recordFailure(error),
          resetFailures: () => {
            this.consecutiveFailures = 0;
          },
        });
        this.peers.push(p);
      } else if (peer.type === "storage") {
        const p = new PeerStorage(peer, this.dispatch.bind(this));
        this.peers.push(p);
      } else {
        throw new Error(
          `Unexpected Peer type: ${(peer as any)?.name} - ${
            (peer as any)?.type
          }`,
        );
      }
    }
    await Promise.all(this.peers.map((p) => p.start()));
    this.health.markHealthy();
  }

  async stop() {
    await Promise.all(this.peers.map((peer) => peer.stop()));
  }

  async dispatch(source: Peer, path: string, data: FileData | false) {
    for (const peer of this.peers) {
      if (
        peer !== source &&
        (source.config.group ?? "") === (peer.config.group ?? "")
      ) {
        if (data === false) {
          if (
            source.config.type === "storage" &&
            peer.config.type === "couchdb" &&
            !this.tombstoneGuard.allowTombstone()
          ) {
            source.normalLog(
              `Blocked remote tombstone for ${path}: no confirmed baseline or deletion bound exceeded`,
            );
            continue;
          }
          await peer.delete(path);
        } else {
          await peer.put(path, data);
        }
      }
    }
  }

  private recordFailure(error: unknown): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureLimit) {
      this.health.markUnhealthy();
      this.onFatalFailure(error);
    }
  }
}
