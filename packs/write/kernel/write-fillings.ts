// What the write path called inline, as fillings of its hook points (src/write-hooks.ts): the code is left where it
// is, and each filling is named for the pack it moves to in the next wave (docs/kernel-packs.md, "The order of the
// wave"), which then takes it with its filling and never opens the write path again.
//
// Unwait and sources left the apply loop for their packs (waits, placement) as fillings of write.follow.rides: what
// they add rides the change's verdict, judged by no rule on its own (the owner, 12 Nov 2026, e_umv4gdqr).

import { typesApplied } from '../../loader/kernel/type-items.ts'; import { supersede } from './proposals.ts';
import type { AfterEntry, BuiltIn, Point, WriteEnv } from './write-hooks.ts';

export const BUILT_IN: { [P in Point]?: BuiltIn[] } = {
  'write.after': [
    { pack: 'types', run: (env: WriteEnv, entry: AfterEntry) => typesApplied(env.map, entry.ops, env.reg) },
    { pack: 'proposals', run: (env: WriteEnv, entry: AfterEntry) => supersede(env.map, entry.changeset) },
  ],
};
