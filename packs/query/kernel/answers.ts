// The query pack's answers by name, for the packs that ask for the flat lens (the lenses pack: a kept view's picture,
// where an item is drawn, whether a saved view can draw). The flat lens is read here as the map that asks; asked by
// name, it is no use of the view core.flat, and is not counted as one.

import type { KernelContext } from '#pelago/kernel';
import { askView } from './askview.ts';
import { flatProblem, flatRead, readFlat, termsOf } from './query-flat.ts';
import type { Actor } from './views.ts';

/** `answer.flat`: the flat lens answered, its params as the query flat takes them. */
export const flat = (ctx: KernelContext, input: Record<string, unknown>) => flatRead(ctx, input ?? {});

/** `answer.flat_check`: why a lens cannot be read, or nothing. Checked by reading the lens as the query does, nothing asked of the map. */
export const flatCheck = async (ctx: KernelContext, input: Record<string, unknown>): Promise<{ problem?: string }> => {
  const problem = flatProblem(ctx, input ?? {});
  return problem === undefined ? {} : { problem };
};

/** `answer.flat_lens`: the lens asked for, each field checked against the terms the packs here provide; refused as the query refuses it. */
export const flatLens = (ctx: KernelContext, input: Record<string, unknown>) => readFlat(termsOf(ctx), input ?? {});

/** `answer.ask_view`: a standing question answered by its name, as the one who asked (./askview.ts). */
export const askedView = (ctx: KernelContext, input: { actor: Actor; name: string; params?: Record<string, unknown> }) => askView(ctx, input.actor, input.name, input.params ?? {});
