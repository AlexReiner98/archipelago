// What the write path called inline, as fillings of its hook points (src/write-hooks.ts): the code is left where it
// is, and each filling is named for the pack it moves to in the next wave (docs/kernel-packs.md, "The order of the
// wave"), which then takes it with its filling and never opens the write path again.
//
// Unwait and sources stay inline for now: both act at the level of facts inside the apply loop, and as a
// write.follow their ops would be judged by the rules, which is the owner's to see first (task e_mhqvdzj6).

import { typesApplied } from './type-items.ts'; import { supersede } from './proposals.ts';
import type { AfterEntry, BuiltIn, Point, WriteEnv } from './write-hooks.ts';

export const BUILT_IN: { [P in Point]?: BuiltIn[] } = {
  'write.after': [
    { pack: 'types', run: (env: WriteEnv, entry: AfterEntry) => typesApplied(env.map, entry.ops, env.reg) },
    { pack: 'proposals', run: (env: WriteEnv, entry: AfterEntry) => supersede(env.map, entry.changeset) },
  ],
};
