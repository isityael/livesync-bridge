import { defaultLoggerEnv } from "./lib/src/common/logger.ts";
import { LOG_LEVEL_DEBUG } from "./lib/src/common/logger.ts";
import { LOG_LEVEL_INFO } from "./lib/src/common/logger.ts";
import { Hub } from "./Hub.ts";
import { Config } from "./types.ts";
import { parseArgs } from "jsr:@std/cli";

const KEY = "LSB_";
const MALFORMED_LOCAL_STORAGE_MARKER = "database disk image is malformed";
const CORRUPT_LOCAL_STORAGE_FILES = new Set([
    "local_storage",
    "local_storage-shm",
    "local_storage-wal",
]);
const debugLogging =
    (Deno.env.get(`${KEY}DEBUG`) ?? "").toLowerCase() === "true";
defaultLoggerEnv.minLogLevel = debugLogging ? LOG_LEVEL_DEBUG : LOG_LEVEL_INFO;
const configFile = Deno.env.get(`${KEY}CONFIG`) || "./dat/config.json";

function isMalformedLocalStorageError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }
    return error.message.toLowerCase().includes(MALFORMED_LOCAL_STORAGE_MARKER);
}

async function removeCorruptLocalStorageFiles(dir: string): Promise<number> {
    let removed = 0;
    try {
        for await (const entry of Deno.readDir(dir)) {
            const path = `${dir}/${entry.name}`;
            if (entry.isDirectory) {
                removed += await removeCorruptLocalStorageFiles(path);
                continue;
            }
            if (entry.isFile && CORRUPT_LOCAL_STORAGE_FILES.has(entry.name)) {
                await Deno.remove(path);
                removed += 1;
            }
        }
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            return 0;
        }
        throw error;
    }
    return removed;
}

function assertLocalStorageHealthy() {
    const healthKey = "__lsb_local_storage_healthcheck__";
    localStorage.setItem(healthKey, "1");
    localStorage.removeItem(healthKey);
}

async function recoverMalformedLocalStorage(
    stage: string,
    error: unknown,
): Promise<boolean> {
    if (!isMalformedLocalStorageError(error)) {
        return false;
    }

    const reason = error instanceof Error ? error.message : String(error);
    console.error(
        `[livesync-bridge] malformed localStorage detected during ${stage}: ${reason}`,
    );

    const denoDir = Deno.env.get("DENO_DIR");
    if (!denoDir) {
        console.error(
            "[livesync-bridge] DENO_DIR is not set; cannot recover localStorage.",
        );
        return false;
    }

    const locationDataDir = `${denoDir}/location_data`;
    const removedFiles = await removeCorruptLocalStorageFiles(locationDataDir);
    console.error(
        `[livesync-bridge] removed ${removedFiles} corrupted localStorage files under ${locationDataDir}`,
    );

    try {
        localStorage.clear();
    } catch (_clearError) {
        // Ignore; the file removal above is the important recovery step.
    }

    try {
        assertLocalStorageHealthy();
        console.log("[livesync-bridge] localStorage recovery succeeded");
        return true;
    } catch (probeError) {
        const probeMessage = probeError instanceof Error
            ? probeError.message
            : String(probeError);
        console.error(
            `[livesync-bridge] localStorage recovery probe failed: ${probeMessage}`,
        );
        return false;
    }
}

console.log("LiveSync Bridge is now starting...");
let config: Config = { peers: [] };
const flags = parseArgs(Deno.args, {
    boolean: ["reset"],
    // string: ["version"],
    default: { reset: false },
});
if (flags.reset) {
    try {
        localStorage.clear();
    } catch (error) {
        const recovered = await recoverMalformedLocalStorage("reset", error);
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
        "startup probe",
        error,
    );
    if (!recovered) {
        throw error;
    }
    assertLocalStorageHealthy();
}
try {
    const confText = await Deno.readTextFile(configFile);
    config = JSON.parse(confText);
} catch (ex) {
    console.error("Could not parse configuration!");
    console.error(ex);
}
console.log("LiveSync Bridge is now started!");
const hub = new Hub(config);
hub.start();
