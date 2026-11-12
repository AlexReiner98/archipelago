// The styles pack's filling of the loader's slot loader.moves (packs/loader/kernel/typetable.ts): the migrations of the
// styles a map keeps, each run once as a workspace opens, when the map has the types it moves.

import type { KernelContext } from '#pelago/kernel';
import { moveLayouts } from './layout-move.ts';
import { moveStyles } from './style-move.ts';

/** The moves this pack makes: each by the name the type table keeps it done under, the types it needs, and how it runs. */
export const moves = (ctx: KernelContext) => [
  { name: 'styles', types: ['style', 'lens'], run: () => moveStyles(ctx) }, // styles made for one view, moved into it
  { name: 'layouts', types: ['style', 'layout'], run: () => moveLayouts(ctx) }, // styles with code, layouts now
];
