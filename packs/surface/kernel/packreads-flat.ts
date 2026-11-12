// The flat lens's reads of the map (the query pack, packs/query/kernel/query-flat.ts): the seeds its Find picks, each
// narrowed by Only and Not, the walk along the links it names, and what is sent of what they found. The query pack
// reads the lens and asks the packs that answer a term's set (moved, frontier, worked, a term a pack provides); this is
// the SQL it ran, moved as it was, answered as the asker under row-level security. A term comes as the query pack
// read it, its end found (at) and its set given (ids) where a pack answers it, and as the lens says it (as).
//
// Every read is bounded by the ids in hand, an end of a link, the type index or the limit: a lens that finds nothing
// itself is refused, never the whole map.

import type { Archipelago } from '../../../src/pelago.ts';
import { kernelTypes, SYSTEM, WRAPS } from '../../loader/kernel/head.ts';
import { ISLAND, onIslands } from '../../loader/kernel/island-items.ts';
import { headPos } from '../../log/kernel/tail.ts';
import { blockGraph } from './blocking.ts';
import { proposals } from './map-reads.ts';
import { rankSql, searchIds, slipsOf } from './search.ts';

/** A word of Only (packs/query/kernel/query-only.ts), as the query pack read it. */
export type Word =
  | { word: 'done' | 'blocked' | 'no owner' | 'over estimate' | 'by owner' | 'by agent' }
  | { word: 'status'; status: string }
  | { word: 'changed since' | 'made since' | 'changed before' | 'made before'; at: Date | string };

/** A term as the query pack read it (packs/query/kernel/query-terms.ts), with what it found of it. */
export type FlatTerm = (
  | { sort: 'text'; said: string }
  | { sort: 'type'; type: string }
  | { sort: 'kind'; kind: string }
  | { sort: 'id'; id: string }
  | { sort: 'in' | 'related' | 'island' | 'worked'; end: string }
  | { sort: 'held' | 'moved' | 'frontier' }
  | { sort: 'link'; link: string; end: string; back: boolean; owner?: boolean }
  | { sort: 'word'; word: Word; said: string }
  | { sort: 'service'; word: string; end?: string }
) & {
  /** The term as the lens says it. */
  as: string;
  /** The items its end names, as the viewer may see them. */
  at?: string[];
  /** Its set, where a pack answers it: moved, the frontier (in its order), what the sessions worked on, a provided term's. */
  ids?: string[];
};

export type Found = 'text' | 'type' | 'id' | 'link' | 'in';

export type FlatRead = {
  /** The flat lens's seeds, walk and rows, its terms as the query pack read them. */
  flat?: {
    find: FlatTerm[]; only: FlatTerm[]; not: FlatTerm[];
    /** Whether the lens said its Not: a Not nobody said hides nothing named by id. */
    said_not?: boolean;
    walk: { over: string[] | 'all'; steps: number };
    limit: number;
    /** On a time axis: a seed is open, or changed since the window began. */
    since?: string;
    /** Notes whole for the first items sent. */
    whole?: boolean;
    me: string | null;
    /** A term offered, read before it is added: what it would find (find), or which drawn items it would leave out. */
    preview?: { part: 'find' | 'only' | 'not'; terms: { raw: string; term: FlatTerm }[]; ids: string[] };
  };
  /** What some ends of terms name, as the viewer may see them: an id, or the items so titled of these types (any: none). */
  flat_ends?: { end: string; types: string[] | null }[];
  /** Where the log stands, before a lens that keeps its answer current is read (ui/live.js). */
  flat_pos?: true;
};

/** A narrowing condition on an item (as e), with its parameter when it takes one (`$?` in the condition). */
type Narrowing = { cond: string; param?: unknown };

const LENS_LIMIT = 2000;
const MAX_STEPS = 6;
const NOTE_START = 280;
const NOTES_WHOLE_MOST = 100;
const PREVIEW_MOST = 200;
const PREVIEW_TERMS = 80;

