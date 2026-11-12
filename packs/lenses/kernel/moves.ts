// The lenses pack's filling of the loader's slot loader.moves (packs/loader/kernel/typetable.ts): the migrations of the
// views a map keeps, each run once as a workspace opens, when the map has the types it moves. Each is named as the
// type table keeps it done, and run in the order the table says.

import type { KernelContext } from '#pelago/kernel';
import { planQueries, QUERIES_MOVED, termQueries } from './query-saved.ts';
import { moveLives, movePins } from './view-life.ts';

/** The views kept before the flat lens, made flat lenses: what each said that a flat lens cannot is kept as something done. */
async function moveQueries(ctx: KernelContext) {
  const { facts, ...out } = await planQueries(ctx);
  if (facts.length) await ctx.move('lens.moved', QUERIES_MOVED, facts, { moved: out.moved, retired: out.retired, lost: out.lost });
  return out;
}

/** The moves this pack makes: each by the name the type table keeps it done under, the types it needs, and how it runs. */
export const moves = (ctx: KernelContext) => [
  { name: 'terms', types: ['lens'], run: () => termQueries(ctx) }, // views kept in the filter's old words, said in its terms
  { name: 'queries', types: ['lens'], run: () => moveQueries(ctx) }, // views kept before the flat lens, translated into flat lenses
  { name: 'lives', types: ['lens', 'layout'], run: () => moveLives(ctx) }, // views and layouts sorted into working, kept and retired
  { name: 'pins', types: ['lens'], run: () => movePins(ctx) }, // the ids a view held by hand, id terms of its filter
];
