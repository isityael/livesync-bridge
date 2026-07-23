import type { EntryDoc } from "../lib/src/common/types.ts";
import {
  DirectFileManipulator,
  type MetaEntry,
  type ReadyEntry,
} from "../lib/src/API/DirectFileManipulatorV2.ts";
import { compatGlobal } from "../lib/src/common/coreEnvFunctions.ts";

function isNoteEntry(doc: EntryDoc | false): doc is MetaEntry {
  return Boolean(doc && (doc.type === "newnote" || doc.type === "plain"));
}

/**
 * Makes PouchDB's event-emitter changes API durable for async consumers.
 *
 * The upstream manipulator attaches async event listeners directly. Event
 * emitters do not await those promises, so a feed can complete while writes
 * are still in flight and callback failures can be swallowed. This adapter
 * serializes callbacks and makes feed completion depend on the whole chain.
 */
export class DurableDirectFileManipulator extends DirectFileManipulator {
  private watchGeneration = 0;

  override async followUpdates(
    callback: (
      doc: ReadyEntry,
      seq?: string | number,
    ) => Promise<unknown> | void,
    checkIsInterested?: (doc: MetaEntry) => boolean,
  ): Promise<string | number> {
    if (this.since === "") {
      this.since = "0";
    }

    let callbackChain = Promise.resolve();
    let callbackError: unknown;
    const changes = this.liveSyncLocalDB.localDatabase
      .changes({
        include_docs: true,
        conflicts: true,
        since: this.since,
        live: false,
      })
      .on("change", (change) => {
        callbackChain = callbackChain.then(async () => {
          const doc = change.doc;
          if (!isNoteEntry(doc)) return;
          if (checkIsInterested && !checkIsInterested(doc)) return;
          const ready = await this.getByMeta(doc);
          await callback(ready, change.seq);
        });
        void callbackChain.catch((error) => {
          callbackError = error;
          changes.cancel();
        });
      });

    let result: PouchDB.Core.ChangesResponse<EntryDoc>;
    try {
      result = await changes;
    } catch (feedError) {
      await callbackChain.catch(() => undefined);
      if (callbackError) throw callbackError;
      throw feedError;
    }
    await callbackChain;
    if (callbackError) throw callbackError;
    return result.last_seq;
  }

  override beginWatch(
    callback: (
      doc: ReadyEntry,
      seq?: string | number,
    ) => Promise<unknown> | void,
    checkIsInterested?: (doc: MetaEntry) => boolean,
    onFailure?: (error: unknown) => boolean | void,
    retryDelayMs = 10_000,
  ) {
    if (this.watching) return false;
    this.watchGeneration = (this.watchGeneration ?? 0) + 1;
    const generation = this.watchGeneration;
    this.watching = true;
    let callbackChain = Promise.resolve();
    let failureReported = false;

    const reportFailure = (error: unknown) => {
      if (failureReported) return;
      failureReported = true;
      const shouldReconnect = onFailure?.(error) === true;
      this.watching = false;
      this.changes = undefined;
      if (shouldReconnect) {
        compatGlobal.setTimeout(() => {
          if (generation === this.watchGeneration) {
            this.beginWatch(
              callback,
              checkIsInterested,
              onFailure,
              retryDelayMs,
            );
          }
        }, retryDelayMs);
      }
    };

    const changes = this.liveSyncLocalDB.localDatabase
      .changes({
        include_docs: true,
        conflicts: true,
        selector: { type: { $ne: "leaf" } },
        since: this.since,
        live: true,
      })
      .on("change", (change) => {
        callbackChain = callbackChain.then(async () => {
          const doc = change.doc;
          if (!isNoteEntry(doc)) return;
          if (checkIsInterested && !checkIsInterested(doc)) return;
          const ready = await this.getByMeta(doc);
          await callback(ready, change.seq);
        });
        void callbackChain.catch((error) => {
          changes.cancel();
          reportFailure(error);
        });
      })
      .on("complete", () => {
        void callbackChain.then(
          () => {
            if (this.watching) {
              reportFailure(
                new Error("Live changes feed completed unexpectedly"),
              );
            }
          },
          (error) => reportFailure(error),
        );
      })
      .on("error", (feedError) => {
        void callbackChain.then(
          () => reportFailure(feedError),
          (callbackError) => reportFailure(callbackError),
        );
      });
    this.changes = changes;
    return true;
  }

  override endWatch(): void {
    this.watchGeneration = (this.watchGeneration ?? 0) + 1;
    this.watching = false;
    const changes = this.changes;
    this.changes = undefined;
    changes?.cancel();
  }
}
