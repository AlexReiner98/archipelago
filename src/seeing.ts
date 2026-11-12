// Moved to packs/presence/kernel/seeing.ts (docs/kernel-packs.md, "Where each module goes"). What took the map or the
// whole database is adapted here: the pack's context is built from the screen's map, reads items as it does, and
// reaches the transient store as the whole workspace itself (root.transient).
export * from '../packs/presence/kernel/seeing.ts';
import * as moved from '../packs/presence/kernel/seeing.ts';
import type { Q } from './db.ts';
import type { Archipelago } from './pelago.ts';

const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'presence');
export const seen = async (_db: Q, w: Archipelago, page: string, at: string, tab?: moved.Seen['tab'], lands?: string[]) => moved.seen(await ctx(w), w, page, at, tab, lands);
export const seenNow = async (_db: Q, w: Archipelago) => moved.seenNow(await ctx(w), w);
export const seeing = async (l: Archipelago, s: moved.Seen, run?: string) => moved.seeing(await ctx(l), s, run);
export const seeingLine = async (l: Archipelago, _db: Q, run?: string) => moved.seeingLine(await ctx(l), l, run);
export const inSight = async (l: Archipelago, _db: Q, run: string | undefined, open: number) => moved.inSight(await ctx(l), l, run, open);