const wayOf = (term: string): { link: string; way: 'out' | 'in' | 'either' } => {
  const way = term.endsWith('>') ? 'out' : term.endsWith('<') ? 'in' : 'either';
  return { link: way === 'either' ? term : term.slice(0, -1), way };
};
const checkedAfter = (words: Word[]) => words.some((w) => w.word === 'blocked' || w.word === 'by owner' || w.word === 'by agent');

/** What an end names, as the viewer may see them: its id, or the items so titled (any case) of the types it may be. */
async function ends(l: Archipelago, asked: NonNullable<FlatRead['flat_ends']>) {
  if (!Array.isArray(asked)) throw new Error('flat_ends is a list of { end, types }');
  const out: { ids?: string[]; named?: { id: string; type: string }[] }[] = [];
  for (const { end, types } of asked) {
    if (typeof end !== 'string') throw new Error('flat_ends: an end is words');
    if ((await l.db.query('select id from entity where id = $1 and archived_at is null', [end])).rows.length) { out.push({ ids: [end] }); continue; }
    if (/^e_[a-z0-9]{8}$/.test(end)) { out.push({ ids: [] }); continue; }
    const family = types ? types.flatMap((x) => l.registry.family(x)) : null;
    const { rows } = await l.db.query<{ id: string; type: string }>(`select id, type from entity where lower(title) = lower($1) and archived_at is null${family ? ' and type = any($3::text[])' : ''} order by updated_at desc, id limit $2`, [end, 5, ...(family ? [family] : [])]);
    out.push({ named: rows });
  }
  return out;
}

