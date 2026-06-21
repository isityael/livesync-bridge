import { defaultLoggerEnv } from "./lib/src/common/logger.ts";
import { LOG_LEVEL_DEBUG } from "./lib/src/common/logger.ts";
import { LOG_LEVEL_INFO } from "./lib/src/common/logger.ts";
import { Hub } from "./Hub.ts";
import { Config } from "./types.ts";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  assertLocalStorageHealthy,
  installLocalStorage,
  localStorageStateDir,
  recoverMalformedLocalStorage,
} from "./runtime/node_compat.ts";

const KEY = "LSB_";
const debugLogging =
  (process.env[`${KEY}DEBUG`] ?? "").toLowerCase() === "true";
defaultLoggerEnv.minLogLevel = debugLogging ? LOG_LEVEL_DEBUG : LOG_LEVEL_INFO;
const configFile = process.env[`${KEY}CONFIG`] || "./dat/config.json";
const stateDir = localStorageStateDir();

installLocalStorage(stateDir);

console.log("LiveSync Bridge is now starting...");
let config: Config = { peers: [] };
const { values: flags } = parseArgs({
  args: process.argv.slice(2),
  options: {
    reset: {
      type: "boolean",
      default: false,
    },
  },
});
if (flags.reset) {
  try {
    localStorage.clear();
  } catch (error) {
    const recovered = await recoverMalformedLocalStorage(
      stateDir,
      "reset",
      error,
    );
    if (!recovered) {
      throw error;
    }
    localStorage.clear();
  }
}
try {
  assertLocalStorageHealthy();
} catch (error) {
  const recovered = await recoverMalformedLocalStorage(
    stateDir,
    "startup probe",
    error,
  );
  if (!recovered) {
    throw error;
  }
  assertLocalStorageHealthy();
}
try {
  const confText = await readFile(configFile, "utf8");
  config = JSON.parse(confText);
} catch (ex) {
  console.error("Could not load or parse configuration!");
  console.error(ex);
  process.exit(1);
}
if (!Array.isArray(config.peers) || config.peers.length === 0) {
  console.error("Configuration must define at least one peer.");
  process.exit(1);
}
console.log("LiveSync Bridge is now started!");
const hub = new Hub(config);
try {
  await hub.start();
} catch (ex) {
  console.error("LiveSync Bridge startup failed!");
  console.error(ex);
  process.exit(1);
}
