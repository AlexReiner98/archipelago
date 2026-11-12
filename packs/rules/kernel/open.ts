// What the rules root fills of a workspace's open (packs/identity/kernel/lifecycle.ts): in the begin phase, what a new workspace begins
// with, one entry on its settings stream: which of core's rules apply, and what is shared by default.

import type { Q } from '../../database/kernel/db.ts';
import type { RootOpen } from '../../identity/kernel/lifecycle.ts';
import { beginApplying } from './rules.ts';

/**
 * A new workspace makes things shared unless they say otherwise (the owner, 9 Nov 2026): with one person in it that
 * hides nothing from anyone, a team sees one map, and a link shows what it is made for. The owner changes it in
 * Settings; a workspace made before keeps what it has, private when it never chose.
 */
async function beginShared(q: Q): Promise<['+', string, string, unknown][]> {
  const { rows } = await q.query(`insert into setting (key, value) values ('default_visibility', '"shared"'::jsonb) on conflict (key) do nothing returning key`);
  return rows.length ? [['+', 'setting', 'default_visibility', 'shared']] : [];
}

export const OPEN: RootOpen = {
  begin: [async (o) => { if (o.begins) await o.pelago!.record('settings', 'system', [...(await beginApplying(o.db)), ...(await beginShared(o.db))]); }],
};
