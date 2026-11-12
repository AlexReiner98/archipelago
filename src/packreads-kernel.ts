// The reads the kernel's views need from src/packreads.ts once they are service packs (task e_8f8m2xtf,
// docs/kernel-packs.md): items by id, the open links touching some items, the log's history of some items, what each
// item sits in at the top, a place's scope, the block graph and who holds what, the region a lens reads, and the
// workspace's owner. Each is bounded by the ids it is given, a limit, or an index it names, and answered as the asker
// under row-level security, as every read of packreads.ts is. What reads the whole map is not here.

import { ACTIVE_HOLDS, type Archipelago } from './pelago.ts';
import { blockGraph, heldResources } from './blocking.ts';
import { openSaid } from './seal.ts';
import { scopeOf } from './places.ts';
import { scanAround, scanKinds, type Around } from './region.ts';
import { instructionsFor } from './instructions.ts';
import { shapes } from './packreads-rows.ts';
import { notKernel } from './head.ts';

export type KernelRead = {
  /** Items by id, every column the asker may read and their confidence (archived ones too), in the order the database gives them. */
  ids?: string[];
  /** The open links from, to or among some items (or of some kinds, by the index on open links of a kind), exact kinds;
   *  order: kept (as the map keeps them), id, or newest (the newest made first; with limit, at most that many). */
  links?: { from?: string[]; to?: string[]; among?: string[]; types?: string[]; order?: 'kept' | 'id' | 'newest'; limit?: number };
  /** The log's facts of some items, opened, in the log's order (position, then place in the entry); of some fields only;
   *  last: only the position of each item's last fact. */
  history?: { ids: string[]; fields?: string[]; last?: boolean };
  /** For each item, the outermost thing it is part of: the ancestor in the part_of closure that is part of nothing. */
  tops?: string[];
  /** The ids of what is a place's or an item's (src/places.ts, scopeOf): open, only what is open and not the system's. */
  within?: { id: string; open?: boolean; among?: string[] };
  /** What blocks what, for some items: each edge (x waits on y, and why), read as far as what they wait on reaches. */
  blocks?: string[];
  /** Who holds each resource now (of some, when they are named). */
  holds?: true | string[];
  /** The region a lens reads around some items (src/region.ts), its rows as the lens reads them. */
  region?: Around;
  /** The items of some kinds across the map a lens of the whole map reads (src/region.ts, scanKinds). */
  kinds?: { types: string[]; fold: string[]; by: string; over: string[] | null };
  /** What agents are told where (`file:`...), to a session about an item (src/instructions.ts). */
  instructions?: { where: string; about?: string };
  /** The workspace's owner, as its setting names them. */
  owner?: boolean;
  /** The open items a person owns, not archived; also: the open items of these types that nobody owns. */
  owned?: { by: string; also?: string[] };
  /** Of some open items, those whose bound (the bound capability of their type) is crossed: a date due within days, or a quantity under its limit. */
  bounds?: { ids: string[]; days: number };
  /** For each of some items, what it is part of at any depth that is kept (not archived, not the system's), each with
   *  how many kept things it is part of itself (depth: none is outermost), by the ancestor's title. */
  ancestors?: string[];
  /** Which of some items hold something kept (not archived, not the system's) at any depth. */
  holding?: string[];
};

const list = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.some((id) => typeof id !== 'string')) throw new Error(`${what} is a list of ids`);
  return v as string[];
};
/** What a lens keeps of the closure: not archived, not the system's. */
const kept = (l: Archipelago, e: string) => `${e}.archived_at is null and ${notKernel(l.registry, `${e}.type`)}`;
const loggedIn = (l: Archipelago, what: string) => {
  if (l.props !== 'props') throw new Error(`Anyone with no login reads no ${what}.`);
};

