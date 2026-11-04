// A session's parent: the run of the session that started it, as a started_from link, so sessions form a tree
// (docs/sessions.md). Said as a session starts, or later by one that learns it then; a run has one parent.

import type { Archipelago, Entity, Op } from './pelago.ts';
import { resolveRun } from './chat-run.ts';

/** How far up a tree is walked to refuse a loop: deeper than any session tree a person runs. */
const DEPTH = 32;

/** The run a parent names (a run id or a session id), refused clearly when there is none. */
export async function parentRun(l: Archipelago, parent: string): Promise<Entity> {
  const run = await resolveRun(l, parent);
  if (!run) throw new Error(`No session "${parent}" to have been started from: give its run id or its session id`);
  return run;
}

/** The link to its parent a run has now, if any. */
async function parentLink(l: Archipelago, run: string): Promise<{ id: string; to_id: string } | undefined> {
  const { rows } = await l.db.query<{ id: string; to_id: string }>(
    `select id, to_id from relation where from_id = $1 and type = any($2::text[]) and valid_to is null limit 1`,
    [run, l.registry.relationFamily('started_from')],
  );
  return rows[0];
}

/** The ops that make parent the parent of run (a ref for a run in the same change), or none when it already is. */
export async function parentOps(l: Archipelago, run: string, parent: Entity, made = false): Promise<Op[]> {
  if (made) return [{ op: 'link', type: 'started_from', from: run, to: parent.id }];
  if (parent.id === run) throw new Error('A session cannot have been started from itself');
  // Its parent must not descend from it: a tree has no loops.
  for (let at: string | undefined = parent.id, i = 0; at && i < DEPTH; i++) {
    at = (await parentLink(l, at))?.to_id;
    if (at === run) throw new Error(`Session "${parent.title}" was itself started from this one`);
  }
  const now = await parentLink(l, run);
  if (now?.to_id === parent.id) return [];
  return [...(now ? [{ op: 'unlink' as const, relation: now.id }] : []), { op: 'link', type: 'started_from', from: run, to: parent.id }];
}
