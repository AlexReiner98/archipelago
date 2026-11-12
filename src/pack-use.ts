// Moved to the usage pack (docs/kernel-packs.md, "Where each module goes"): this shim keeps its importers working until
// the gather step rewrites them. What took the map is handed the pack's context of it, made when it is called
// (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/usage/kernel/pack-use.ts';

export * from '../packs/usage/kernel/pack-use.ts';

/** The usage pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'usage');

export const withUse = async <S extends Parameters<typeof moved.withUse>[1][number]>(l: Archipelago, states: S[]) => moved.withUse(await ctx(l), states);
