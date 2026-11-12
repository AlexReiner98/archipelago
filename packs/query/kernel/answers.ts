// The query pack's answers by name, for the packs that ask for the flat lens (the lenses pack: a kept view's picture,
// where an item is drawn, whether a saved view can draw). The flat lens is read here as the map that asks; asked by
// name, it is no use of the view core.flat, and is not counted as one.

import type { KernelContext } from '#pelago/kernel';
import { flatProblem, flatRead } from './query-flat.ts';

/** `answer.flat`: the flat lens answered, its params as the query flat takes them. */
export const flat = (ctx: KernelContext, input: Record<string, unknown>) => flatRead(ctx, input ?? {});

/** `answer.flat_check`: why a lens cannot be read, or nothing. Checked by reading the lens as the query does, nothing asked of the map. */
export const flatCheck = async (ctx: KernelContext, input: Record<string, unknown>): Promise<{ problem?: string }> => {
  const problem = flatProblem(ctx, input ?? {});
  return problem === undefined ? {} : { problem };
};
