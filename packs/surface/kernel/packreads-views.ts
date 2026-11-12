// The reads the lenses and views packs need of the reads API (wave 6): the activity log's events, what keeps a view's
// life, the project an item sits in, what names some items, and the items of some types carrying some fields (what a
// view's migration moves). Each is bounded by the ids it is given, a limit, or an index it names, and answered as the
// asker under row-level security, as every read of packreads.ts is. The SQL is the modules' own, moved as it was.

import type { Archipelago } from '../../write/kernel/pelago.ts';
import { readEvents } from '../../log/kernel/eventlog.ts';
import { READ_LIMIT } from './packreads-rows.ts';

export type ViewsRead = {
  /** Events of a kind, about one item, since a moment, newest first. */
  events?: { action: string; target?: string; since?: string; limit?: number };
  /** For each of some views: its status, the first line of its note, and whether nobody has changed it for so many days. */
  view_lives?: { ids: string[]; days: number };
  /** For each of some items, every item of these types it is or is part of, with how much that one is part of. */
  in_projects?: { ids: string[]; types: string[] };
  /** What names some items (the mentions), of these types and not archived: by id, or newest first, at most so many. */
  mentioned?: { to: string[]; types: string[]; order?: 'id' | 'newest'; limit?: number };
  /** The items of these exact types carrying any of these fields (or any), of one status, archived ones too if asked: by the index on type. */
  marked?: { types: string[]; keys?: string[]; status?: string; archived?: boolean };
};

const loggedIn = (l: Archipelago, what: string) => {
  if (l.props !== 'props') throw new Error(`Anyone with no login reads no ${what}.`);
};
const list = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.some((id) => typeof id !== 'string')) throw new Error(`${what} is a list of names`);
  return v as string[];
};

/** The answer to one of these reads, or undefined when the read is none of them. */
export async function viewsRead(l: Archipelago, q: ViewsRead): Promise<unknown> {
  if (q.events) {
    const { action, target, since, limit } = q.events;
    const rows = await readEvents(l.db, { action, target, since, limit: Math.min(limit ?? 50, READ_LIMIT) });
    return rows.filter((r) => !since || new Date(r.ts) > new Date(since)).map(({ seq, ts, actor, action, target_id, reason, detail }) => ({ seq, ts, actor, action, target_id, reason, detail }));
  }
  if (q.view_lives !== undefined) {
    loggedIn(l, 'view lives');
    const ids = list(q.view_lives.ids, 'view_lives.ids');
    if (!ids.length) return [];
    const { rows } = await l.db.query<{ id: string; status: string; note: string | null; stale: boolean }>(
      `select id, status, updated_at < now() - make_interval(days => $2::int) as stale, left(split_part(btrim(body), E'\n', 1), 200) as note from entity where id = any($1::text[])`,
      [ids, Math.floor(Number(q.view_lives.days)) || 0],
    );
    return rows;
  }
  if (q.in_projects !== undefined) {
    const ids = list(q.in_projects.ids, 'in_projects.ids');
    if (!ids.length) return [];
    const { rows } = await l.db.query<{ id: string; project: string; title: string; above: number }>(
      `select s.id, e.id as project, e.title, (select count(*)::int from part_closure up where up.descendant = e.id) as above
       from unnest($1::text[]) s(id) join entity e on (e.id = s.id or e.id in (select ancestor from part_closure c where c.descendant = s.id))
       where e.type = any($2::text[]) and e.archived_at is null`,
      [ids, list(q.in_projects.types, 'in_projects.types')],
    );
    return rows;
  }
  if (q.mentioned !== undefined) {
    const to = list(q.mentioned.to, 'mentioned.to');
    if (!to.length) return [];
    const order = q.mentioned.order === 'newest' ? 'e.updated_at desc' : 'e.id';
    const most = q.mentioned.limit === undefined ? '' : ` limit ${Math.max(1, Math.min(READ_LIMIT, Math.floor(Number(q.mentioned.limit)) || 1))}`;
    const { rows } = await l.db.query<{ to: string; id: string; type: string; title: string; status: string }>(
      `select m.to_id as "to", e.id, e.type, e.title, e.status from mention m join entity e on e.id = m.from_id
       where m.to_id = any($1::text[]) and e.type = any($2::text[]) and e.archived_at is null order by ${order}${most}`,
      [to, list(q.mentioned.types, 'mentioned.types')],
    );
    return rows;
  }
  if (q.marked !== undefined) {
    loggedIn(l, 'fields across a type');
    const { types, keys, status, archived } = q.marked;
    const { rows } = await l.db.query<{ id: string; type: string; title: string; status: string; props: Record<string, unknown> }>(
      `select id, type, title, status, props from entity where type = any($1::text[]) and ($2::text[] is null or props ?| $2::text[]) and ($3::text is null or status = $3) and ($4::boolean or archived_at is null)
       order by id -- index entity_type`,
      [list(types, 'marked.types'), keys === undefined ? null : list(keys, 'marked.keys'), status ?? null, archived === true],
    );
    return rows;
  }
  return undefined;
}
