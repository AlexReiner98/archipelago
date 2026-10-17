// What a pack's handler may read of the map, answered as the actor the call is made for (under row-level security,
// like any of the actor's reads). Every item comes with what it is (is: its type and those it extends), so a
// handler asks what kind of thing it is rather than naming a type alone. A read that asks for some fields is given
// those of each item's props, and no note: a session's story or a long note need not cross the pipe for nothing.

import { livesIn, SCOPE } from './places.ts';
import type { Archipelago, Entity } from './pelago.ts';
import { blockGraph } from './blocking.ts';
import { VIEWS } from './views.ts';

/** The most items one read gives back. */
const READ_LIMIT = 500;
const NAME = /^[a-z][a-z0-9_]*$/;

export type Read = {
  get?: string;
  /** Items of a type (flavours included): with a status or one of several, fields equal to where's, and a field between two values. */
  items?: { type: string; status?: string | string[]; where?: Record<string, unknown>; between?: { field: string; from?: string; to?: string } };
  /** What an item is linked to by a kind of link (flavours included), each with the link's id; only of some types, newest first if asked. */
  related?: string;
  relation?: string;
  direction?: 'out' | 'in';
  types?: string[];
  newest?: 'created' | 'updated';
  /** What an item is part of, outermost first. */
  trail?: string;
  /** Everything that is a place's or an item's: itself, what lives in it, and all part of that or about it; of some types, open or not. */
  scope?: string;
  open?: boolean;
  /** With scope: only what is part of it, not what is about it or lives in it. */
  parts?: boolean;
  /** Which of these items have a picture kept for them. */
  pictures?: string[];
  /** Events of a kind, about one item, since a moment, newest first. */
  events?: { action: string; target?: string; since?: string; limit?: number };
  /** For each item: whether it is blocked, whether it waits on someone's answer, and what has to move first. */
  blocked?: string[];
  view?: string;
  params?: Record<string, unknown>;
  /** Only these of each item's props, and no note. */
  fields?: string[];
};

