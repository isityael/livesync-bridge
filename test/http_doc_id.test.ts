import { afterEach, expect, it, vi } from "vitest";
import { PouchDB } from "../lib/src/pouchdb/pouchdb-http.ts";

afterEach(() => vi.unstubAllGlobals());

it("routes a note ID containing slashes as one CouchDB document", async () => {
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      paths.push(url.pathname);
      const body =
        init?.method === "PUT"
          ? { ok: true, id: "projects/note.md", rev: "2-new" }
          : { _id: "projects/note.md", _rev: "1-old" };
      return new Response(JSON.stringify(body), {
        status: init?.method === "PUT" ? 201 : 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  const db = new PouchDB("https://couch.example/obsidian");
  const previous = await db.get("projects/note.md");
  await db.put({ _id: "projects/note.md", _rev: previous._rev });

  expect(paths).toEqual([
    "/obsidian/projects%2Fnote.md",
    "/obsidian/projects%2Fnote.md",
  ]);
});
