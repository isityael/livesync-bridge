import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { PeerStorage } from "../PeerStorage.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat) };
});

it("uses integer Node change time when the filesystem reports no birth time", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "livesync-file-time-"));
  try {
    const file = path.join(root, "note.md");
    await writeFile(file, "content");
    const snapshot = await stat(file);
    Object.assign(snapshot, {
      birthtime: new Date(0),
      birthtimeMs: 0,
      ctimeMs: 1234.75,
    });
    vi.mocked(stat).mockResolvedValueOnce(snapshot);
    const peer = new PeerStorage(
      { type: "storage", name: "timestamp", baseDir: root },
      async () => {},
    );
    const data = await peer.get("note.md");
    expect(data && data.ctime).toBe(1234);
    expect(await readFile(file, "utf8")).toBe("content");
  } finally {
    vi.mocked(stat).mockClear();
    await rm(root, { recursive: true, force: true });
  }
});
