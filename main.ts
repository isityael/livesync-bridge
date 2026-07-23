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
import { HealthStatus, startHealthServer } from "./runtime/health.ts";
import { retryWithFailureLimit } from "./runtime/retry.ts";
import { TombstoneSafetyGuard } from "./runtime/sync_safety.ts";

const KEY = "LSB_";
const debugLogging =
  (process.env[`${KEY}DEBUG`] ?? "").toLowerCase() === "true";
defaultLoggerEnv.minLogLevel = debugLogging ? LOG_LEVEL_DEBUG : LOG_LEVEL_INFO;
const configFile = process.env[`${KEY}CONFIG`] || "./dat/config.json";
const stateDir = localStorageStateDir();

try {
  installLocalStorage(stateDir);
} catch (error) {
  const recovered = await recoverMalformedLocalStorage(
    stateDir,
    "initialization",
    error,
  );
  if (!recovered) {
    throw error;
  }
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const health = new HealthStatus(
  positiveInteger(`${KEY}STALE_AFTER_MS`, 300_000),
);
const healthServer = await startHealthServer(
  health,
  positiveInteger(`${KEY}HEALTH_PORT`, 8080),
);
console.log(
  `LiveSync Bridge health endpoint listening on port ${healthServer.port}`,
);

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
const failureLimit = positiveInteger(`${KEY}MAX_CONSECUTIVE_FAILURES`, 3);
const hub = new Hub(
  config,
  health,
  new TombstoneSafetyGuard(
    positiveInteger(`${KEY}MAX_TOMBSTONES_PER_CHECKPOINT`, 10),
  ),
  failureLimit,
  (error) => {
    console.error(
      `LiveSync Bridge reached ${failureLimit} consecutive runtime failures.`,
    );
    console.error(error);
    process.exit(1);
  },
);
try {
  await retryWithFailureLimit(() => hub.start(), {
    failureLimit,
    retryDelayMs: positiveInteger(`${KEY}RETRY_DELAY_MS`, 10_000),
    onFailure: (error, failures) => {
      console.error(
        `LiveSync Bridge startup attempt ${failures}/${failureLimit} failed.`,
      );
      console.error(error);
    },
  });
} catch (ex) {
  health.markUnhealthy();
  console.error("LiveSync Bridge startup failed!");
  console.error(ex);
  process.exit(1);
}
