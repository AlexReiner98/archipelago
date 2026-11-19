// What the agents pack answers the query pack by name (pack.json, kernel.provides): the standing view instructions.

import type { KernelContext } from '#pelago/kernel';
import { instructionsAt, instructionsFor } from './instructions.ts';

/**
 * `answer.instructions`: what agents are told where (`where`, or `for`; what a session is told as it begins, unless
 * said), about a repository, on an island, with names filled in (`fill`: {run} in a session's start). Asked for
 * several places (`wheres`), the words at each, one string a place (what is said there, one after another), read
 * once: the parts a hook or the server composes its answer of. `count: false` says them without counting them.
 */
export async function told(ctx: KernelContext, input: { where?: string; for?: string; wheres?: string[]; about?: string; island?: string; fill?: Record<string, string>; run?: string; count?: boolean }) {
  if (Array.isArray(input?.wheres)) {
    const fill = input.fill && typeof input.fill === 'object' ? Object.fromEntries(Object.entries(input.fill).map(([k, v]) => [k, String(v)])) : undefined;
    const at = await instructionsAt(ctx, input.wheres.map(String), { ...(typeof input.about === 'string' && { about: input.about }), ...(typeof input.island === 'string' && { island: input.island }), ...(fill && { fill }), ...(typeof input.run === 'string' && input.run && { run: input.run }), ...(input.count === false && { count: false }) });
    return { at: Object.fromEntries(Object.entries(at).map(([where, said]) => [where, said.map((one) => one.text).join(' ')])) };
  }
  const where = typeof input?.where === 'string' ? input.where : typeof input?.for === 'string' ? input.for : 'session_start';
  const fill = input?.fill && typeof input.fill === 'object' ? Object.fromEntries(Object.entries(input.fill).map(([k, v]) => [k, String(v)])) : undefined;
  return { said: await instructionsFor(ctx, where, { ...(typeof input?.about === 'string' && { about: input.about }), ...(typeof input?.island === 'string' && { island: input.island }), ...(fill && { fill }), ...(typeof input?.run === 'string' && input.run && { run: input.run }) }) };
}

/**
 * `answer.rules_file`: the working rules file (.claude/pelago.md) as this map says it, written into each checkout from
 * the map at a session's start: the server's frame with the map's working_rules (root.rules_file, the surface's).
 */
export const rulesFile = (ctx: KernelContext, input: { run?: string }) =>
  ctx.call<object, { text: string }>('root.rules_file', { ...(typeof input?.run === 'string' && input.run && { run: input.run }) });
