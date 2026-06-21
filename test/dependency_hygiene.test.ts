import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("dependency hygiene", () => {
  it("does not use abandoned xxhash-wasm package", async () => {
    const packageText = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );
    const lockText = await readFile(
      new URL("../pnpm-lock.yaml", import.meta.url),
      "utf8",
    ).catch(() => "");

    expect(packageText).not.toContain("xxhash-wasm");
    expect(lockText).not.toContain("xxhash-wasm");
  });
});
