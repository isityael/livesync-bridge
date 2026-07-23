import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HealthStatus, startHealthServer } from "../runtime/health.ts";
import { retryWithFailureLimit } from "../runtime/retry.ts";
import { TombstoneSafetyGuard } from "../runtime/sync_safety.ts";
import {
  installLocalStorage,
  recoverMalformedLocalStorage,
} from "../runtime/node_compat.ts";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("health endpoint", () => {
  it("distinguishes startup, healthy, and stale replay without exposing data", async () => {
    const status = new HealthStatus(10);
    const server = await startHealthServer(status, 0);
    servers.push(server);

    let response = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "startup",
      phase: "startup",
      lastSuccessfulCheckpointTime: null,
      lastRemoteActivityTime: null,
      conflictCount: 0,
      replayActive: false,
    });

    status.beginReplay();
    await new Promise((resolve) => setTimeout(resolve, 15));
    response = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "stale",
      replayActive: true,
    });

    status.recordRemoteActivity(2);
    status.recordCheckpoint(new Date("2026-07-23T12:00:00.000Z"));
    status.completeReplay();
    status.markHealthy();
    response = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "healthy",
      phase: "healthy",
      lastSuccessfulCheckpointTime: "2026-07-23T12:00:00.000Z",
      conflictCount: 2,
      replayActive: false,
    });
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("content");
  });

  it("stays in replay while any peer replay remains active", () => {
    const status = new HealthStatus();
    status.beginReplay();
    status.beginReplay();
    status.completeReplay();

    expect(status.snapshot().replayActive).toBe(true);
  });

  it("cannot report healthy while a replay is active", () => {
    const status = new HealthStatus();
    status.beginReplay();
    status.markHealthy();

    expect(status.snapshot()).toMatchObject({
      status: "startup",
      phase: "replaying",
      replayActive: true,
    });
  });
});

describe("bounded failures", () => {
  it("throws after the configured consecutive failure limit", async () => {
    let attempts = 0;
    await expect(
      retryWithFailureLimit(
        async () => {
          attempts += 1;
          throw new Error("remote unavailable");
        },
        { failureLimit: 3, retryDelayMs: 0 },
      ),
    ).rejects.toThrow("remote unavailable");
    expect(attempts).toBe(3);
  });
});

describe("tombstone safety", () => {
  it("requires a confirmed baseline and resets the bound only for a new checkpoint", () => {
    const guard = new TombstoneSafetyGuard(2);
    expect(guard.allowTombstone()).toBe(false);

    guard.confirmBaseline("checkpoint-12");
    expect(guard.allowTombstone()).toBe(true);
    expect(guard.allowTombstone()).toBe(true);
    expect(guard.allowTombstone()).toBe(false);
    guard.confirmBaseline("checkpoint-12");
    expect(guard.allowTombstone()).toBe(false);
    guard.advanceCheckpoint("checkpoint-13");
    expect(guard.allowTombstone()).toBe(true);
  });
});

describe("persistent checkpoint recovery", () => {
  it("restores valid checkpoint data from LSB_STATE_DIR", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-state-"));
    try {
      installLocalStorage(root, true);
      localStorage.setItem("checkpoint", "17");
      installLocalStorage(root, true);
      expect(localStorage.getItem("checkpoint")).toBe("17");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("quarantines malformed state instead of silently deleting it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-state-"));
    try {
      const stateFile = path.join(root, "location_data", "local_storage.json");
      await mkdir(path.dirname(stateFile), { recursive: true });
      await writeFile(stateFile, "{malformed");

      expect(() => installLocalStorage(root, true)).toThrow(
        "database disk image is malformed",
      );
      await expect(
        recoverMalformedLocalStorage(
          root,
          "test",
          new Error("database disk image is malformed"),
        ),
      ).resolves.toBe(true);

      expect(localStorage.length).toBe(0);
      const entries = await readdir(path.dirname(stateFile));
      const quarantine = entries.find((entry) =>
        entry.startsWith("local_storage.json.corrupt-"),
      );
      expect(quarantine).toBeDefined();
      expect(
        await readFile(path.join(path.dirname(stateFile), quarantine!), "utf8"),
      ).toBe("{malformed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
