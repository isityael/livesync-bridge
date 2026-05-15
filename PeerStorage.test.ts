import { PeerStorage } from "./PeerStorage.ts";
import type { FileData, PeerStorageConf } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function textData(text: string): FileData {
    return {
        ctime: Date.now(),
        mtime: Date.now(),
        size: text.length,
        data: [text],
    };
}

function storagePeer(baseDir: string): PeerStorage {
    const conf: PeerStorageConf = {
        type: "storage",
        name: "test-storage",
        baseDir,
    };
    return new PeerStorage(conf, async () => {});
}

Deno.test("PeerStorage rejects writes outside baseDir", async () => {
    const root = await Deno.makeTempDir();
    try {
        const baseDir = `${root}/vault`;
        await Deno.mkdir(baseDir);
        const peer = storagePeer(baseDir);

        const result = await peer.put("../escape.md", textData("owned"));

        assert(result === false, "expected escaped write to be rejected");
        const escaped = await Deno.readTextFile(`${root}/escape.md`).catch(
            () => null,
        );
        assert(escaped === null, "escaped file was written outside baseDir");
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("PeerStorage writes safe paths under baseDir", async () => {
    const root = await Deno.makeTempDir();
    try {
        const baseDir = `${root}/vault`;
        await Deno.mkdir(baseDir);
        const peer = storagePeer(baseDir);

        const result = await peer.put("notes/example.md", textData("ok"));

        assert(result === true, "expected safe write to succeed");
        const written = await Deno.readTextFile(`${baseDir}/notes/example.md`);
        assert(written === "ok", "expected file to be written under baseDir");
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
