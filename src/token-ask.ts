// Moved to packs/connect/kernel/token-ask.ts (docs/kernel-packs.md, "Where each module goes"). What took the map (or,
// for a system's request and its poll, the workspace's database) is adapted here: the connect pack's context of the
// workspace's map is built when it is called, and keeps the requests in its transient store through root.transient.
export * from '../packs/connect/kernel/token-ask.ts';
import * as moved from '../packs/connect/kernel/token-ask.ts';
import type { Archipelago } from './pelago.ts';

/** The connect pack's context of a map. */
export const context = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'connect');

export const watchedAt = async (l: Archipelago, address: string) => moved.watchedAt(await context(l), address);
export const askForToken = async (l: Archipelago, input: unknown) => moved.askForToken(await context(l), input);
export const pollForToken = async (l: Archipelago, id: string, secret: string) => moved.pollForToken(await context(l), id, secret);
