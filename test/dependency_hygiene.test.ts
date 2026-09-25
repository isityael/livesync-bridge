import { access, readFile } from "node:fs/promises";
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
  it("builds one private candidate and promotes only after blocking scan and signing", async () => {
    const workflow = await readFile(
      new URL("../.woodpecker/build.yaml", import.meta.url),
      "utf8",
    );
    expect(workflow.match(/name: build-candidate/g)).toHaveLength(1);
    expect(workflow).toContain(
      "repo: git.m0sh1.cc/m0sh1-internal/livesync-bridge",
    );
    expect(workflow).toContain("candidate-${CI_COMMIT_SHA}");
    expect(workflow).toContain("from_secret: forgejo_package_token");
    expect(workflow).not.toContain("ghcr.io");
    expect(workflow).toContain("provenance: mode=max");
    expect(workflow).toContain("sbom: true");
    expect(workflow).toContain(
      "trivy image --exit-code 1 --severity HIGH,CRITICAL",
    );
    const scan = workflow.indexOf("name: scan-candidate");
    const sign = workflow.indexOf("name: sign-candidate");
    const tag = workflow.indexOf("name: promote-release");
    expect(scan).toBeGreaterThan(0);
    expect(sign).toBeGreaterThan(scan);
    expect(tag).toBeGreaterThan(sign);
    expect(workflow.slice(scan, tag)).not.toContain("failure: ignore");
    await expect(
      access(
        new URL("../.github/workflows/publish-ghcr.yaml", import.meta.url),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
