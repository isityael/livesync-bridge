// Server-side stub for @/common/KeyValueDB (browser IndexedDB API)
// Returns an in-memory Map-backed implementation so the service layer
// initialises without errors. Data is ephemeral (lost on restart).
import type { KeyValueDatabase } from "../lib/src/interfaces/KeyValueDatabase.ts";

class InMemoryKeyValueDatabase implements KeyValueDatabase {
    private store = new Map<string, unknown>();

    async get<T>(key: IDBValidKey): Promise<T> {
        return this.store.get(String(key)) as T;
    }
    async set<T>(key: IDBValidKey, value: T): Promise<IDBValidKey> {
        this.store.set(String(key), value);
        return key;
    }
    async del(key: IDBValidKey): Promise<void> {
        this.store.delete(String(key));
    }
    async clear(): Promise<void> {
        this.store.clear();
    }
    async keys(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<IDBValidKey[]> {
        const all = [...this.store.keys()];
        if (count !== undefined) return all.slice(0, count);
        return all;
    }
    async close(): Promise<void> {}
    async destroy(): Promise<void> {
        this.store.clear();
    }
}

export async function OpenKeyValueDatabase(_name: string): Promise<KeyValueDatabase> {
    return new InMemoryKeyValueDatabase();
}
