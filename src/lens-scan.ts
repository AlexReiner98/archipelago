// What a lens reads. A lens of the whole map reads the whole map (a preset's folds and links pushed into the query);
// a lens that starts from an item reads only what is around it, so what it costs follows what it answers and not the
// size of the map: everything inside the start (down the links that say what is inside what), what the start waits on
// step by step, what any of those is tied to by a link the lens may send and everything inside that, the sessions at
// work on it, and who owns it all. A lens that goes near reads what it walks to, and nothing inside it.

import type { Kept } from './lens-kept.ts';
import { LENS_DEFAULT, readLens, WAITS, type Lens } from './lens-read.ts';
import { stepIds } from './lens-steps.ts';
import type { Archipelago } from './pelago.ts';

export interface Row {
  id: string;
  type: string; kind: string | null;
  title: string;
  status: string;
  is_open: boolean;
  owner: string | null;
  props: Record<string, unknown>;
  created_at: Date; updated_at: Date;
  /** Read for where a lens starts only. */
  body?: string | null;
}

export interface Link {
  id: string;
  type: string;
  from_id: string;
  to_id: string;
  says: string | null;
  state: string | null;
  /** What a waits_on link says it waits for. */
  for: string | null;
}

/** What is around the starts of a lens: the region it reads. */
export interface Around {
  /** Where the lens may start: the item asked about, and where a view of it starts instead. */
  starts: string[];
  /** The links that say what is inside what, each with its flavours. */
  by: string[];
  /** The links the lens may send, each with its flavours; null for every kind. */
  over: string[] | null;
  /** The links that say one thing waits on another: what the start waits on, step by step, is read too. */
  waits: string[];
  /** Steps along the links sent, either way, from the start. */
  near?: number;
  /** Items read whatever else is: the steps a view names. */
  ids?: string[];
  /** Steps up from the starts, along the links that say what is inside what: what holds them is read too. */
  up?: number;
  /** Links from the starts whose ends are read as the starts are, with what they are tied to: a task's resources. */
  through?: string[];
  /** What holds what is tied, all the way up: where each of those sits. */
  above?: boolean;
  /** The links in the order they were made (and written, within one change), not by id: for a reader that keeps to that order. */
  made?: boolean;
  /** Only what the starts and what holds them link to: nothing linked to them, nothing inside what they link to, no one's sessions. */
  narrow?: boolean;
}

/** One link a region is tied by beyond what it holds: the sessions at work on what is in it, now or before. */
const WORKS_ON = 'sys.works_on';

const COLUMNS = (props: string) => `id, type, kind, title, status, is_open, owner, ${props}, created_at, updated_at`;
const LINKS = `id, type, from_id, to_id, props ->> 'says' as says, props ->> 'state' as state, props ->> 'for' as for`;
/** The same, of links read among some items (as r). */
const LINKS_AMONG = `r.id, r.type, r.from_id, r.to_id, r.props ->> 'says' as says, r.props ->> 'state' as state, r.props ->> 'for' as for`;
/** What a stage that is no picture reads of a link: what it joins, and what a waits_on link says it waits for. */
const BARE_LINKS = (waits: string | null) => `type, from_id, to_id${waits ? `, case when type = any(${waits}) then props ->> 'for' end as for` : ''}`;
/** Of an item's fields, only those named, where the reader may read them all. */
const only = (l: Archipelago, fields: string[] | undefined) =>
  fields && l.props === 'props' && fields.every((f) => /^[a-z][a-z0-9_]*$/.test(f)) ? `jsonb_build_object(${fields.map((f) => `'${f}', props -> '${f}'`).join(', ')}) as props` : l.props;
/** And of an item: what it is, whether it is open, and those of its other columns asked for. */
const BARE = (props: string, columns: string[]) => ['id', 'type', 'kind', 'title', 'is_open', ...columns.filter((x) => ['status', 'owner', 'updated_at', 'created_at'].includes(x)), props].join(', ');

