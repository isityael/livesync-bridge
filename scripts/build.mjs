import * as esbuild from "esbuild";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, "..");
const fromRepo = (...parts) => path.join(repo, ...parts);

const exactAliases = new Map([
  ["@/common/events", fromRepo("stubs/events.ts")],
  ["@/common/KeyValueDB", fromRepo("stubs/KeyValueDB.ts")],
  ["@/main", fromRepo("stubs/obsidian.ts")],
  ["@/deps", fromRepo("stubs/obsidian.ts")],
  ["obsidian", fromRepo("stubs/obsidian.ts")],
  ["svelte", fromRepo("stubs/svelte.ts")],
  [
    "@smithy/fetch-http-handler",
    fromRepo("stubs/smithy-fetch-http-handler.ts"),
  ],
  ["@lib/worker/bgWorker.ts", fromRepo("lib/src/worker/bgWorker.mock.ts")],
  ["@lib/worker/bgWorker", fromRepo("lib/src/worker/bgWorker.mock.ts")],
  [
    "@lib/pouchdb/pouchdb-browser.ts",
    fromRepo("lib/src/pouchdb/pouchdb-http.ts"),
  ],
  ["./lib/src/worker/bgWorker.ts", fromRepo("lib/src/worker/bgWorker.mock.ts")],
  ["./lib/src/worker/bgWorker", fromRepo("lib/src/worker/bgWorker.mock.ts")],
  [
    "./lib/src/pouchdb/pouchdb-browser.ts",
    fromRepo("lib/src/pouchdb/pouchdb-http.ts"),
  ],
]);

function resolveImportPath(importPath) {
  const candidates = [
    importPath,
    `${importPath}.ts`,
    `${importPath}.js`,
    path.join(importPath, "index.ts"),
    path.join(importPath, "index.js"),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  return resolved ?? importPath;
}

const aliasPlugin = {
  name: "livesync-bridge-aliases",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      const exact = exactAliases.get(args.path);
      if (exact) return { path: exact };

      if (args.path.endsWith(".svelte")) {
        return { path: fromRepo("stubs/svelte.ts") };
      }
      if (args.path.startsWith("@lib/")) {
        return {
          path: resolveImportPath(
            fromRepo("lib/src", args.path.slice("@lib/".length)),
          ),
        };
      }
      if (args.path.startsWith("@/lib/src/")) {
        return {
          path: resolveImportPath(
            fromRepo("lib/src", args.path.slice("@/lib/src/".length)),
          ),
        };
      }
      if (args.path.startsWith("@/common/")) {
        return {
          path: resolveImportPath(
            fromRepo("lib/src/common", args.path.slice("@/common/".length)),
          ),
        };
      }
      return undefined;
    });
  },
};

await mkdir(fromRepo("dist"), { recursive: true });

await esbuild.build({
  absWorkingDir: repo,
  bundle: true,
  entryPoints: [fromRepo("main.ts")],
  external: ["node:*"],
  format: "esm",
  logLevel: "info",
  outfile: fromRepo("dist/main.js"),
  platform: "node",
  sourcemap: true,
  target: "node26",
  plugins: [aliasPlugin],
});
