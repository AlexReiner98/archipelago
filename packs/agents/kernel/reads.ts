// The read of the reads API the agents pack answers (surface's slot surface.reads): what agents are told where, to a
// session about an item. Handed the context of the map that asks, so it reads as the asker.

import type { KernelContext } from '#pelago/kernel';
import { instructionsFor } from './instructions.ts';

/** `instructions: { where, about? }`: what is said there, each counted as said once. */
export const instructions = (ctx: KernelContext, q: { instructions: { where: unknown; about?: unknown } }) =>
  instructionsFor(ctx, String(q.instructions.where), q.instructions.about === undefined ? {} : { about: String(q.instructions.about) });
