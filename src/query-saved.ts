// Moved to packs/lenses/kernel/query-saved.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps
// its importers working until the gather step rewrites them. What took the map is handed the lenses pack's context of
// it, made when it is called (kernelContext); what reads only the types takes anything with the registry, the map too.
// The move of views kept before the flat lens is planned by the pack and appended here, as it was: its facts and, in
// the same transaction, the event that says what each view lost, which a pack's move (ctx.move) does not carry.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/lenses/kernel/query-saved.ts';

export * from '../packs/lenses/kernel/query-saved.ts';

/** The lenses pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'lenses');

type Rest<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;

export const keptPicture = async (l: Archipelago, ...rest: Rest<typeof moved.keptPicture>) => moved.keptPicture(await ctx(l), ...rest);
export const shownIn = async (l: Archipelago, ...rest: Rest<typeof moved.shownIn>) => moved.shownIn(await ctx(l), ...rest);
export const termQueries = async (l: Archipelago) => moved.termQueries(await ctx(l));

/** The migration, run when a workspace opens: returns what moved and what was lost. */
export async function moveQueries(l: Archipelago): Promise<{ moved: number; retired: string[]; lost: Record<string, string[]> }> {
  const { facts, ...out } = await moved.planQueries(await ctx(l));
  if (!facts.length) return out;
  await l.db.transaction(async (tx) => {
    await l.moved(tx, 'lens.moved', moved.QUERIES_MOVED, facts);
    // What each view said that a flat lens cannot is in no fact: it is kept as something done.
    await l.log(tx, { actor: 'system', action: 'lens.moved', reason: moved.QUERIES_MOVED, detail: { moved: out.moved, retired: out.retired, lost: out.lost } });
  });
  return out;
}
