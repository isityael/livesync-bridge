import { describe, expect, it } from "vitest";
import { putEntryDocumentWithRetry } from "../lib/src/managers/EntryManager/EntryManagerImpls.ts";

function document() {
  return {
    _id: "note.md",
    path: "note.md",
    type: "plain",
    children: [],
    ctime: 1,
    mtime: 2,
    size: 4,
    eden: {},
  };
}

describe("metadata writes during replication", () => {
  it("rereads the revision and retries an ordinary 409 race", async () => {
    let revision = "1-original";
    const seen: string[] = [];
    const db = {
      get: async () => ({ _rev: revision }),
      put: async (doc: { _rev?: string }) => {
        seen.push(doc._rev ?? "missing");
        if (seen.length === 1) {
          revision = "2-replicated";
          throw Object.assign(new Error("Document update conflict."), {
            status: 409,
          });
        }
        if (doc._rev !== revision) throw new Error("stale revision");
        return { ok: true, id: "note.md", rev: "3-saved" };
      },
    };

    const result = await putEntryDocumentWithRetry(
      db as unknown as Parameters<typeof putEntryDocumentWithRetry>[0],
      document() as Parameters<typeof putEntryDocumentWithRetry>[1],
    );
    expect(result).toMatchObject({ ok: true, rev: "3-saved" });
    expect(seen).toEqual(["1-original", "2-replicated"]);
  });

  it("returns failure after bounded conflicts and propagates other errors", async () => {
    let attempts = 0;
    const conflicting = {
      get: async () => ({ _rev: "1-current" }),
      put: async () => {
        attempts++;
        throw Object.assign(new Error("conflict"), { status: 409 });
      },
    };
    const input = document() as Parameters<typeof putEntryDocumentWithRetry>[1];
    expect(
      await putEntryDocumentWithRetry(
        conflicting as unknown as Parameters<
          typeof putEntryDocumentWithRetry
        >[0],
        input,
      ),
    ).toBe(false);
    expect(attempts).toBe(5);

    const denied = {
      get: async () => ({ _rev: "1-current" }),
      put: async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
    };
    await expect(
      putEntryDocumentWithRetry(
        denied as unknown as Parameters<typeof putEntryDocumentWithRetry>[0],
        document() as Parameters<typeof putEntryDocumentWithRetry>[1],
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
