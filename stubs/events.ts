// Barrel re-export: combines event constants + hub for @/common/events resolution.
// The headless bridge does not dispatch UI events, so keep this permissive for
// upstream UI-only code that the bridge still sees during type checking.
import { eventHub as baseEventHub } from "../lib/src/hub/hub.ts";

export const eventHub = baseEventHub as unknown as {
  emitEvent(event: string, data?: unknown): void;
  once(event: string, callback: (...args: unknown[]) => void): () => void;
};
export * from "../lib/src/events/coreEvents.ts";
