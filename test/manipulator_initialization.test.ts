import { afterEach, expect, it, vi } from "vitest";
import { DurableDirectFileManipulator } from "../runtime/durable_manipulator.ts";
import type { FilePathWithPrefix } from "../lib/src/common/types.ts";

afterEach(() => vi.unstubAllGlobals());

it("initializes the real service composition and round-trips an encoded note", async () => {
  const docs = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      paths.push(url.pathname);
      const id = decodeURIComponent(url.pathname.slice("/vault/".length));
      let status = 200;
      let body: unknown;
      if (url.pathname.replace(/\/$/, "") === "/vault")
        body = { db_name: "vault", update_seq: sequence, doc_count: docs.size };
      else if (id === "_bulk_docs") {
        const incoming = JSON.parse(String(init?.body)).docs;
        body = incoming.map((doc: Record<string, unknown>) => {
          const id = String(doc._id);
          const rev = String(doc._rev ?? `${++sequence}-mock`);
          docs.set(id, { ...doc, _rev: rev });
          return { ok: true, id, rev };
        });
      } else if (id === "_all_docs") {
        const keys =
          init?.method === "POST"
            ? JSON.parse(String(init.body)).keys
            : [...docs.keys()];
        body = {
          rows: keys.map((id: string) =>
            docs.has(id)
              ? {
                  id,
                  key: id,
                  value: { rev: docs.get(id)!._rev },
                  doc: docs.get(id),
                }
              : { key: id, error: "not_found" },
          ),
        };
      } else if (id === "_changes") {
        if (url.searchParams.get("feed") === "longpoll") {
          await new Promise((resolve) => setTimeout(resolve, 20));
          if (init?.signal?.aborted)
            throw new DOMException("Aborted", "AbortError");
        }
        body = { results: [], last_seq: sequence };
      } else if (init?.method === "PUT") {
        const doc = JSON.parse(String(init.body));
        const rev = `${++sequence}-mock`;
        docs.set(id, { ...doc, _rev: rev });
        body = { ok: true, id, rev };
      } else if (docs.has(id)) body = docs.get(id);
      else {
        status = 404;
        body = { error: "not_found", reason: "missing" };
      }
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const man = new DurableDirectFileManipulator({
    url: "https://couch.example",
    database: "vault",
    username: "",
    password: "",
    passphrase: "",
    obfuscatePassphrase: "",
  });
  try {
    await man.ready.promise;
    expect(
      await man.put("projects/note.md", ["hello"], {
        ctime: 1,
        mtime: 2,
        size: 5,
      }),
    ).toBe(true);
    const result = await man.get("projects/note.md" as FilePathWithPrefix);
    expect(result).toMatchObject({ path: "projects/note.md", data: ["hello"] });
    expect(paths).toContain("/vault/projects%2Fnote.md");
    expect(await man.followUpdates(async () => {})).toBe(sequence);
    expect(await man.delete("projects/note.md")).toBe(true);
    expect(await man.get("projects/note.md" as FilePathWithPrefix)).toBe(false);
  } finally {
    await man.close();
  }
});
