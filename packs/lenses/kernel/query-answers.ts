// What the lenses pack answers the query pack by name (pack.json, kernel.provides): the hubs within an item or a place,
// read for the kernel's lens answer hubs, and the views kept on the map, for the standing view saved_views.

import type { KernelContext } from '#pelago/kernel';
import { HUB_AT, hubs } from './query-kept.ts';
import { savedViews } from './saved-views.ts';

/** `answer.hubs_of`: the hubs within an item (or the whole map's), and the size at which one counts where its project does not say. */
export const hubsOf = async (ctx: KernelContext, input: { within?: string }) => ({ at: HUB_AT, hubs: await hubs(ctx, input?.within === undefined ? undefined : String(input.within)) });

/** `answer.saved_views`: every view kept on the map, the kept first, then the newest. */
export const saved = (ctx: KernelContext, input: { limit?: number }) => savedViews(ctx, input ?? {});