/** The items the viewer's pending held changes would edit, archive, merge or tie, and the ends of a link they would end. */
async function heldIds(l: Archipelago): Promise<string[]> {
  const ops = (await proposals(l)).flatMap((p) => p.ops as unknown as Record<string, unknown>[]);
  const ids = new Set(ops.flatMap((o) => ['id', 'keep', 'drop', 'from', 'to'].flatMap((k) => (typeof o[k] === 'string' ? [o[k] as string] : []))));
  const ended = ops.flatMap((o) => (o.op === 'unlink' ? [o.relation as string] : []));
  if (ended.length) {
    const { rows } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where id = any($1::text[])`, [ended]);
    for (const r of rows) (ids.add(r.from_id), ids.add(r.to_id));
  }
  return [...ids];
}

/** The words that are a condition on the row, each with what it reads. */
function wordConditions(words: Word[]): Narrowing[] {
  const out: Narrowing[] = [];
  // A time comes as an instant: a day said is worked out in the workspace's zone by the query pack.
  const instant = (at: Date | string) => new Date(at).toISOString();
  for (const w of words) {
    if (w.word === 'done') out.push({ cond: 'not e.is_open' });
    else if (w.word === 'no owner') out.push({ cond: 'e.owner is null' });
    else if (w.word === 'over estimate')
      out.push({ cond: "case when jsonb_typeof(e.props->'tokens_used') = 'number' and jsonb_typeof(e.props->'tokens_estimated') = 'number' then (e.props->>'tokens_used')::numeric > (e.props->>'tokens_estimated')::numeric else false end" });
    else if (w.word === 'status') out.push({ cond: 'e.status = $?', param: w.status });
    else if ('at' in w) {
      const [field, way] = w.word.split(' ');
      out.push({ cond: `e.${field === 'made' ? 'created_at' : 'updated_at'} ${way === 'since' ? '>=' : '<'} $?::timestamptz`, param: instant(w.at) });
    }
  }
  return out;
}

/** Of the ids found, those the checked words hold of: blocked, as attention says it; by owner or by agent, as the log says. */
async function holding(l: Archipelago, words: Word[], ids: string[]): Promise<string[]> {
  let kept = ids;
  if (kept.length && words.some((w) => w.word === 'blocked')) {
    const graph = await blockGraph(l, kept);
    kept = kept.filter((id) => graph.isBlocked(id));
  }
  const by = words.filter((w) => w.word === 'by owner' || w.word === 'by agent').map((w) => (w.word === 'by owner' ? 'human' : 'agent'));
  if (kept.length && by.length) {
    // The change that last set each one's status, and on whose authority (none, for the system's own).
    const { rows } = await l.db.query<{ id: string; of: string | null }>(
      `select distinct on (f.id) f.id, le.head->'authority'->>'of' as of
         from log_fact f join log_entry le on le.stream = f.stream and le.at = f.at and le.pos = f.pos
        where f.stream = 'facts' and f.id = any($1::text[]) and f.field = 'status' and f.op = '+'
        order by f.id, f.pos desc`,
      [kept],
    );
    const of = new Map(rows.map((r) => [r.id, r.of]));
    kept = kept.filter((id) => by.every((b) => of.get(id) === b));
  }
  return kept;
}

/** A link type the registry knows, checked: its name goes into a read. */
const knownLink = (l: Archipelago, link: string) => {
  if (typeof link !== 'string' || !l.registry.relations.has(l.registry.canonical(link))) throw new Error(`flat: unknown link type "${String(link)}"`);
  return link;
};

/** A term's set as a condition on an item (as e), for Only and Not. An end nobody can see leaves the set empty. */
async function setOf(l: Archipelago, t: FlatTerm, held: () => Promise<string[]>): Promise<Narrowing> {
  if (t.sort === 'text') return { cond: `e.id in (${searchIds('$?', false)})`, param: t.said };
  if (t.sort === 'type') return { cond: 'e.type = any($?::text[])', param: l.registry.family(t.type) };
  // kind <k>, kept in views from before the starter types, is read through the type: the types k is the starter of
  // (what the kind column held), and kind system as the kernel flag, so the flat query's default Not leaves out the same.
  if (t.sort === 'kind') return { cond: 'e.type = any($?::text[])', param: t.kind === SYSTEM ? kernelTypes(l.registry) : [...l.registry.types.values()].filter((x) => x.starter === t.kind).map((x) => x.id) };
  if (t.sort === 'id') return { cond: 'e.id = $?', param: t.id };
  if (t.sort === 'held') return { cond: 'e.id = any($?::text[])', param: await held() };
  if (t.sort === 'moved' || t.sort === 'frontier' || t.sort === 'service' || t.sort === 'worked') return { cond: 'e.id = any($?::text[])', param: t.ids ?? [] };
  if (t.sort === 'word') throw new Error('flat: a word is a condition, not a set');
  const at = t.at ?? [];
  if (t.sort === 'island') return { cond: onIslands('$?'), param: at };
  if (t.sort === 'in') return { cond: 'exists (select 1 from part_closure c where c.descendant = e.id and c.ancestor = any($?::text[]))', param: at };
  if (t.sort === 'related') return { cond: 'exists (select 1 from relation r where r.valid_to is null and ((r.from_id = e.id and r.to_id = any($?::text[])) or (r.to_id = e.id and r.from_id = any($?::text[]))))', param: at };
  if (t.sort !== 'link') throw new Error(`flat: a term of sort ${String(t.sort)} is no set`);
  const [near, far] = t.back ? ['to_id', 'from_id'] : ['from_id', 'to_id'];
  const types = l.registry.relationFamily(knownLink(l, t.link)).map((x) => `'${x.replace(/'/g, "''")}'`).join(',');
  return { cond: `exists (select 1 from relation r where r.${near} = e.id and r.${far} = any($?::text[]) and r.type in (${types}) and r.valid_to is null)`, param: at };
}

