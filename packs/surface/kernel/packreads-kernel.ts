// The reads the kernel's views need from src/packreads.ts once they are service packs (task e_8f8m2xtf,
// docs/kernel-packs.md): items by id, the open links touching some items, the log's history of some items, what each
// item sits in at the top, a place's scope, the block graph and who holds what, the region a lens reads, and the
// workspace's owner. Each is bounded by the ids it is given, a limit, or an index it names, and answered as the asker
// under row-level security, as every read of packreads.ts is. What reads the whole map is not here.

import { ACTIVE_HOLDS, type Archipelago } from '../../../src/pelago.ts';
import { blockGraph, heldResources } from './blocking.ts';
import { openSaid } from '../../../src/seal.ts';
import { scopeOf } from '../../../src/places.ts';
import { scanAround, scanKinds, type Around } from './region.ts';
import { instructionsFor } from '../../../src/instructions.ts';
import { shapes } from './packreads-rows.ts';
import { notKernel } from '../../../src/head.ts';
import { islandRegistry } from '../../loader/kernel/island-pin.ts';
import { presetsOf } from '../../loader/kernel/declared.ts';
import { asOf } from '../../../src/rebuild.ts';
import { layoutFor } from '../../loader/kernel/layouts.ts';
import { used } from '../../../src/uses.ts';

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
  // What the styles and agents packs read (packs/styles, packs/agents): the looks and the words the map keeps.
  /** The instruction presets the packs ship (of the island's version of each, on an island), and every instruction kept, open or retired, with what each is about. */
  told_from?: { island?: string };
  /** Count each of these instructions (a preset's id, or a kept one's) as said once (src/uses.ts): answered true. */
  told?: string[];
  /** The owner's versions of presets, open or retired: of the packs' style presets, or of their drawings (layout). */
  versions?: 'style' | 'layout';
  /** Every style or layout (of these types) kept on the map, with what each is about; and one named outright, retired or not. */
  looks?: { types: ('style' | 'layout')[]; named?: string };
  /** The styles kept, and the owner's versions of presets, as the map stood at a fact position (src/rebuild.ts, asOf). */
  styles_at?: number;
  /** The drawing a style is drawn by, if a pack draws its shape, its modules left out when the page has them (src/layouts.ts). */
  drawing?: { style: Record<string, unknown>; have?: string[] };
  /** The person a page is drawn for: the one signed in, or on a map nobody signs in to, its owner; none for anyone. */
  drawn_for?: true;
  /** The screens kept on the map, open or retired, in the order made. */
  screens?: true;
  /** Which of these types hold anything not archived: one look each, by the index on type. */
  held_types?: string[];
  /** What the move of styles made for one view reads (src/style-move.ts): none when nothing is to move. */
  style_moves?: true;
  /** The styles that are layouts by their fields: code, modules, or a version of one of these drawings (src/layout-move.ts). */
  layout_moves?: string[];
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
  const looks = await lookRead(l, q);
  if (looks !== undefined) return looks;
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

