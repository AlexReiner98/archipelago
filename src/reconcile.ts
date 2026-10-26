// What a session has left unsaid when it ends (report, action session_end): the open work it has to change, vouch
// for, or say it cannot tell about. Kept beside what asks it (src/sessions.ts).

import { blockGraph } from './blocking.ts';
import type { Archipelago, Entity, Op } from './pelago.ts';
import { livesIn, scopeOf } from './places.ts';
import { touchedBy } from './touched.ts';

export type Item = { id: string; type: string; title: string; status: string; touched?: true };

/**
 * What a session has left unsaid: the open work of the repository it ran in,
 * and what it touched itself (src/touched.ts) wherever that is, that nobody
 * has changed since it began. A session that settled something says so by
 * changing it; what it leaves as it found it, it has to vouch for, or say it
 * could not tell. What it touched comes first, marked touched: it looked at
 * those. What waits on a person's answer is not asked about: no work in the
 * repository settles it. Nor is what has a change waiting for the human: what
 * was found has been said, and is theirs to confirm.
 */
export async function unreconciled(l: Archipelago, run: Entity): Promise<Item[]> {
  const [{ rows: repos }, mine] = await Promise.all([l.db.query<{ to_id: string }>(`select to_id from relation where type = any($2::text[]) and from_id = $1 and valid_to is null`, [run.id, livesIn(l)]), touchedBy(l, run.id)]);
  if (!repos.length && !mine.length) return [];
  const scope = [...(repos.length ? await scopeOf(l, repos[0].to_id, true) : []), ...mine];
  const { rows: work } = await l.db.query<Item>(`select id, type, title, status from entity where id = any($1::text[]) and is_open and archived_at is null and type = any($2::text[]) order by props->>'due' nulls last, updated_at desc`, [scope, [...l.registry.types.values()].filter((t) => t.fields.tokens_estimated || t.capabilities.settles).map((t) => t.id)]);
  const graph = await blockGraph(l, work.map((i) => i.id));
  const { rows: held } = await l.db.query<{ ops: Op[] }>(`select ops from proposal where status = 'pending' -- index proposal_status`);
  const proposed = new Set(held.flatMap((p) => p.ops.flatMap((o) => ('id' in o && o.id ? [o.id] : []))));
  const open = work.filter((i) => !graph.waitsOnSomeone(i.id) && !proposed.has(i.id));
  const { rows: untouched } = await l.db.query<{ id: string }>(`select id from entity where id = any($1::text[]) and updated_at <= $2`, [open.map((i) => i.id), run.created_at]);
  const left = open.filter((i) => untouched.some((u) => u.id === i.id)).map(({ id, type, title, status }): Item => ({ id, type, title, status, ...(mine.includes(id) && { touched: true as const }) }));
  return [...left.filter((i) => i.touched), ...left.filter((i) => !i.touched)];
}
