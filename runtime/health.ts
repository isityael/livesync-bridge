import { createServer, type Server } from "node:http";

export type HealthPhase = "startup" | "replaying" | "healthy" | "unhealthy";
export type HealthState = "startup" | "healthy" | "stale" | "unhealthy";

export interface HealthSnapshot {
  status: HealthState;
  phase: HealthPhase;
  lastSuccessfulCheckpointTime: string | null;
  lastRemoteActivityTime: string | null;
  conflictCount: number;
  replayActive: boolean;
}

export class HealthStatus {
  private phase: HealthPhase = "startup";
  private lastCheckpoint: Date | null = null;
  private lastRemoteActivity: Date | null = null;
  private conflicts = 0;
  private activeReplays = 0;
  private lastReplayProgress = Date.now();

  constructor(private readonly staleAfterMs = 300_000) {}

  beginReplay(): void {
    this.phase = "replaying";
    this.activeReplays += 1;
    this.lastReplayProgress = Date.now();
  }

  completeReplay(): void {
    this.activeReplays = Math.max(0, this.activeReplays - 1);
  }

  markHealthy(): void {
    this.phase = "healthy";
  }

  markUnhealthy(): void {
    this.phase = "unhealthy";
    this.activeReplays = 0;
  }

  recordRemoteActivity(conflicts = 0, at = new Date()): void {
    this.lastRemoteActivity = at;
    this.lastReplayProgress = at.getTime();
    this.conflicts += Math.max(0, conflicts);
  }

  recordCheckpoint(at = new Date()): void {
    this.lastCheckpoint = at;
    this.lastReplayProgress = at.getTime();
  }

  snapshot(now = Date.now()): HealthSnapshot {
    let status: HealthState;
    if (this.phase === "unhealthy") {
      status = "unhealthy";
    } else if (
      this.activeReplays > 0 &&
      now - this.lastReplayProgress > this.staleAfterMs
    ) {
      status = "stale";
    } else if (this.phase === "healthy") {
      status = "healthy";
    } else {
      status = "startup";
    }

    return {
      status,
      phase: this.phase,
      lastSuccessfulCheckpointTime: this.lastCheckpoint?.toISOString() ?? null,
      lastRemoteActivityTime: this.lastRemoteActivity?.toISOString() ?? null,
      conflictCount: this.conflicts,
      replayActive: this.activeReplays > 0,
    };
  }
}

export interface HealthServer {
  readonly port: number;
  close(): Promise<void>;
}

export async function startHealthServer(
  status: HealthStatus,
  port = 8080,
): Promise<HealthServer> {
  const server: Server = createServer((request, response) => {
    if (request.url !== "/healthz") {
      response.writeHead(404).end();
      return;
    }

    const snapshot = status.snapshot();
    response.writeHead(snapshot.status === "healthy" ? 200 : 503, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(snapshot));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Health server did not bind to a TCP port");
  }

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