/** Open style, layout or screen items with what each is about. */
const aboutOf = async (l: Archipelago, ids: string[]) =>
  (await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'about' and valid_to is null and from_id = any($1::text[])`, [ids])).rows;

/** The reads of the looks and words the map keeps (the styles and agents packs), or undefined when the read is none of them. */
async function lookRead(l: Archipelago, q: KernelRead): Promise<unknown> {
  if (q.told_from !== undefined) {
    const island = q.told_from.island;
    const presets = presetsOf((await islandRegistry(l, island)).packs, 'instruction');
    const { rows } = await l.db.query<{ id: string }>(
      `select id, title, body, is_open, ${l.props} from entity where type = any($1::text[]) and archived_at is null order by updated_at, id -- index entity_type_created`,
      [l.registry.family('instruction')],
    );
    const links = await aboutOf(l, rows.map((r) => r.id));
    return { presets, kept: rows.map((r) => ({ ...r, about: links.filter((link) => link.from_id === r.id).map((link) => link.to_id) })) };
  }
  if (q.told !== undefined) {
    for (const id of list(q.told, 'told')) used(l.workspace, 'told', id);
    return true;
  }
  if (q.versions !== undefined) {
    const { rows } = await l.db.query(`select id, title, is_open, ${l.props} from entity where type = any($1::text[]) and archived_at is null and props ->> 'preset' is not null order by updated_at, id`, [l.registry.family(q.versions === 'layout' ? 'layout' : 'style')]);
    return rows;
  }
  if (q.looks !== undefined) {
    const { types, named } = q.looks;
    const of = list(types, 'looks.types');
    if (of.some((t) => t !== 'style' && t !== 'layout')) throw new Error('looks reads styles and layouts');
    const { rows } = await l.db.query<{ id: string }>(
      `select id, type, title, ${l.props} from entity where type = any($1::text[]) and archived_at is null and (is_open or id = $2) order by updated_at, id`,
      [of.flatMap((t) => l.registry.family(t)), typeof named === 'string' ? named : null],
    );
    // One archived is left out, and what named it falls back; only a name never kept is refused.
    if (typeof named === 'string' && !rows.some((r) => r.id === named) && !(await l.entity(named))) throw new Error(`No ${of.join(' or ')} "${named}"`);
    const links = await aboutOf(l, rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, about: links.filter((link) => link.from_id === r.id).map((link) => link.to_id) }));
  }
  if (q.styles_at !== undefined) {
    const { rows } = await asOf(l.db, l.registry, l.workspace, Number(q.styles_at));
    const family = new Set(l.registry.family('style'));
    type Style = { id: string; title: string; is_open: boolean; props: Record<string, unknown>; updated_at: string };
    const styles = rows.entity.filter((e) => family.has(String(e.type)) && e.archived_at == null) as unknown as Style[];
    styles.sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)) || a.id.localeCompare(b.id));
    const about = rows.relation.filter((r) => r.type === 'about' && r.valid_to == null);
    return {
      versions: styles.filter((s) => s.props?.preset != null),
      kept: styles.filter((s) => s.is_open).map((s) => ({ id: s.id, title: s.title, props: s.props ?? {}, about: about.filter((r) => r.from_id === s.id).map((r) => String(r.to_id)) })),
    };
  }
  if (q.drawing !== undefined) {
    const versions = (await lookRead(l, { versions: 'layout' })) as { is_open: boolean; props: Record<string, unknown> }[];
    return layoutFor(l.registry, q.drawing.style ?? {}, versions, Array.isArray(q.drawing.have) ? q.drawing.have.map(String) : []) ?? null;
  }
  if (q.drawn_for) return (l.viewer === undefined ? await l.setting<string>('me') : l.viewer) || null;
  if (q.screens) {
    const { rows } = await l.db.query(`select id, title, is_open, ${l.props} from entity where type = any($1::text[]) and archived_at is null order by created_at, id`, [l.registry.family('screen')]);
    return rows;
  }
  if (q.held_types !== undefined) {
    const { rows } = await l.db.query<{ type: string }>(`select t as type from unnest($1::text[]) t where exists (select 1 from entity where type = t and archived_at is null)`, [list(q.held_types, 'held_types')]);
    return rows.map((r) => r.type);
  }
  if (q.style_moves) return styleMoves(l);
  if (q.layout_moves !== undefined) {
    const { rows } = await l.db.query(
      `select id, props from entity where type = any($1::text[]) and (props ? 'code' or props ? 'modules' or props ->> 'preset' = any($2::text[])) order by updated_at, id -- index entity_type`,
      [l.registry.family('style'), list(q.layout_moves, 'layout_moves')],
    );
    return rows;
  }
  return undefined;
}

/** What the move of styles made for one view reads: the styles, what each is about, the views of those, and the views' own props; none when nothing is to move. */
async function styleMoves(l: Archipelago) {
  type Props = Record<string, unknown>;
  const lens = l.registry.family('lens');
  const { rows: styles } = await l.db.query<{ id: string; props: Props }>(
    `select id, props from entity where type = any($1::text[]) and archived_at is null and is_open and props ->> 'preset' is null and not props ? 'on' order by updated_at, id -- index entity_type`,
    [l.registry.family('style')],
  );
  if (!styles.length) return null;
  const { rows: ties } = await l.db.query<{ style: string; to: string; to_type: string; gone: boolean }>(
    `select r.from_id as style, r.to_id as "to", t.type as to_type, t.archived_at is not null as gone from relation r join entity t on t.id = r.to_id where r.type = 'about' and r.valid_to is null and r.from_id = any($1::text[]) order by r.id`,
    [styles.map((s) => s.id)],
  );
  if (!ties.length) return null;
  const { rows: about } = await l.db.query<{ view: string; item: string }>(
    `select r.from_id as view, r.to_id as item from relation r join entity v on v.id = r.from_id where r.type = 'about' and r.valid_to is null and r.to_id = any($1::text[]) and v.type = any($2::text[]) and v.archived_at is null order by r.id`,
    [[...new Set(ties.map((t) => t.to))], lens],
  );
  const ids = [...new Set([...about.map((a) => a.view), ...ties.filter((t) => lens.includes(t.to_type) && !t.gone).map((t) => t.to)])];
  const { rows: kept } = await l.db.query<{ id: string; props: Props }>(`select id, props from entity where id = any($1::text[])`, [ids]);
  return { styles, ties, about, kept };
}