/** Every item and link a lens of the whole map reads, its folds and links pushed into the query when they are known. */
export async function scanAll(l: Archipelago, known?: { from?: string; fold: string[]; types: string[] | null; count?: boolean; ordered?: boolean; fields?: string[]; columns?: string[] }) {
  const [closed, system] = [Boolean(known?.fold.includes('closed')), Boolean(known?.fold.includes('system'))];
  // Plain tests the database can make before it asks whether the reader may see a row.
  const keep = [closed && 'is_open', system && "(kind is null or kind <> 'system')"].filter(Boolean).join(' and ');
  const start = known?.from;
  const { rows: entities } = await l.db.query<Row>(
    `select ${known?.ordered === false ? BARE(only(l, known.fields), known.columns ?? ['status', 'owner', 'updated_at', 'created_at']) : COLUMNS(l.props)} from entity where archived_at is null${keep ? ` and (${start ? 'id = $1 or ' : ''}(${keep}))` : ''}`,
    keep && start ? [start] : [],
  );
  // What was not read is counted, as it would have been left out.
  const unread = known && known.count !== false
    ? (
        await l.db.query<{ closed: number; system: number }>(
          `select count(*) filter (where $2 and not is_open and not ($3 and kind is not distinct from 'system'))::int as closed, count(*) filter (where $3 and kind is not distinct from 'system')::int as system from entity where archived_at is null and id is distinct from $1`,
          [known.from ?? null, closed, system],
        )
      ).rows[0]
    : { closed: 0, system: 0 };
  const types = known?.types ?? null;
  // A picture is drawn from its links by id. A stage that is no picture reads only what it joins: what waits on what
  // as the map keeps it, the rest by id.
  const bare = known?.ordered === false;
  // What waits on what, when the stage reads such links: they come first, as the map keeps them, with what each waits for.
  const waiting = l.registry.relationFamily(...WAITS);
  const waits = !types || types.some((t) => waiting.includes(t)) ? '$1::text[]' : null;
  const { rows: relations } = await l.db.query<Link>(
    bare
      ? `select ${BARE_LINKS(waits)} from relation where valid_to is null${types ? ` and type = any($${waits ? 2 : 1}::text[])` : ''} order by ${waits ? `type = any(${waits}) desc, case when type = any(${waits}) then ctid end, ` : ''}id`
      : `select ${LINKS} from relation where valid_to is null${types ? ' and type = any($1::text[])' : ''} order by id`,
    bare ? [...(waits ? [waiting] : []), ...(types ? [types] : [])] : types ? [types] : [],
  );
  return { entities, relations, unread };
}

/**
 * The ids around the starts, walked a level at a time: each level is one lookup by the indexes on relation, so a
 * walk costs what it finds, whether or not the database has gathered statistics on the map (a fresh copy has none).
 */
async function regionOf(l: Archipelago, around: Around): Promise<string[]> {
  const typed = (types: string[] | null) => (types ? ' and r.type = any($2::text[])' : '');
  const step = async (ids: string[], from: 'from_id' | 'to_id', types: string[] | null, ended = false) => {
    if (!ids.length || types?.length === 0) return [];
    const to = from === 'from_id' ? 'to_id' : 'from_id';
    const { rows } = await l.db.query<{ id: string }>(`select r.${to} as id from relation r join unnest($1::text[]) s(id) on s.id = r.${from} where true${ended ? '' : ' and r.valid_to is null'}${typed(types)}`, types ? [ids, types] : [ids]);
    return rows.map((r) => r.id);
  };
  // From some items, step by step along links one way, as far as they go: all that was reached.
  const walk = async (from: string[], way: 'from_id' | 'to_id', types: string[], steps = Infinity) => {
    const seen = new Set(from);
    for (let level = from, n = 0; level.length && n < steps; n++) level = (await step(level, way, types)).filter((id) => !seen.has(id) && seen.add(id));
    return seen;
  };
  // A lens that goes near sends what it walks to and nothing else: that is all it reads.
  if (around.near) {
    const walked = new Set(around.starts);
    for (let level = around.starts, n = 0; level.length && n < around.near; n++) level = [...(await step(level, 'from_id', around.over)), ...(await step(level, 'to_id', around.over))].filter((id) => !walked.has(id) && walked.add(id));
    return [...walked];
  }
  const down = await walk(around.starts, 'to_id', around.by);
  const holds = around.up ? await walk(around.starts, 'from_id', around.by, around.up) : [];
  const core = new Set([...down, ...holds, ...(around.waits.length ? await walk(around.starts, 'from_id', around.waits) : []), ...(around.through ? await step(around.starts, 'from_id', around.through) : []), ...(around.ids ?? [])]);
  // What a link it may send ties to any of that; and, unless narrow, what ties to it, the sessions that were at work
  // on what is inside (ended or not), everything inside what is tied, and whoever owns any of it, for a picture filed by person.
  const ids = [...core];
  const out = await step(ids, 'from_id', around.over);
  if (around.narrow) return [...new Set([...core, ...out])];
  const tied = [...out, ...(await step(ids, 'to_id', around.over)), ...(await step([...down], 'to_id', [WORKS_ON], true))].filter((id) => !core.has(id));
  const region = new Set([...core, ...(await walk([...new Set(tied)], 'to_id', around.by)), ...(around.above ? await walk([...new Set(tied)], 'from_id', around.by) : [])]);
  const { rows: owners } = await l.db.query<{ owner: string }>(`select distinct e.owner from entity e join unnest($1::text[]) s(id) on s.id = e.id where e.owner is not null`, [[...region]]);
  for (const o of owners) region.add(o.owner);
  return [...region];
}

