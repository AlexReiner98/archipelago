// Moved to the usage pack (docs/kernel-packs.md, "Where each module goes"): the view, which took the map, is adapted
// here, building the pack's context when it is called.
export * from '../packs/usage/kernel/usage.ts';
import * as moved from '../packs/usage/kernel/usage.ts';
import type { Archipelago } from './pelago.ts';

const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'usage');
export const usage = async (l: Archipelago, ...rest: Parameters<typeof moved.usage> extends [unknown, ...infer R] ? R : never) => moved.usage(await ctx(l), ...rest);
