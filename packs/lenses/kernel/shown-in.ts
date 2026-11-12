// answer.shown_in: the views an item is drawn in (./query-saved.ts, shownIn), for the surface's get. Answered as the
// map that asks, under its row-level security.

import type { KernelContext } from '#pelago/kernel';
import { shownIn } from './query-saved.ts';

type Trail = Parameters<typeof shownIn>[2];

export const shownInOf = (ctx: KernelContext, input: { id: string; trail: Trail }) => shownIn(ctx, String(input?.id), input.trail);
