// Moved to packs/styles/kernel/styles.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the pack's context of it, made
// when it is called (kernelContext): the call stays in-process and direct, as it was, never through a service name.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/styles/kernel/styles.ts';

export * from '../packs/styles/kernel/styles.ts';

/** The styles pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'styles');

type Rest<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;

export const styleFor = async (l: Archipelago, ...rest: Rest<typeof moved.styleFor>) => moved.styleFor(await ctx(l), ...rest);
export const drawn = async (l: Archipelago, ...rest: Rest<typeof moved.drawn>) => moved.drawn(await ctx(l), ...rest);
export const withStyles = async <T extends { styles: moved.Preset[] }>(l: Archipelago, described: T) => moved.withStyles(await ctx(l), described);
export const pageStyle = async (l: Archipelago, ...rest: Rest<typeof moved.pageStyle>) => moved.pageStyle(await ctx(l), ...rest);
export const iconOf = async (l: Archipelago) => moved.iconOf(await ctx(l));
export const pageLook = async (l: Archipelago, ...rest: Rest<typeof moved.pageLook>) => moved.pageLook(await ctx(l), ...rest);
