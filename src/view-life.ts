// Views and layouts have a life (task e_gkv58kqb): working (an agent's, about its task), kept (only on the owner's
// word) and retired. Before it, both were current or retired. A migration, run when a workspace opens, after the
// layouts have moved (src/layout-move.ts), sorts each one still current once, as the owner agreed (7 Nov 2026): a
// pinned view is kept, one about an item already closed is retired, any other view is working; a layout is kept,
// since its code ran only once the owner let it. One change set the system appends, so the log keeps what each was.

import type { Fact } from './log.ts';
import type { Archipelago } from './pelago.ts';

/** The status a view or layout had before its life. */
const BEFORE = 'current';

export interface Before {
  id: string;
  /** A view (true) or a layout. */
  view: boolean;
  pinned: boolean;
  /** Whether what it is about is all closed: true only when it is about something, and none of that is open. */
  ended: boolean;
}

/** The status each takes: pure. */
export const lifeOf = (b: Before): 'working' | 'kept' | 'retired' => (!b.view || b.pinned ? 'kept' : b.ended ? 'retired' : 'working');

/** The facts that sort them: pure. */
export const livesMoved = (rows: Before[]): Fact[] => rows.map((r): Fact => ['+', r.id, 'status', lifeOf(r)]);

/** The migration: returns how many took each status. */
export async function moveLives(l: Archipelago): Promise<Record<string, number>> {
  if (!l.registry.types.has('lens') || !l.registry.types.has('layout')) return {};
  const views = l.registry.family('lens');
  const { rows } = await l.db.query<{ id: string; type: string; pinned: boolean }>(
    `select id, type, coalesce((props ->> 'pinned')::boolean, false) as pinned from entity where type = any($1::text[]) and status = $2 order by id -- index entity_type`,
    [[...views, ...l.registry.family('layout')], BEFORE],
  );
  if (!rows.length) return {};
  const { rows: about } = await l.db.query<{ from_id: string; open: boolean }>(
    `select r.from_id, e.is_open and e.archived_at is null as open from relation r join entity e on e.id = r.to_id where r.type = 'about' and r.valid_to is null and r.from_id = any($1::text[])`,
    [rows.map((r) => r.id)],
  );
  const before = rows.map((r): Before => {
    const of = about.filter((a) => a.from_id === r.id);
    return { id: r.id, view: views.includes(r.type), pinned: r.pinned, ended: of.length > 0 && of.every((a) => !a.open) };
  });
  const facts = livesMoved(before);
  await l.db.transaction((tx) => l.moved(tx, 'lens.lived', 'Views and layouts have a life: each current one sorted once, as the owner agreed (pinned or a layout kept, about a closed item retired, the rest working)', facts));
  const counts: Record<string, number> = {};
  for (const b of before) counts[lifeOf(b)] = (counts[lifeOf(b)] ?? 0) + 1;
  return counts;
}
