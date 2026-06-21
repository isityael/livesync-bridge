import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@/common/events", replacement: here("./stubs/events.ts") },
      {
        find: "@/common/KeyValueDB",
        replacement: here("./stubs/KeyValueDB.ts"),
      },
      { find: "@/main", replacement: here("./stubs/obsidian.ts") },
      { find: "@/deps", replacement: here("./stubs/obsidian.ts") },
      { find: "obsidian", replacement: here("./stubs/obsidian.ts") },
      { find: "svelte", replacement: here("./stubs/svelte.ts") },
      {
        find: "@smithy/fetch-http-handler",
        replacement: here("./stubs/smithy-fetch-http-handler.ts"),
      },
      {
        find: "@lib/worker/bgWorker.ts",
        replacement: here("./lib/src/worker/bgWorker.mock.ts"),
      },
      {
        find: "@lib/worker/bgWorker",
        replacement: here("./lib/src/worker/bgWorker.mock.ts"),
      },
      {
        find: "@lib/pouchdb/pouchdb-browser.ts",
        replacement: here("./lib/src/pouchdb/pouchdb-http.ts"),
      },
      { find: /^@\/lib\/src\/(.*)$/, replacement: here("./lib/src/$1") },
      { find: /^@\/common\/(.*)$/, replacement: here("./lib/src/common/$1") },
      { find: /^@lib\/(.*)$/, replacement: here("./lib/src/$1") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
