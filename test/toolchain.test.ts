import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function packagePnpmVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  expect(manifest.packageManager).toMatch(/^pnpm@12\.\d+\.\d+$/);
  return manifest.packageManager.slice("pnpm@".length);
}

describe("mise toolchain activation", () => {
  it("pins Node 26 and the package-declared pnpm version in mise", async () => {
    const config = await readFile(".mise.toml", "utf8");

    expect(config).toMatch(/^node = "26"$/m);
    expect(config).toContain(`pnpm = "${await packagePnpmVersion()}"`);
  });

  it("places the pinned toolchain first for ordinary mise exec", async () => {
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
    const pinnedPnpmVersion = await packagePnpmVersion();
    expect(pnpmPath).toContain(
      `/.local/share/mise/installs/pnpm/${pinnedPnpmVersion}/pnpm`,
    );
    expect(pnpmVersion).toBe(pinnedPnpmVersion);
  });
});
