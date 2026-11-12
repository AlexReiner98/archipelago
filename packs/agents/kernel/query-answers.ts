// What the agents pack answers the query pack by name (pack.json, kernel.provides): the standing view instructions.

import type { KernelContext } from '#pelago/kernel';
import { instructionsFor } from './instructions.ts';

/** `answer.instructions`: what agents are told where (for: what a session is told as it begins, unless said), about a repository, on an island. */
export async function told(ctx: KernelContext, input: { for?: string; about?: string; island?: string }) {
  const where = typeof input?.for === 'string' ? input.for : 'session_start';
  return { said: await instructionsFor(ctx, where, { ...(typeof input?.about === 'string' && { about: input.about }), ...(typeof input?.island === 'string' && { island: input.island }) }) };
}
