// Moved to packs/look_draw/kernel/looks.ts (docs/kernel-packs.md, "Where each module goes"); its pass stays in the
// walls (src/look-pass.ts). What took the whole database and a screen is adapted here: the pack's context is built
// from the screen's map, reads the log's head as it, and reaches the roots through root.transient and root.look.
export * from '../packs/look_draw/kernel/looks.ts';
import * as moved from '../packs/look_draw/kernel/looks.ts';
import type { Q } from './db.ts';
import type { Archipelago } from './pelago.ts';

type Size = Parameters<typeof moved.takeLook>[4];
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'look_draw');
export const takeLook = async (_db: Q, _mapDb: Q, w: Archipelago, actor: string, hash: string, size?: Size) => moved.takeLook(await ctx(w), w, actor, hash, size);
export const lookAt = async (_db: Q, w: Archipelago, look: string) => moved.lookAt(await ctx(w), w, look);
export const countLook = async (l: Archipelago, by?: string) => moved.countLook(await ctx(l), by);
