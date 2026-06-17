import { Config, FileData } from "./types.ts";
import { Peer } from "./Peer.ts";
import { PeerStorage } from "./PeerStorage.ts";
import { PeerCouchDB } from "./PeerCouchDB.ts";

export class Hub {
    conf: Config;
    peers = [] as Peer[];
    constructor(conf: Config) {
        this.conf = conf;
    }
    async start() {
        for (const p of this.peers) {
            await p.stop();
        }
        this.peers = [];
        for (const peer of this.conf.peers) {
            if (peer.type === "couchdb") {
                const p = new PeerCouchDB(peer, this.dispatch.bind(this));
                this.peers.push(p);
            } else if (peer.type === "storage") {
                const p = new PeerStorage(peer, this.dispatch.bind(this));
                this.peers.push(p);
            } else {
                throw new Error(
                    `Unexpected Peer type: ${(peer as any)?.name} - ${
                        (peer as any)?.type
                    }`,
                );
            }
        }
        await Promise.all(this.peers.map((p) => p.start()));
    }

    async dispatch(source: Peer, path: string, data: FileData | false) {
        for (const peer of this.peers) {
            if (
                peer !== source &&
                (source.config.group ?? "") === (peer.config.group ?? "")
            ) {
                if (data === false) {
                    await peer.delete(path);
                } else {
                    await peer.put(path, data);
                }
            }
        }
    }
}
