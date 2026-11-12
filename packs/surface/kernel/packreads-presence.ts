// What the presence pack reads (packs/presence): the session a step names, what it works on and everything that holds
// that, all the way up, so the owner's page can tell a session working inside a plan it watches. Bounded by the one
// run it names, through the part_of closure; answered as the asker.

import type { Archipelago } from '../../write/kernel/pelago.ts';

export type PresenceRead = {
  /** What a session works on now and what holds each of those, at any depth, by the closure: ids only. */
  run_within?: string;
};

export async function presenceRead(l: Archipelago, q: PresenceRead): Promise<string[] | undefined> {
  if (q.run_within === undefined) return undefined;
  if (typeof q.run_within !== 'string') throw new Error('run_within is the id of a session');
  const { rows } = await l.db.query<{ id: string }>(
    `with task as (select to_id as id from relation where from_id = $1 and type = 'works_on' and valid_to is null)
     select id from task union select c.ancestor from part_closure c join task on c.descendant = task.id`,
    [q.run_within],
  );
  return rows.map((r) => r.id);
}