/** The flat lens's seeds, walk and rows (packs/query/kernel/query-flat.ts, flatRead), or a preview of a term. */
export async function flatSeeds(l: Archipelago, asked: NonNullable<FlatRead['flat']>) {
  const lens = asked;
  if (!lens || typeof lens !== 'object' || ![lens.find, lens.only, lens.not].every(Array.isArray)) throw new Error('flat is { find, only, not, walk, limit, me }');
  if (!Number.isInteger(lens.limit) || lens.limit < 1 || lens.limit > LENS_LIMIT) throw new Error(`limit must be a whole number from 1 to ${LENS_LIMIT}`);
  if (!Number.isInteger(lens.walk?.steps) || lens.walk.steps < 0 || lens.walk.steps > MAX_STEPS) throw new Error(`walk.steps must be a whole number from 0 to ${MAX_STEPS}`);
  if (lens.walk.over !== 'all') for (const t of lens.walk.over) knownLink(l, wayOf(t).link);
  if (!lens.preview && (!lens.find.length || lens.find.some((t) => t.sort === 'word' || t.sort === 'kind'))) throw new Error('A lens includes something (filter.find): a filter that includes nothing would read the whole map.');
  const since = lens.since === undefined ? undefined : new Date(Date.parse(lens.since)).toISOString();
  const inWindow = since ? `(e.is_open or e.updated_at >= '${since}'::timestamptz)` : null;
  let heldRead: Promise<string[]> | undefined;
  const held = () => (heldRead ??= heldIds(l));
  const { finds, onlys, nots } = { finds: lens.find, onlys: lens.only, nots: lens.not };
  // What a seed must also be, and what nothing may be, as conditions on an item (as e), each with its parameter. An
  // item is of one type, so Only's types are one set. Only within what the viewer cannot see, nothing is.
  const isWord = (t: FlatTerm): t is Extract<FlatTerm, { sort: 'word' }> => t.sort === 'word';
  const types = onlys.flatMap((t) => (t.sort === 'type' ? l.registry.family(t.type) : []));
  const onlySets = await Promise.all(onlys.filter((t) => !isWord(t) && t.sort !== 'type').map((t) => setOf(l, t, held)));
  const words = onlys.filter(isWord).map((t) => t.word);
  const terms: Narrowing[] = [...(types.length ? [{ cond: 'e.type = any($?::text[])', param: types }] : []), ...onlySets, ...(wordConditions(words))];
  const hidden = onlySets.some((t) => Array.isArray(t.param) && !t.param.length);
  const notWords = nots.filter(isWord).map((t) => t.word);
  const out: Narrowing[] = [...(await Promise.all(nots.filter((t) => !isWord(t)).map((t) => setOf(l, t, held)))), ...(wordConditions(notWords))].map((t) => ({ ...t, cond: `not coalesce((${t.cond}), false)` }));
  const notChecked = notWords.filter((w) => checkedAfter([w]));
  const numbered = (list: Narrowing[], n: number) => list.map((t) => (t.param === undefined ? t.cond : t.cond.replaceAll('$?', `$${n++}`)));
  const leftOut = out.filter((t) => t.param !== undefined).map((t) => t.param);
  const narrowing = terms.filter((t) => t.param !== undefined).map((t) => t.param);
  // A document made to give a view or an item as a link is the link's own: no view finds it, unless it names it.
  const keep = (n: number) => ['e.archived_at is null', `not (e.props ? '${WRAPS}')`, ...numbered(out, n)].join(' and ');
  const narrows = (n: number) => numbered(terms, n + leftOut.length);
  const narrowed = (n: number) => [keep(n), ...narrows(n), inWindow].filter(Boolean).join(' and ');
  // Each read finds ids only; what is sent of them is read once, at the end. A seed is found narrowed; a step of the walk is not.
  const read = async (cond: string, sql: (keep: string) => string, own: unknown[], more: unknown[]) => (await l.db.query<{ id: string }>(sql(cond), [...own, ...leftOut, ...more])).rows.map((r) => r.id);
  const find = (sql: (keep: string) => string, own: unknown[]) => read(keep(own.length + 1), sql, own, []);
  const seed = (sql: (keep: string) => string, own: unknown[]) => (hidden ? Promise.resolve([]) : read(narrowed(own.length + 1), sql, own, narrowing));

  const sent = new Set<string>();
  const room = () => lens.limit + 1 - sent.size;
  // Why each item is there: the terms of the filter that found it, or the step of the walk that reached it.
  const foundBy = new Map<string, Found[]>();
  const termsBy = new Map<string, string[]>();
  const stepOf = new Map<string, number>();
  const add = (ids: string[], by?: Found, ts: FlatTerm[] = []) => {
    for (const id of ids) {
      if (by && (sent.has(id) || room() > 0)) {
        foundBy.set(id, [...new Set([...(foundBy.get(id) ?? []), by])]);
        termsBy.set(id, [...new Set([...(termsBy.get(id) ?? []), ...ts.map((t) => t.as)])]);
      }
      if (room() > 0) sent.add(id);
    }
  };
  // Only's words checked on what a read found: then each read of seeds finds as many as one answer may send.
  const checked = checkedAfter(words);
  const reach = () => (checked ? LENS_LIMIT : room());
  const unless = async (found: string[], ws: Word[]) => {
    let kept = found;
    for (const w of ws) if (kept.length) { const h = new Set(await holding(l, [w], kept)); kept = kept.filter((id) => !h.has(id)); }
    return kept;
  };
  const holds = async (found: string[]) => unless(checked ? await holding(l, words, found) : found, notChecked);
  const saidNot = Boolean(lens.said_not);
  /** The items one term of Find finds, narrowed: every read bounded by the term's end, the type index or `most`. */
  const seedOf = async (term: FlatTerm, most: number): Promise<string[]> => {
    if (term.sort === 'id') return hidden ? [] : holds((await l.db.query<{ id: string }>(`select e.id from entity e where e.id = any($1::text[]) and ${[saidNot ? keep(2) : 'e.archived_at is null', ...numbered(terms, saidNot ? 2 + leftOut.length : 2)].join(' and ')}`, [[term.id], ...(saidNot ? leftOut : []), ...narrowing])).rows.map((r) => r.id));
    if (term.sort === 'type') return holds(await seed((k) => `select e.id from entity e where e.type = any($1::text[]) and ${k} order by e.created_at desc, e.id limit $2 -- index entity_type_created`, [l.registry.family(term.type), most]));
    // The frontier in its own order, the strongest reason first; what a session worked on, the newest first.
    if (term.sort === 'frontier') return holds(await seed((k) => `select e.id from entity e where e.id = any($1::text[]) and ${k} order by array_position($1::text[], e.id) limit $2`, [term.ids ?? [], most]));
    if (term.sort === 'held' || term.sort === 'moved') return holds(await seed((k) => `select e.id from entity e where e.id = any($1::text[]) and ${k} order by e.updated_at desc, e.id limit $2`, [term.sort === 'held' ? await held() : (term.ids ?? []), most]));
    if (term.sort !== 'link' && term.sort !== 'related' && term.sort !== 'in' && term.sort !== 'island' && term.sort !== 'worked') return [];
    const at = term.at ?? [];
    if (!at.length) return [];
    if (term.sort === 'worked') return holds(await seed((k) => `select e.id from entity e where e.id = any($1::text[]) and ${k} order by e.updated_at desc, e.id limit $2`, [term.ids ?? [], most]));
    if (term.sort === 'island') return holds(await seed((k) => `select e.id from entity e where ${onIslands('$1')} and ${k} order by e.updated_at desc, e.id limit $2`, [at, most]));
    if (term.sort === 'in') return holds(await seed((k) => `select e.id from part_closure c join entity e on e.id = c.descendant where c.ancestor = any($1::text[]) and ${k} order by e.updated_at desc, e.id limit $2`, [at, most]));
    if (term.sort === 'related') return holds(await seed((k) => `select e.id from relation r join entity e on e.id = case when r.from_id = any($1::text[]) then r.to_id else r.from_id end where (r.from_id = any($1::text[]) or r.to_id = any($1::text[])) and r.valid_to is null and ${k} order by e.updated_at desc, e.id limit $2`, [at, most]));
    if (term.sort !== 'link') return [];
    const [near, far] = term.back ? ['to_id', 'from_id'] : ['from_id', 'to_id'];
    return holds(await seed((k) => `select e.id from relation r join entity e on e.id = r.${near} where r.${far} = any($1::text[]) and r.type = any($2::text[]) and r.valid_to is null and ${k} order by e.updated_at desc, e.id limit $3`, [at, l.registry.relationFamily(knownLink(l, term.link)), most]));
  };
  // What a term offered would change, asked before it is added: what it would find, or which drawn items it would leave out.
  if (lens.preview) {
    const { part, terms: offered, ids } = lens.preview;
    if (part !== 'find' && part !== 'only' && part !== 'not') throw new Error('preview.part must be find, only or not');
    if (!Array.isArray(offered) || offered.length > PREVIEW_TERMS) throw new Error(`preview.terms must be a list of at most ${PREVIEW_TERMS} terms`);
    const drawn = Array.isArray(ids) ? ids.slice(0, LENS_LIMIT) : [];
    const said: Record<string, string[]> = {};
    for (const { raw, term } of offered) {
      if (part === 'find') {
        said[raw] = (await seedOf(term, PREVIEW_MOST + 1)).slice(0, PREVIEW_MOST + 1);
        continue;
      }
      let kept: string[];
      const [cond] = term.sort === 'word' ? wordConditions([term.word]) : [await setOf(l, term, held)];
      if (term.sort === 'word' && checkedAfter([term.word])) kept = await holding(l, [term.word], drawn);
      else kept = (await l.db.query<{ id: string }>(`select e.id from entity e where e.id = any($1::text[]) and ${cond.cond.replaceAll('$?', '$2')}`, [drawn, ...(cond.param === undefined ? [] : [cond.param])])).rows.map((r) => r.id);
      const inSet = new Set(kept);
      said[raw] = part === 'not' ? kept : drawn.filter((id) => !inSet.has(id));
    }
    return { preview: said };
  }

  // The seeds, each narrowed: ids first, then what a link term finds, what is related, what is in an item, what the
  // text finds, the newest of each type named.
  for (const t of finds) if (t.sort === 'id') add(await seedOf(t, 1), 'id', [t]);
  for (const t of finds) if (t.sort === 'held' || t.sort === 'moved' || t.sort === 'frontier') add(await seedOf(t, reach()), 'id', [t]);
  for (const t of finds) if (t.sort === 'worked' && room() > 0) add(await seedOf(t, reach()), 'link', [t]);
  for (const t of finds) if ((t.sort === 'link' || t.sort === 'related') && room() > 0) add(await seedOf(t, reach()), 'link', [t]);
  for (const t of finds) if ((t.sort === 'in' || t.sort === 'island') && room() > 0) add(await seedOf(t, reach()), 'in', [t]);
  // The text is the search read's own (./search.ts): the words in any form in the title or note, or as typed anywhere
  // in the title, the best match first; only when that finds nothing, titles with a word close to what was typed.
  // How many it found in all is kept (matched), an item two sets of words both find counted once.
  let matched: number | undefined;
  const texts: { said: string; near: boolean }[] = [];
  const matchedIds = new Set<string>();
  for (const t of hidden ? [] : finds.filter((x): x is Extract<FlatTerm, { sort: 'text' }> => x.sort === 'text')) {
    if (room() <= 0) break;
    const finding = async (near: boolean) => (await l.db.query<{ id: string; n: number }>(
      `select e.id, count(*) over ()::int as n from entity e where e.id in (${searchIds('$1', near)}) and ${narrowed(3)} order by ${rankSql('$1', 'e.')} desc, e.updated_at desc, e.id limit $2`,
      [t.said, reach(), ...leftOut, ...narrowing])).rows;
    let near = false;
    let rows = await finding(false);
    if (!rows.length) rows = await finding((near = true));
    const found = await holds(rows.map((r) => r.id));
    texts.push({ said: t.said, near });
    for (const id of found) matchedIds.add(id);
    matched = (matched ?? 0) + (checked ? found.length : (rows[0]?.n ?? 0));
    add(found, 'text', [t]);
  }
  if (texts.length > 1 && matched) {
    matched = checked
      ? matchedIds.size
      : (await l.db.query<{ n: number }>(
          `select count(*)::int as n from entity e where e.id in (select pelago_search_ids(v, s.near) from unnest($1::text[], $2::boolean[]) s(q, near) cross join lateral ${slipsOf('s.q', 's.near')} slips(v)) and ${narrowed(3)}`,
          [texts.map((a) => a.said), texts.map((a) => a.near), ...leftOut, ...narrowing])).rows[0].n;
  }
  for (const t of finds) if (t.sort === 'type' && room() > 0) add(await seedOf(t, reach()), 'type', [t]);

  // The walk: a step at a time along the links named, each the way it is named, to what the filter does not exclude.
  const over = lens.walk.over;
  const along = (way: 'out' | 'in') => (over === 'all' ? null : l.registry.relationFamily(...over.map(wayOf).filter((t) => t.way !== (way === 'out' ? 'in' : 'out')).map((t) => t.link)));
  const ways = ([['from_id', 'to_id', along('out')], ['to_id', 'from_id', along('in')]] as const).filter(([, , ts]) => ts?.length !== 0);
  // Under the default Not, a walk back along works_on keeps the runs it reaches: the sessions at work on what the view draws.
  const working = new Set(l.registry.relationFamily('works_on'));
  const sessions = !saidNot && over !== 'all' && over.map(wayOf).some((t) => t.way !== 'out' && working.has(l.registry.canonical(t.link))) ? l.registry.family('run') : [];
  for (let level = [...sent], n = 0; level.length && n < lens.walk.steps && room() > 0 && ways.length; n++) {
    const typed = ways.flatMap(([, , ts]) => (ts ? [ts] : []));
    const kept = (k: string) => (sessions.length ? `(${k} or (e.archived_at is null and e.type = any($${4 + typed.length}::text[])))` : k);
    const way = (k: string) => ways.map(([near, far, ts], i) => `select e.id, e.updated_at from relation r join unnest($1::text[]) s(id) on s.id = r.${near} join entity e on e.id = r.${far} where r.valid_to is null${ts ? ` and r.type = any($${4 + ways.slice(0, i).filter(([, , x]) => x).length}::text[])` : ''} and e.id <> all($2::text[]) and ${kept(k)}`).join(' union ');
    level = await unless(await find((k) => `select id from (${way(k)}) w order by updated_at desc, id limit $3`, [level, [...sent], room(), ...typed, ...(sessions.length ? [sessions] : [])]), notChecked);
    for (const id of level) if (!sent.has(id)) stepOf.set(id, n + 1);
    add(level);
  }

  const cut = sent.size > lens.limit;
  const keptIds = [...sent].slice(0, lens.limit);
  const wholeIds = lens.whole ? keptIds.slice(0, NOTES_WHOLE_MOST) : [];
  const { rows } = await l.db.query<{ id: string; type: string; props: Record<string, unknown> }>(`select id, type, title, case when id = any($2::text[]) then body else left(body, ${NOTE_START + 1}) end as body, visibility, status, is_open, owner, ${l.props}, created_at, updated_at from entity where id = any($1::text[])`, [keptIds, wholeIds]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = keptIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  // The links among what is sent, of every type: a canvas draws what ties what it shows.
  const { rows: links } = await l.db.query<{ id: string; type: string; from_id: string; to_id: string; props: Record<string, unknown> }>(
    `with s(id) as (select unnest($1::text[])) select r.id, r.type, r.from_id, r.to_id, r.props from relation r join s a on a.id = r.from_id join s b on b.id = r.to_id where r.valid_to is null order by r.id`,
    [items.map((e) => e.id)],
  );
  // Where each lives, on a map with islands on, and each island's name and the pack it speaks, read for those sent alone.
  const islandOf = (e: { props: Record<string, unknown> }) => (l.registry.onIslands && typeof e.props?.[ISLAND] === 'string' ? (e.props[ISLAND] as string) : undefined);
  const islandIds = [...new Set(items.flatMap((e) => islandOf(e) ?? []))];
  const isles = islandIds.length ? (await l.db.query<{ id: string; title: string; pack: string | null }>(`select id, title, props->>'pack' as pack from entity where id = any($1::text[])`, [islandIds])).rows : [];
  return {
    items, links, whole: items.filter((e) => wholeIds.includes(e.id)).map((e) => e.id),
    found: Object.fromEntries(foundBy), terms: Object.fromEntries(termsBy), step: Object.fromEntries(stepOf),
    on_islands: l.registry.onIslands, islands: islandIds.map((id) => ({ id, ...isles.find((r) => r.id === id) })),
    ...(cut && { cut: true }), ...(matched !== undefined && { matched }),
  };
}

/** The answer to one of these reads, or undefined when the read is none of them. */
export async function flatRead(l: Archipelago, q: FlatRead): Promise<unknown> {
  if (q.flat_ends !== undefined) return ends(l, q.flat_ends);
  if (q.flat_pos) return headPos(l.db);
  if (q.flat !== undefined) return flatSeeds(l, q.flat);
  return undefined;
}
