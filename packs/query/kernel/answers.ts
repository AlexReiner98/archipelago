// The query pack's answers by name, for the packs that ask for the flat lens (the lenses pack: a kept view's picture,
// where an item is drawn, whether a saved view can draw). The flat lens is read where it always was, by the reads API's
// `view` read of the core view flat (src/query-presets.ts, READINGS), as the map that asks: this module holds no map.

import type { KernelContext } from '#pelago/kernel';

/** The most items one answer of the flat lens sends (query-flat.ts, LENS_LIMIT). */
const LENS_LIMIT = 2000;

/** `answer.flat`: the flat lens answered, its params as the query flat takes them. */
export const flat = (ctx: KernelContext, input: Record<string, unknown>) => ctx.reads({ view: 'flat', params: input });

/**
 * `answer.flat_check`: why a lens cannot be read, or nothing. It is read for one item, so a check costs a query of one;
 * its own limit, which that replaces, is checked here as the query checks it.
 */
export async function flatCheck(ctx: KernelContext, input: Record<string, unknown>): Promise<{ problem?: string }> {
  const limit = input.limit;
  if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > LENS_LIMIT)) return { problem: `limit must be a whole number from 1 to ${LENS_LIMIT}` };
  try {
    await ctx.reads({ view: 'flat', params: { ...input, limit: 1 } });
    return {};
  } catch (e) {
    return { problem: (e as Error).message };
  }
}
