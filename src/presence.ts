// Moved to packs/presence/kernel/presence.ts (docs/kernel-packs.md, "Where each module goes"). What took the whole
// database and a screen is adapted here: the pack's context is built from the screen's map, and reaches the transient
// store as the whole workspace itself (root.transient), so the database the caller hands is no longer read.
export * from '../packs/presence/kernel/presence.ts';
import * as moved from '../packs/presence/kernel/presence.ts';
import type { Q } from './db.ts';
import type { Archipelago } from './pelago.ts';

const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'presence');
export const point = async (_db: Q, w: Archipelago, focus: moved.Focus) => moved.point(await ctx(w), w, focus);
export const took = async (_db: Q, w: Archipelago, step: Omit<moved.Step, 'at'>, now = false) => moved.took(await ctx(w), w, step, now);
export const listening = async (_db: Q, w: Archipelago, by: 1 | -1) => moved.listening(await ctx(w), by);
export const tellStamp = async (_db: Q, w: Archipelago) => moved.tellStamp(await ctx(w));
export const looked = async (_db: Q, w: Archipelago, page: Omit<moved.Page, 'at'>) => moved.looked(await ctx(w), w, page);
export const watching = async (_db: Q, w: Archipelago) => moved.watching(await ctx(w), w);
export const presence = async (_db: Q, w: Archipelago) => moved.presence(await ctx(w), w);
