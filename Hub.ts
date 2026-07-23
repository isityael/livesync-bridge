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
  private readonly destinationGuards = new Map<Peer, TombstoneSafetyGuard>();
  constructor(
    conf: Config,
    private readonly health = new HealthStatus(),
    private readonly maxTombstonesPerCheckpoint = 10,
    private readonly failureLimit = 3,
    private readonly onFatalFailure: (error: unknown) => void = () => {},
    private readonly watchRetryDelayMs = 10_000,
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
        const guard = new TombstoneSafetyGuard(this.maxTombstonesPerCheckpoint);
        const p = new PeerCouchDB(peer, this.dispatch.bind(this), {
          beginReplay: () => this.health.beginReplay(),
          completeReplay: () => this.health.completeReplay(),
          recordRemoteActivity: (conflicts) =>
            this.health.recordRemoteActivity(conflicts),
          recordCheckpoint: (checkpoint) => {
            this.health.recordCheckpoint();
            guard.advanceCheckpoint(checkpoint);
          },
          confirmBaseline: (checkpoint) => guard.confirmBaseline(checkpoint),
          invalidateBaseline: () => guard.invalidateBaseline(),
          recordFailure: (error) => this.recordFailure(error),
          resetFailures: () => {
            this.consecutiveFailures = 0;
          },
          watchRetryDelayMs: this.watchRetryDelayMs,
        });
        this.destinationGuards.set(p, guard);
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
        if (typeof peer.acceptsPath === "function" && !peer.acceptsPath(path)) {
          continue;
        }
        if (data === false) {
          let tombstoneGuard: TombstoneSafetyGuard | undefined;
          if (
            source.config.type === "storage" &&
            peer.config.type === "couchdb"
          ) {
            tombstoneGuard = this.guardFor(peer);
            if (!tombstoneGuard.allowTombstone()) {
              source.normalLog(
                `Blocked remote tombstone for ${path}: no confirmed baseline or deletion bound exceeded`,
              );
              continue;
            }
          }
          let deleted: boolean;
          try {
            deleted = await peer.delete(path);
          } catch (error) {
            tombstoneGuard?.releaseTombstone();
            throw error;
          }
          if (!deleted) {
            tombstoneGuard?.releaseTombstone();
            throw new Error(`${peer.config.name} failed to delete ${path}`);
          }
        } else {
          const saved = await peer.put(path, data);
          if (!saved) {
            throw new Error(`${peer.config.name} failed to save ${path}`);
          }
        }
      }
    }
  }

  confirmDestinationBaseline(peer: Peer, checkpoint: string): void {
    if (peer.config.type !== "couchdb") {
      throw new Error("Only CouchDB destinations have replay baselines");
    }
    this.guardFor(peer).confirmBaseline(checkpoint);
  }

  private guardFor(peer: Peer): TombstoneSafetyGuard {
    let guard = this.destinationGuards.get(peer);
    if (!guard) {
      guard = new TombstoneSafetyGuard(this.maxTombstonesPerCheckpoint);
      this.destinationGuards.set(peer, guard);
    }
    return guard;
  }

  private recordFailure(error: unknown): boolean {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureLimit) {
      this.health.markUnhealthy();
      this.onFatalFailure(error);
      return false;
    }
    return true;
  }
}
