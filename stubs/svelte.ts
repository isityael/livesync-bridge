// Server-side stub for svelte — SvelteDialog is UI-only, unused in bridge
export function getContext<T>(_key: unknown): T { return undefined as T; }
export function setContext(_key: unknown, _value: unknown): void {}
export function mount(_component: unknown, _options: unknown): unknown { return {}; }
export function unmount(_component: unknown): void {}
export type Component<Props = Record<string, unknown>> = unknown;

declare global {
    interface HTMLElement {
        empty(): void;
    }
}
