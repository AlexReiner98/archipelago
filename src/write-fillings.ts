// What the write path called inline, as fillings of its hook points (src/write-hooks.ts): the code is left where it
// is, and each filling is named for the pack it moves to in the next wave (docs/kernel-packs.md, "The order of the
// wave"), which then takes it with its filling and never opens the write path again.
//
// Unwait and sources stay inline for now: both act at the level of facts inside the apply loop, and as a
// write.follow their ops would be judged by the rules, which is the owner's to see first (task e_mhqvdzj6).

import { placeOnIslands } from './island-place.ts'; import { placeWithSubject } from './subject.ts';
import { checkUpdated, checkWritten } from './automation-rules.ts'; import { islandRegistry } from './island-pin.ts';
import { typesApplied } from './type-items.ts'; import { supersede } from './proposals.ts';
import type { Op } from './pelago-types.ts';
import type { AfterEntry, BuiltIn, Checked, Point, WriteEnv } from './write-hooks.ts';

/** A placement that moves ops in the list it is given, as a rewrite: a list in, the list it left out. */
const placing = (place: (env: WriteEnv, ops: Op[]) => Promise<void>) => async (env: WriteEnv, ops: Op[]) => {
  const out = ops.slice();
  await place(env, out);
  return out;
};

/** An automation's trigger and conditions, checked as written (src/automation-rules.ts), by the version its island runs. */
async function automations(env: WriteEnv, ops: Op[]): Promise<Checked> {
  const refusals: string[] = [];
  for (const [i, op] of ops.entries()) {
    const where = `op ${i + 1} (${op.op})`;
    if (op.op === 'create') {
      const here = await islandRegistry(env.map, op.props?.island, env.reg);
      if (here.type(op.type)) refusals.push(...checkWritten(here, op.type, op.props ?? {}).map((p) => `${where}: ${p}`));
    } else if (op.op === 'update' && op.props?.on !== undefined && op.props.on !== null) {
      const target = await env.map.entity(op.id);
      if (!target) continue;
      const here = await islandRegistry(env.map, op.props.island ?? target.props.island, env.reg);
      refusals.push(...checkUpdated(here, target.type, op.props).map((p) => `${where}: ${p}`));
    }
  }
  return { refusals };
}

export const BUILT_IN: { [P in Point]?: BuiltIn[] } = {
  'write.rewrite': [
    { pack: 'placement', fills: ['island'], run: placing((env, ops) => placeWithSubject(env.map, env.reg, ops)) },
    { pack: 'placement', fills: ['island'], run: placing((env, ops) => placeOnIslands(env.map, env.reg, ops, env.island)) },
  ],
  'write.validate': [
    { pack: 'automations', run: automations },
  ],
  'write.after': [
    { pack: 'types', run: (env: WriteEnv, entry: AfterEntry) => typesApplied(env.map, entry.ops, env.reg) },
    { pack: 'proposals', run: (env: WriteEnv, entry: AfterEntry) => supersede(env.map, entry.changeset) },
  ],
};
