// Server-side stub for @/common/KeyValueDB (browser IndexedDB API)
// livesync-bridge runs as a Deno server — KeyValueDB is unused.
import type { KeyValueDatabase } from "../lib/src/interfaces/KeyValueDatabase.ts";

export async function OpenKeyValueDatabase(_name: string): Promise<KeyValueDatabase> {
    throw new Error("KeyValueDB is not available in server context");
}
