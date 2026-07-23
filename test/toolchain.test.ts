import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("mise toolchain activation", () => {
  it("pins Node 26 and pnpm 11 in the repository configuration", async () => {
    const config = await readFile(".mise.toml", "utf8");

    expect(config).toMatch(/^node = "26"$/m);
    expect(config).toMatch(/^pnpm = "11"$/m);
  });

  it("places the pinned Node 26 and pnpm 11 binaries first for ordinary mise exec", async () => {
    const { stdout: misePath } = await execFileAsync("sh", [
      "-c",
      "command -v mise || true",
    ]);
    const mise = misePath.trim();
    if (!mise) {
      return;
    }

    const { stdout } = await execFileAsync(
      mise,
      [
        "exec",
        "--",
        "sh",
        "-c",
        "command -v node; node --version; command -v pnpm; pnpm --version",
      ],
      { env: { ...process.env, CI: "true" } },
    );
    const [nodePath, nodeVersion, pnpmPath, pnpmVersion] = stdout
      .trim()
      .split("\n");

    expect(nodePath).toContain("/.local/share/mise/installs/node/26/bin/node");
    expect(nodeVersion).toMatch(/^v26\./);
    expect(pnpmPath).toContain("/.local/share/mise/installs/pnpm/11/pnpm");
    expect(pnpmVersion).toMatch(/^11\./);
  });
});
