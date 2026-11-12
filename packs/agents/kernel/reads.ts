// The read of the reads API the agents pack answers (surface's slot surface.reads): what agents are told where, to a
// session about an item. Handed the context of the map that asks, so it reads as the asker.

import type { KernelContext } from '#pelago/kernel';
import { instructionsFor } from './instructions.ts';

/** `instructions: { where, about? }`: what is said there, each counted as said once. */
export const instructions = (ctx: KernelContext, q: { instructions: { where: unknown; about?: unknown } }) =>
  instructionsFor(ctx, String(q.instructions.where), q.instructions.about === undefined ? {} : { about: String(q.instructions.about) });

/** answer.instructions: what agents are told where (`where`), about an item, on an island, with names filled in: a session's start, for the tool surface. */
export const instructionsAnswer = (ctx: KernelContext, input: { where: string; about?: string; island?: string; fill?: Record<string, string> }) => {
  const { where, ...rest } = input;
  return instructionsFor(ctx, String(where), rest);
};
