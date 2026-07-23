import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("mise toolchain activation", () => {
  it("places the pinned Node 26 and pnpm 11 binaries first for ordinary mise exec", async () => {
    const mise = path.join(process.env.HOME ?? "", ".local/bin/mise");
    const { stdout } = await execFileAsync(mise, [
      "exec",
      "--",
      "sh",
      "-c",
      "command -v node; node --version; command -v pnpm; pnpm --version",
    ]);
    const [nodePath, nodeVersion, pnpmPath, pnpmVersion] = stdout
      .trim()
      .split("\n");

    expect(nodePath).toContain("/.local/share/mise/installs/node/26/bin/node");
    expect(nodeVersion).toMatch(/^v26\./);
    expect(pnpmPath).toContain("/.local/share/mise/installs/pnpm/11/pnpm");
    expect(pnpmVersion).toMatch(/^11\./);
  });
});