export async function answerRead(l: Archipelago, q: Read): Promise<unknown> {
  if (q.fields && (!Array.isArray(q.fields) || q.fields.some((f) => !NAME.test(f)))) throw new Error('fields is a list of field names');
  // An item's columns as the asker may read them: anyone with no login reads no note, no owner, no link's id, and of the
  // props only the few public ones, and may not filter by props at all.
  const open = l.props === 'props';
  const cols = (e: string) => `${e}.id, ${e}.type, ${e}.title, ${e}.status, ${open ? `${e}.owner` : 'null as owner'}, ${e}.is_open, ${e}.visibility, ${e}.created_at, ${e}.updated_at, ${e}.archived_at, ${open ? `${e}.props, ${e}.body` : `pelago_public_props(${e}.id) as props`}`;
  const family = (types: string[] | undefined) => (types?.length ? types.flatMap((t) => l.registry.family(t)) : null);
  const typed = <T extends { type: string; props?: Record<string, unknown>; body?: string }>(e: T) => {
    const { body, props, ...rest } = e;
    const kept = q.fields ? { props: Object.fromEntries(q.fields.filter((f) => props?.[f] !== undefined).map((f) => [f, props![f]])) } : { ...(props !== undefined && { props }), ...(body !== undefined && { body }) };
    return { ...rest, ...kept, is: l.registry.type(e.type)?.lineage ?? [e.type] };
  };
  if (q.get !== undefined) {
    const { rows } = await l.db.query<Entity>(`select ${cols('entity')} from entity where id = $1`, [q.get]);
    return rows[0] ? typed(rows[0]) : null;
  }
  if (q.items) {
    const { type, status, where, between } = q.items;
    const field = between?.field;
    if (field !== undefined && !NAME.test(field)) throw new Error('between.field is the name of a field');
    if (!open && (field !== undefined || Object.keys(where ?? {}).length)) throw new Error('Anyone with no login cannot filter by fields.');
    const byProps = open ? `and props @> $3::jsonb and ($4::text is null or $5::text is null or props ->> $4 >= $5) and ($4::text is null or $6::text is null or props ->> $4 <= $6)` : `and $3::jsonb is not null and $4::text is null and $5::text is null and $6::text is null`;
    const { rows } = await l.db.query<Entity>(
      `select ${cols('entity')} from entity where type = any($1::text[]) and archived_at is null and ($2::text[] is null or status = any($2::text[])) ${byProps}
       order by created_at limit ${READ_LIMIT}`,
      [l.registry.family(type), status === undefined ? null : [status].flat(), JSON.stringify(where ?? {}), field ?? null, between?.from ?? null, between?.to ?? null],
    );
    return rows.map(typed);
  }
  if (q.related !== undefined) {
    const [near, far] = q.direction === 'in' ? ['to_id', 'from_id'] : ['from_id', 'to_id'];
    const order = q.newest === 'created' ? 'e.created_at desc' : q.newest === 'updated' ? 'e.updated_at desc' : open ? 'r.id' : 'e.id';
    const { rows } = await l.db.query<Entity & { link: string }>(
      `select ${cols('e')}, ${open ? 'r.id' : 'null'} as link from relation r join entity e on e.id = r.${far}
       where r.${near} = $1 and r.type = any($2::text[]) and r.valid_to is null and e.archived_at is null and ($3::text[] is null or e.type = any($3::text[]))
       order by ${order} limit ${READ_LIMIT}`,
      [q.related, l.registry.relationFamily(q.relation ?? 'relates_to'), family(q.types)],
    );
    return rows.map(typed);
  }
  if (q.trail !== undefined) return (await l.trail(q.trail)).map(({ id, type, title }) => typed({ id, type, title }));
  if (q.scope !== undefined) {
    const under = q.parts ? `with recursive scope(id) as (select $1::text union select r.from_id from relation r join scope s on r.to_id = s.id where r.type = 'part_of' and r.valid_to is null and $2::text[] is not null)` : SCOPE;
    const { rows } = await l.db.query<Entity>(
      `${under} select ${cols('e')} from entity e join scope s on s.id = e.id
       where e.archived_at is null and ($3::text[] is null or e.type = any($3::text[])) and ($4::boolean is null or e.is_open = $4)
       order by e.updated_at desc`,
      [q.scope, livesIn(l), family(q.types), q.open ?? null],
    );
    return rows.map(typed);
  }
  if (q.events) {
    const { action, target, since, limit } = q.events;
    const { rows } = await l.db.query(
      `select seq, ts, actor, action, target_id, reason, detail from event where action = $1 and ($2::text is null or target_id = $2) and ($3::timestamptz is null or ts > $3::timestamptz) order by seq desc limit $4`,
      [action, target ?? null, since ?? null, Math.min(limit ?? 50, READ_LIMIT)],
    );
    return rows;
  }
  if (q.pictures) {
    const { rows } = await l.db.query<{ entity_id: string }>(`select entity_id from picture where entity_id = any($1::text[])`, [q.pictures]);
    return rows.map((r) => r.entity_id);
  }
  if (q.blocked) {
    const graph = await blockGraph(l);
    const roots = [...new Set(q.blocked.flatMap((id) => graph.roots(id)))];
    const { rows } = roots.length ? await l.db.query<{ id: string; title: string }>(`select id, title from entity where id = any($1::text[])`, [roots]) : { rows: [] };
    const titles = new Map(rows.map((r) => [r.id, r.title]));
    return Object.fromEntries(q.blocked.map((id) => [id, { blocked: graph.isBlocked(id), waits_on_someone: graph.waitsOnSomeone(id), roots: graph.roots(id).map((r) => ({ id: r, title: titles.get(r) })) }]));
  }
  if (q.view !== undefined) {
    const view = VIEWS[q.view];
    if (!view) throw new Error(`No view "${q.view}"`);
    return view.run(l, q.params ?? {});
  }
  throw new Error('A read is one of: get, items, related, trail, scope, events, pictures, blocked, view.');
}
