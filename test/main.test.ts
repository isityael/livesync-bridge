import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  installLocalStorage,
  recoverMalformedLocalStorage,
} from "../runtime/node_compat.ts";

function runBuiltMain(
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/main.js"], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

describe("main", () => {
  it("exits non-zero when config file is missing", async () => {
    const result = await runBuiltMain({
      LSB_CONFIG: path.join(
        tmpdir(),
        `livesync-bridge-missing-${crypto.randomUUID()}.json`,
      ),
    });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Could not load or parse configuration");
  });

  it("recovers malformed localStorage files without exposing values", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livesync-bridge-state-"));
    try {
      const locationData = path.join(root, "location_data");
      await mkdir(locationData, { recursive: true });
      await writeFile(path.join(locationData, "local_storage"), "bad");
      await writeFile(path.join(locationData, "local_storage-wal"), "bad");

      installLocalStorage(root);
      const recovered = await recoverMalformedLocalStorage(
        root,
        "test",
        new Error("database disk image is malformed"),
      );

      expect(recovered).toBe(true);
      expect(localStorage.getItem("__missing__")).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
