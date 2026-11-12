// What the agents pack answers the query pack by name (pack.json, kernel.provides): the standing view instructions.

import type { KernelContext } from '#pelago/kernel';
import { instructionsFor } from './instructions.ts';

/**
 * `answer.instructions`: what agents are told where (`where`, or `for`; what a session is told as it begins, unless
 * said), about a repository, on an island, with names filled in (`fill`: {run} in a session's start).
 */
export async function told(ctx: KernelContext, input: { where?: string; for?: string; about?: string; island?: string; fill?: Record<string, string> }) {
  const where = typeof input?.where === 'string' ? input.where : typeof input?.for === 'string' ? input.for : 'session_start';
  const fill = input?.fill && typeof input.fill === 'object' ? Object.fromEntries(Object.entries(input.fill).map(([k, v]) => [k, String(v)])) : undefined;
  return { said: await instructionsFor(ctx, where, { ...(typeof input?.about === 'string' && { about: input.about }), ...(typeof input?.island === 'string' && { island: input.island }), ...(fill && { fill }) }) };
}