/** The answer to one of these reads, or undefined when the read is none of them. */
export async function kernelRead(l: Archipelago, q: KernelRead): Promise<unknown> {
  if (q.ids !== undefined) {
    const { cols, typed } = shapes(l);
    const { rows } = await l.db.query<{ type: string }>(`select ${cols('entity')}, entity.confidence from entity where id = any($1::text[])`, [list(q.ids, 'ids')]);
    return rows.map(typed);
  }
  if (q.links !== undefined) {
    const { from, to, among, types, order, limit } = q.links;
    const ends = [from, to, among].filter((x) => x !== undefined);
    if (!ends.length && !types?.length) throw new Error('links reads from, to or among some items, or of some kinds');
    const params: unknown[] = [];
    const arg = (v: unknown) => (params.push(v), `$${params.length}`);
    const where = ['r.valid_to is null'];
    if (from) where.push(`r.from_id = any(${arg(list(from, 'links.from'))}::text[])`);
    if (to) where.push(`r.to_id = any(${arg(list(to, 'links.to'))}::text[])`);
    if (among) { const a = arg(list(among, 'links.among')); where.push(`r.from_id = any(${a}::text[]) and r.to_id = any(${a}::text[])`); }
    if (types) where.push(`r.type = any(${arg(list(types, 'links.types'))}::text[])`);
    const by = order === 'kept' ? ' order by r.ctid' : order === 'id' ? ' order by r.id' : order === 'newest' ? ' order by r.valid_from desc, r.id' : '';
    const most = limit === undefined ? '' : ` limit ${Math.max(1, Math.floor(Number(limit)) || 1)}`;
    const open = l.props === 'props';
    const { rows } = await l.db.query(`select ${open ? 'r.id' : 'null as id'}, r.type, r.from_id, r.to_id, ${open ? 'r.props' : `'{}'::jsonb as props`}, r.valid_from from relation r where ${where.join(' and ')}${by}${most} -- index relation_open_type`, params);
    return rows;
  }
  if (q.history !== undefined) {
    loggedIn(l, 'log');
    const ids = list(q.history.ids, 'history.ids');
    if (q.history.last) {
      const { rows } = await l.db.query<{ id: string; pos: number }>(`select id, max(pos)::int as pos from log_fact where stream = 'facts' and id = any($1::text[]) group by id -- index log_fact_history`, [ids]);
      return rows;
    }
    const fields = q.history.fields === undefined ? null : list(q.history.fields, 'history.fields');
    const { rows } = await l.db.query<{ id: string; field: string; value: unknown; op: string; pos: number; at: Date }>(
      `select id, field, value, op, pos::int as pos, at from log_fact where stream = 'facts' and id = any($1::text[]) and ($2::text[] is null or field = any($2::text[])) order by pos, n -- index log_fact_history`,
      [ids, fields],
    );
    return openSaid(l.db, rows);
  }
  if (q.tops !== undefined) {
    const { rows } = await l.db.query<{ id: string; top: string; title: string }>(
      `select distinct on (c.descendant) c.descendant as id, c.ancestor as top, e.title from part_closure c join entity e on e.id = c.ancestor
       where c.descendant = any($1::text[]) and not exists (select 1 from part_closure up where up.descendant = c.ancestor)
       order by c.descendant, c.ancestor`,
      [list(q.tops, 'tops')],
    );
    return rows;
  }
  if (q.within !== undefined) return [...(await scopeOf(l, String(q.within.id), Boolean(q.within.open), q.within.among && list(q.within.among, 'within.among')))];
  if (q.blocks !== undefined) return [...(await blockGraph(l, list(q.blocks, 'blocks'))).direct.values()].flat();
  if (q.holds !== undefined) {
    if (q.holds === true) return heldResources(l);
    const { rows } = await l.db.query(`select h.to_id as resource, h.holder_title as held_by_title from ${ACTIVE_HOLDS} h where h.to_id = any($1::text[])`, [list(q.holds, 'holds')]);
    return rows;
  }
  if (q.region !== undefined) {
    loggedIn(l, 'region');
    return scanAround(l, q.region);
  }
  if (q.kinds !== undefined) {
    loggedIn(l, 'region');
    return scanKinds(l, q.kinds);
  }
  if (q.instructions !== undefined) return instructionsFor(l, String(q.instructions.where), q.instructions.about === undefined ? {} : { about: String(q.instructions.about) });
  if (q.owner) return (await l.setting<string>('me')) || null;
  if (q.owned !== undefined) {
    const { cols, typed } = shapes(l);
    const { rows } = await l.db.query<{ type: string }>(
      `select ${cols('entity')} from entity where is_open and archived_at is null and (owner = $1 or ($2::text[] is not null and owner is null and type = any($2::text[])))`,
      [String(q.owned.by), q.owned.also === undefined ? null : list(q.owned.also, 'owned.also')],
    );
    return rows.map(typed);
  }
  if (q.bounds !== undefined) return crossed(l, Number(q.bounds.days), list(q.bounds.ids, 'bounds.ids'));
  if (q.ancestors !== undefined) {
    const { rows } = await l.db.query<{ id: string; at: string; depth: number }>(
      `select c.descendant as id, c.ancestor as at,
         (select count(*) from part_closure p join entity a on a.id = p.ancestor where p.descendant = c.ancestor and ${kept(l, 'a')})::int as depth
       from part_closure c join entity e on e.id = c.ancestor
       where c.descendant = any($1::text[]) and ${kept(l, 'e')}
       order by e.title, c.ancestor`,
      [list(q.ancestors, 'ancestors')],
    );
    return rows;
  }
  if (q.holding !== undefined) {
    const { rows } = await l.db.query<{ id: string }>(`select distinct c.ancestor as id from part_closure c join entity e on e.id = c.descendant where c.ancestor = any($1::text[]) and ${kept(l, 'e')}`, [list(q.holding, 'holding')]);
    return rows.map((r) => r.id);
  }
  return undefined;
}

/** Open items among some whose bound is crossed or near: a date due within some days, or a quantity under its limit. */
async function crossed(l: Archipelago, days: number, among: string[]) {
  type Crossed = { id: string; type: string; title: string; status: string; owner: string | null };
  const bounds = l.registry.having('bound').map((type) => ({ type, ...l.registry.type(type)!.capabilities.bound! }));
  const { rows: due } = await l.db.query<Crossed & { due: string; overdue: boolean }>(
    `select e.id, e.type, e.title, e.status, e.owner, e.props->>b.field as due, (e.props->>b.field)::date < current_date as overdue
     from entity e join jsonb_to_recordset($2::jsonb) as b(type text, field text) on b.type = e.type
     where e.id = any($3::text[]) and e.is_open and e.archived_at is null and e.props ? b.field and (e.props->>b.field)::date <= current_date + $1::int
     order by due`,
    [days, JSON.stringify(bounds.filter((b) => b.limit)), among],
  );
  const { rows: under } = await l.db.query<Crossed & { value: number; limit: number }>(
    `select e.id, e.type, e.title, e.status, e.owner, (e.props->>b.field)::numeric as value, (e.props->>b.below)::numeric as limit
     from entity e join jsonb_to_recordset($1::jsonb) as b(type text, field text, below text) on b.type = e.type
     where e.id = any($2::text[]) and e.is_open and e.archived_at is null and (e.props->>b.field)::numeric < (e.props->>b.below)::numeric`,
    [JSON.stringify(bounds.filter((b) => b.below)), among],
  );
  return { due, under };
}