/** The items and links around the starts of a lens, and nothing else. */
export async function scanAround(l: Archipelago, around: Around) {
  const region = await regionOf(l, around);
  // The note of where it starts, too: a brief reads it.
  const { rows: entities } = await l.db.query<Row>(`select ${COLUMNS(l.props)}, case when id = any($2::text[]) then body end as body from entity where archived_at is null and id = any($1::text[])`, [region, around.starts]);
  // Joined to the ids, not tested against a list of them: a planner with statistics weighs every id in a list.
  const { rows: relations } = await l.db.query<Link>(`with s(id) as (select unnest($1::text[])) select ${LINKS_AMONG} from relation r join s a on a.id = r.from_id join s b on b.id = r.to_id where r.valid_to is null order by ${around.made ? 'r.valid_from, r.ctid' : 'r.id'}`, [region]);
  return { entities, relations, unread: { closed: 0, system: 0 } };
}

/**
 * What a lens from an item reads around it: inside the item and where any view of it starts, down the links any of
 * them says what is inside what by; what the item waits on; near it, for a preset that goes near; and what a link any of them
 * may send ties to that.
 */
export function aroundOf(l: Archipelago, hub: string, input: Record<string, unknown>, early: Lens | undefined, kept: Kept[]): Around {
  const asked = [input, ...kept.map((one) => one.props)];
  const named = (key: string) => asked.flatMap((x) => (typeof x[key] === 'string' ? [x[key] as string] : []));
  const by = [...new Set([LENS_DEFAULT.by, ...(early ? [early.by] : named('by'))])].filter((kind) => l.registry.relations.has(kind));
  const overs = early ? [early.over] : [LENS_DEFAULT.over, WAITS, ...asked.map((x) => x.over).filter((x) => x !== undefined)];
  const over = overs.some((x) => x === 'all' || !Array.isArray(x)) ? null : l.registry.relationFamily(...new Set((overs as string[][]).flat().filter((kind) => l.registry.relations.has(kind))));
  return {
    starts: [hub, ...named('from').filter((id) => id !== hub)],
    by: l.registry.relationFamily(...by),
    over,
    // What holds an item is a view of it a page may choose; a preset is no page.
    waits: early ? [] : l.registry.relationFamily(...WAITS),
    near: early?.near ?? 0,
    ids: kept.flatMap((one) => stepIds(one.props.steps)),
  };
}

/**
 * The lens query of a preset, read and no more: the preset's lens under what is asked, and what that lens reads,
 * around where it starts or across the map. A preset whose answer is not a picture (attention, a brief) answers
 * from this; `more` is what a preset reads beyond its lens (a brief, what holds its task), `fields` the only fields of
 * each item it reads and `columns` the only columns beyond what it is, where it needs no more.
 */
export async function lensRead(l: Archipelago, input: Record<string, unknown>, preset: Record<string, unknown>, more: Partial<Around> = {}, fields?: string[], columns?: string[]) {
  const asked = readLens(l, input, readLens(l, preset));
  const scan = asked.from ? await scanAround(l, { ...aroundOf(l, asked.from, input, asked, []), ...more }) : await scanAll(l, { from: undefined, fold: asked.fold, types: asked.over === 'all' ? null : [asked.by, ...asked.over], count: false, ordered: false, fields, columns });
  return { asked, ...scan, whole: !asked.from };
}
