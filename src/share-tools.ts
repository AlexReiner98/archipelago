// Moved to packs/publish/kernel/share-tools.ts (docs/kernel-packs.md, "Moving a service in the wave"). The tools are
// declared there with their inputs as JSON shapes, run on the publish pack's context: the surface builds their schemas
// and hands each run the context `context` makes of the map it is called on (packs/surface/kernel/tools.ts).
export * from '../packs/publish/kernel/share-tools.ts';
import * as moved from '../packs/publish/kernel/share-tools.ts';
import type { Archipelago } from './pelago.ts';

/** The publish pack's context of a map. */
export const context = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'publish');

type Rest<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;
export const shareAsk = async (l: Archipelago, ...rest: Rest<typeof moved.shareAsk>) => moved.shareAsk(await context(l), ...rest);
export const publishAsk = async (l: Archipelago, ...rest: Rest<typeof moved.publishAsk>) => moved.publishAsk(await context(l), ...rest);
