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

  it("does not resolve the vulnerable uuid 8 transitive dependency", async () => {
    const lockText = await readFile(
      new URL("../pnpm-lock.yaml", import.meta.url),
      "utf8",
    );

    expect(lockText).not.toContain("uuid@8.3.2");
  });
});

describe("canonical image publication", () => {
  it("builds once by digest and applies tags only after scan and signing", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/publish-ghcr.yaml", import.meta.url),
      "utf8",
    );
    expect(workflow.match(/uses: docker\/build-push-action/g)).toHaveLength(1);
    expect(workflow).toContain("push-by-digest=true");
    const scan = workflow.indexOf("Block critical vulnerabilities");
    const sign = workflow.indexOf("Sign image (keyless)");
    const tag = workflow.indexOf("Publish canonical tags");
    expect(scan).toBeGreaterThan(0);
    expect(sign).toBeGreaterThan(scan);
    expect(tag).toBeGreaterThan(sign);
  });
});
