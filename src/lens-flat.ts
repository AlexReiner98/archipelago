// The flat lens (the decision "The lens is a filter, a walk and a limit", 25 Oct 2026): a filter, a walk and a limit,
// and nothing else. The filter is three lists of one kind of term (src/lens-terms.ts): Find's sets are added to pick the
// seeds, each of Only's must hold of every seed as well, and Not's are taken away from everything the walk reaches too.
// The walk follows the link types named, each out, in or either way, step by step; the limit is the most it sends.
// The answer is items and the links among them: no containment, no places, no views, no style. A lens may also name
// a window of time (`time`, src/timeaxis.ts): it finds nothing more, and each item says where it falls in the window.
//
// Every read is bounded by the ids in hand, an end of a link, the type index or the limit, and runs as the viewer:
// row-level security keeps what they may not see out of the seeds, the walk and the links alike.

import { SYSTEM } from './head.ts';
import type { Archipelago } from './pelago.ts';
import { checkedAfter, holding, wordConditions, type Narrowing, type Word } from './lens-only.ts';
import { endsOf, readTerm, sayTerm, setOf, type Term } from './lens-terms.ts';
import { rankSql, searchIds, slipsOf } from './search.ts';
import { fileOnAxis } from './timelanes.ts';
import { placeAll, readAxis, resolveAxis, windowOf, zoneOf, type TimeAxis } from './timeaxis.ts';

/** Which term of the filter found an item: its words, a type, an id named, a link term. */
export type Found = 'text' | 'type' | 'id' | 'link' | 'in';

export interface FlatLens {
  /** The terms whose sets are added to pick the seeds. */
  find: string[];
  /** The terms whose sets each seed must be in (types, one set: an item is of one type). */
  only: string[];
  /** The terms whose sets are taken away from everything, an item named by id too (e_ndcxf2bv). */
  not: string[];
  /** The link types followed, each as named (`depends_on>` out, `depends_on<` in, `depends_on` either way), and how many steps. */
  walk: { over: string[] | 'all'; steps: number };
  /** The most items sent. */
  limit: number;
  /** A window of time each item is placed in, for a drawing along a time axis; its ends may be said from today. */
  time?: TimeAxis;
}

/** What is left out unless the lens says otherwise: the app's own configuration. */
const NOT_DEFAULT = [`kind ${SYSTEM}`];
/** The most items one answer sends. */
export const LENS_LIMIT = 2000;
/** Items sent unless the lens says otherwise. */
const FLAT_LIMIT = 500;
/** The most choices one preview counts, and the most items it says of each: past that a choice reads as 200+. */
export const PREVIEW_TERMS = 80;
export const PREVIEW_MOST = 200;
/** The most steps a walk takes. */
const MAX_STEPS = 6;
/** How much of an item's note travels with it: enough to show on hover. */
const NOTE_START = 280;
/** Asked for whole (`notes: "whole"`, for a drawing that reads them, such as the pages), the notes of this many items, seeds first. */
export const NOTES_WHOLE_MOST = 100;

/** A link the walk follows and which way (decision e_gue6cg6q): `>` along it from the item it starts at, `<` back to it, else either. */
export const wayOf = (term: string): { link: string; way: 'out' | 'in' | 'either' } => {
  const way = term.endsWith('>') ? 'out' : term.endsWith('<') ? 'in' : 'either';
  return { link: way === 'either' ? term : term.slice(0, -1), way };
};

const names = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v)) throw new Error(`${field} must be a list of names`);
  return value as string[];
};

/** A lens said in the words before the three lists, until what still says them is moved. */
export const fromBefore = (f: Record<string, unknown>) => {
  const list = (x: unknown) => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]) as string[];
  const link = (t: unknown) => (typeof t === 'string' ? t : (t as { to?: string }).to !== undefined ? `${(t as { link: string }).link} ${(t as { to: string }).to}` : `${(t as { link: string }).link}< ${(t as { from: string }).from}`);
  return {
    find: [...list(f.ids).map((x) => `id ${x}`), ...list(f.links).map(link), ...list(f.in).map((x) => `in ${x}`), ...list(f.text).map(String).map((w) => w.trim()).filter(Boolean).map((w) => `text ${w}`), ...list(f.types).map((t) => `type ${t}`)],
    only: [...list(f.only), ...list(f.within).map((x) => `in ${x}`)],
    ...(f.exclude !== undefined && { not: list(f.exclude).map((x) => (x === 'closed' ? 'done' : x === SYSTEM ? `kind ${SYSTEM}` : `type ${x}`)) }),
  };
};

/** The flat lens asked for, each field checked. A filter that includes nothing is refused: never the whole map. */
export function readFlat(l: Archipelago, input: Record<string, unknown>): FlatLens {
  const asked = (input.filter ?? {}) as Record<string, unknown>;
  if (typeof asked !== 'object' || Array.isArray(asked)) throw new Error('filter must be an object: { find, only, not }, each a list of terms');
  const filter = (asked.find === undefined && asked.not === undefined ? fromBefore(asked) : asked) as { find?: unknown; only?: unknown; not?: unknown };
  const part = (name: 'find' | 'only' | 'not', value: unknown) => {
    if (value !== undefined && !Array.isArray(value)) throw new Error(`filter.${name} must be a list of terms`);
    return [...new Set(((value ?? []) as unknown[]).map((t) => sayTerm(readTerm(l, t, name))))];
  };
  const find = part('find', filter.find);
  const only = part('only', filter.only);
  const not = filter.not === undefined ? NOT_DEFAULT : part('not', filter.not);
  for (const t of find.map((x) => readTerm(l, x, 'find'))) if (t.sort === 'word' || t.sort === 'kind') throw new Error(`filter.find: "${sayTerm(t)}" can narrow what is found (only, not) but finds nothing itself: alone it would read the whole map`);
  if (!find.length && !input.preview)
    throw new Error(only.length
      ? 'A lens includes something (filter.find) for only to narrow: alone, it would read the whole map.'
      : 'A lens includes something (filter.find): a filter that includes nothing would read the whole map.');
  const walkIn = (input.walk ?? {}) as Record<string, unknown>;
  const over = walkIn.over === undefined ? [] : walkIn.over === 'all' ? 'all' : names(walkIn.over, 'walk.over');
  if (over !== 'all') for (const { link } of over.map(wayOf)) if (!l.registry.relations.has(l.registry.canonical(link))) throw new Error(`walk.over: unknown link type "${link}" (a link type, with > to go out along it or < to come in)`);
  const steps = walkIn.steps ?? (over.length ? 1 : 0);
  if (!Number.isInteger(steps) || (steps as number) < 0 || (steps as number) > MAX_STEPS) throw new Error(`walk.steps must be a whole number from 0 to ${MAX_STEPS}`);
  const limit = input.limit ?? FLAT_LIMIT;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > LENS_LIMIT) throw new Error(`limit must be a whole number from 1 to ${LENS_LIMIT}`);
  return { find, only, not, walk: { over, steps: steps as number }, limit: limit as number, ...(input.time !== undefined && { time: readAxis(input.time) }) };
}

interface Row {
  id: string; kind: string | null; type: string; title: string; body: string;
  visibility: string; status: string; is_open: boolean; owner: string | null;
  props: Record<string, unknown>; created_at: Date; updated_at: Date;
}

/** The flat lens answered: the lens as read, the items (head and shown fields), the links among them, and whether the limit cut it. */
export async function flatLens(l: Archipelago, input: Record<string, unknown>) {
  const lens = readFlat(l, input);
  // How much of each note is sent is not the lens: the same items, their notes whole for a drawing that reads them.
  if (input.notes !== undefined && input.notes !== 'whole') throw new Error('notes must be "whole", or left out for the start of each note');
  const whole = input.notes === 'whole';
  // On a time axis its ends said from today are worked out now, in the workspace's zone; a seed is open, or changed
  // since the window began (as the old placed read had it), so the sessions of past months do not crowd it out.
  const zone = lens.time && (await zoneOf(l));
  if (lens.time) lens.time = resolveAxis(lens.time, zone!);
  const inWindow = lens.time ? `(e.is_open or e.updated_at >= '${new Date(windowOf(lens.time, zone!)[0]).toISOString()}'::timestamptz)` : null;
  const me = l.viewer || (await l.setting<string>('me')) || null;
  const finds = lens.find.map((t) => readTerm(l, t, 'find'));
  const onlys = lens.only.map((t) => readTerm(l, t, 'only'));
  const nots = lens.not.map((t) => readTerm(l, t, 'not'));
  // What a seed must also be, and what nothing may be, as conditions on an item (as e), each with its parameter. An
  // item is of one type, so Only's types are one set. Only within what the viewer cannot see, nothing is.
  const isWord = (t: Term): t is Extract<Term, { sort: 'word' }> => t.sort === 'word';
  const types = onlys.flatMap((t) => (t.sort === 'type' ? l.registry.family(t.type) : []));
  const onlySets = await Promise.all(onlys.filter((t) => !isWord(t) && t.sort !== 'type').map((t) => setOf(l, t as Exclude<Term, { sort: 'word' }>, me)));
  const words = onlys.filter(isWord).map((t) => t.word);
  const terms: Narrowing[] = [...(types.length ? [{ cond: 'e.type = any($?::text[])', param: types }] : []), ...onlySets, ...(await wordConditions(l, words, me))];
  const hidden = onlySets.some((t) => Array.isArray(t.param) && !t.param.length);
  const notWords = nots.filter(isWord).map((t) => t.word);
  const out: Narrowing[] = [...(await Promise.all(nots.filter((t) => !isWord(t)).map((t) => setOf(l, t as Exclude<Term, { sort: 'word' }>, me)))), ...(await wordConditions(l, notWords, me))].map((t) => ({ ...t, cond: `not coalesce((${t.cond}), false)` }));
  const notChecked = notWords.filter((w) => checkedAfter([w]));
  const numbered = (list: Narrowing[], n: number) => list.map((t) => (t.param === undefined ? t.cond : t.cond.replaceAll('$?', `$${n++}`)));
  const leftOut = out.filter((t) => t.param !== undefined).map((t) => t.param);
  const narrowing = terms.filter((t) => t.param !== undefined).map((t) => t.param);
  const keep = (n: number) => ['e.archived_at is null', ...numbered(out, n)].join(' and ');
  const narrows = (n: number) => numbered(terms, n + leftOut.length);
  const narrowed = (n: number) => [keep(n), ...narrows(n), inWindow].filter(Boolean).join(' and ');
  // Each read finds ids only; what is sent of them is read once, at the end. A seed is found narrowed; a step of the walk is not.
  const read = async (cond: string, sql: (keep: string) => string, own: unknown[], more: unknown[]) => (await l.db.query<{ id: string }>(sql(cond), [...own, ...leftOut, ...more])).rows.map((r) => r.id);
  const find = (sql: (keep: string) => string, own: unknown[]) => read(keep(own.length + 1), sql, own, []);
  const seed = (sql: (keep: string) => string, own: unknown[]) => (hidden ? Promise.resolve([]) : read(narrowed(own.length + 1), sql, own, narrowing));

  const sent = new Set<string>();
  const room = () => lens.limit + 1 - sent.size;
  // Why each item is there: the terms of the filter that found it (a seed may be found by more than one), or the step
  // of the walk that reached it. A person and an agent read the same reason (decision e_drt4g872: Find's terms).
  const foundBy = new Map<string, Found[]>();
  // And by which of them, as the lens says it: what a term lights when it is hovered.
  const termsBy = new Map<string, string[]>();
  const stepOf = new Map<string, number>();
  const add = (ids: string[], by?: Found, terms: Term[] = []) => {
    for (const id of ids) {
      if (by && (sent.has(id) || room() > 0)) {
        foundBy.set(id, [...new Set([...(foundBy.get(id) ?? []), by])]);
        termsBy.set(id, [...new Set([...(termsBy.get(id) ?? []), ...terms.map(sayTerm)])]);
      }
      if (room() > 0) sent.add(id);
    }
  };
  // Only's words checked on what a read found: then each read of seeds finds as many as one answer may send, for them
  // to keep what they hold of.
  const checked = checkedAfter(words);
  const reach = () => (checked ? LENS_LIMIT : room());
  const unless = async (found: string[], ws: Word[]) => {
    let kept = found;
    for (const w of ws) if (kept.length) { const held = new Set(await holding(l, [w], kept)); kept = kept.filter((id) => !held.has(id)); }
    return kept;
  };
  const holds = async (found: string[]) => unless(checked ? await holding(l, words, found) : found, notChecked);

  // Not takes away what it says of an item named by id (e_ndcxf2bv); what nobody said, the default, hides nothing named.
  const saidNot = (input.filter as { not?: unknown; exclude?: unknown } | undefined)?.not !== undefined || (input.filter as { exclude?: unknown } | undefined)?.exclude !== undefined;
  /** The items one term of Find finds, narrowed: every read bounded by the term's end, the type index or `most`. */
  const seedOf = async (term: Term, most: number): Promise<string[]> => {
    if (term.sort === 'id') return hidden ? [] : holds((await l.db.query<{ id: string }>(`select e.id from entity e where e.id = any($1::text[]) and ${[saidNot ? keep(2) : 'e.archived_at is null', ...numbered(terms, saidNot ? 2 + leftOut.length : 2)].join(' and ')}`, [[term.id], ...(saidNot ? leftOut : []), ...narrowing])).rows.map((r) => r.id));
    if (term.sort === 'type') return holds(await seed((k) => `select e.id from entity e where e.type = any($1::text[]) and ${k} order by e.created_at desc, e.id limit $2 -- index entity_type_created`, [l.registry.family(term.type), most]));
    if (term.sort !== 'link' && term.sort !== 'related' && term.sort !== 'in') return [];
    const at = await endsOf(l, term, me);
    if (!at.length) return [];
    if (term.sort === 'in') return holds(await seed((k) => `select e.id from part_closure c join entity e on e.id = c.descendant where c.ancestor = any($1::text[]) and ${k} order by e.updated_at desc, e.id limit $2`, [at, most]));
    if (term.sort === 'related') return holds(await seed((k) => `select e.id from relation r join entity e on e.id = case when r.from_id = any($1::text[]) then r.to_id else r.from_id end where (r.from_id = any($1::text[]) or r.to_id = any($1::text[])) and r.valid_to is null and ${k} order by e.updated_at desc, e.id limit $2`, [at, most]));
    const [near, far] = term.back ? ['to_id', 'from_id'] : ['from_id', 'to_id'];
    return holds(await seed((k) => `select e.id from relation r join entity e on e.id = r.${near} where r.${far} = any($1::text[]) and r.type = any($2::text[]) and r.valid_to is null and ${k} order by e.updated_at desc, e.id limit $3`, [at, l.registry.relationFamily(term.link), most]));
  };
  // What a term offered in find would change, asked before it is added: what it would find, or which of the items drawn
  // it would leave out. Nothing else of the lens is read.
  if (input.preview) {
    const asked = input.preview as { part?: string; terms?: unknown; ids?: unknown };
    const part = asked.part;
    if (part !== 'find' && part !== 'only' && part !== 'not') throw new Error('preview.part must be find, only or not');
    if (!Array.isArray(asked.terms) || asked.terms.length > PREVIEW_TERMS) throw new Error(`preview.terms must be a list of at most ${PREVIEW_TERMS} terms`);
    const drawn = Array.isArray(asked.ids) ? (asked.ids as string[]).slice(0, LENS_LIMIT) : [];
    const said: Record<string, string[]> = {};
    for (const raw of asked.terms) {
      const term = readTerm(l, raw, part);
      if (part === 'find') {
        said[String(raw)] = (await seedOf(term, PREVIEW_MOST + 1)).slice(0, PREVIEW_MOST + 1);
        continue;
      }
      let held: string[];
      const [cond] = term.sort === 'word' ? await wordConditions(l, [term.word], me) : [await setOf(l, term, me)];
      if (term.sort === 'word' && checkedAfter([term.word])) held = await holding(l, [term.word], drawn);
      else held = (await l.db.query<{ id: string }>(`select e.id from entity e where e.id = any($1::text[]) and ${cond.cond.replaceAll('$?', '$2')}`, [drawn, ...(cond.param === undefined ? [] : [cond.param])])).rows.map((r) => r.id);
      const inSet = new Set(held);
      said[String(raw)] = part === 'not' ? held : drawn.filter((id) => !inSet.has(id));
    }
    return { preview: said } as never;
  }

  // The seeds, each narrowed: ids first, then what a link term finds, what is related, what is in an item, what the
  // text finds, the newest of each type named.
  for (const t of finds) if (t.sort === 'id') add(await seedOf(t, 1), 'id', [t]);
  for (const t of finds) if ((t.sort === 'link' || t.sort === 'related') && room() > 0) add(await seedOf(t, reach()), 'link', [t]);
  // What is in an item, at any depth, read from the part_of closure (decision e_tvsdqjeq), the newest first; in an item
  // the viewer cannot see, nothing is.
  for (const t of finds) if (t.sort === 'in' && room() > 0) add(await seedOf(t, reach()), 'in', [t]);
  // The text is the search read's own (src/search.ts): the words in any form in the title or note, or as typed anywhere
  // in the title, the best match first; only when that finds nothing, titles with a word close to what was typed.
  // How many it found in all is kept (`matched`), counted over what the viewer may see and the filter keeps; an item
  // two sets of words both find is counted once (issue e_z4sg2n8f).
  let matched: number | undefined;
  const asked: { said: string; near: boolean }[] = [];
  const matchedIds = new Set<string>();
  for (const said of hidden ? [] : finds.flatMap((t) => (t.sort === 'text' ? [t.said] : []))) {
    if (room() <= 0) break;
    const finding = async (near: boolean) => (await l.db.query<{ id: string; n: number }>(
      `select e.id, count(*) over ()::int as n from entity e where e.id in (${searchIds('$1', near)}) and ${narrowed(3)} order by ${rankSql('$1', 'e.')} desc, e.updated_at desc, e.id limit $2`,
      [said, reach(), ...leftOut, ...narrowing])).rows;
    let near = false;
    let rows = await finding(false);
    if (!rows.length) rows = await finding((near = true));
    const found = await holds(rows.map((r) => r.id));
    asked.push({ said, near });
    for (const id of found) matchedIds.add(id);
    matched = (matched ?? 0) + (checked ? found.length : (rows[0]?.n ?? 0));
    add(found, 'text', [{ sort: 'text', said }]);
  }
  if (asked.length > 1 && matched) {
    matched = checked
      ? matchedIds.size
      : (await l.db.query<{ n: number }>(
          `select count(*)::int as n from entity e where e.id in (select pelago_search_ids(v, s.near) from unnest($1::text[], $2::boolean[]) s(q, near) cross join lateral ${slipsOf('s.q', 's.near')} slips(v)) and ${narrowed(3)}`,
          [asked.map((a) => a.said), asked.map((a) => a.near), ...leftOut, ...narrowing])).rows[0].n;
  }
  for (const t of finds) if (t.sort === 'type' && room() > 0) add(await seedOf(t, reach()), 'type', [t]);

  // The walk: a step at a time along the links named, each the way it is named (out along it, in to it, or either), to
  // what the filter does not exclude. An excluded item is not walked through. Each step is bounded by the ids reached
  // the step before and what room is left.
  const along = (way: 'out' | 'in') => (lens.walk.over === 'all' ? null : l.registry.relationFamily(...lens.walk.over.map(wayOf).filter((t) => t.way !== (way === 'out' ? 'in' : 'out')).map((t) => t.link)));
  // Out from an item is along its links (it is their from); in is back along the links to it. Every link goes both.
  const ways = ([['from_id', 'to_id', along('out')], ['to_id', 'from_id', along('in')]] as const).filter(([, , types]) => types?.length !== 0);
  for (let level = [...sent], n = 0; level.length && n < lens.walk.steps && room() > 0 && ways.length; n++) {
    const typed = ways.flatMap(([, , types]) => (types ? [types] : []));
    const way = (k: string) => ways.map(([near, far, types], i) => `select e.id, e.updated_at from relation r join unnest($1::text[]) s(id) on s.id = r.${near} join entity e on e.id = r.${far} where r.valid_to is null${types ? ` and r.type = any($${4 + ways.slice(0, i).filter(([, , t]) => t).length}::text[])` : ''} and e.id <> all($2::text[]) and ${k}`).join(' union ');
    level = await unless(await find((k) => `select id from (${way(k)}) w order by updated_at desc, id limit $3`, [level, [...sent], room(), ...typed]), notChecked);
    for (const id of level) if (!sent.has(id)) stepOf.set(id, n + 1);
    add(level);
  }

  const cut = sent.size > lens.limit;
  const kept = [...sent].slice(0, lens.limit);
  const { rows } = await l.db.query<Row>(`select id, kind, type, title, case when id = any($2::text[]) then body else left(body, ${NOTE_START + 1}) end as body, visibility, status, is_open, owner, ${l.props}, created_at, updated_at from entity where id = any($1::text[])`, [kept, whole ? kept.slice(0, NOTES_WHOLE_MOST) : []]);
  const wholeIds = new Set(whole ? kept.slice(0, NOTES_WHOLE_MOST) : []);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = kept.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  // On a time axis, where each falls in its window.
  const spans = lens.time && (await placeAll(l, items, lens.time, zone!));
  // And whose lane each is in and what it counts toward (src/timelanes.ts): a person's, or each session its own.
  const filed = spans && (await fileOnAxis(l, items, spans, me));
  // The links among what is sent, of every type: a canvas draws what ties what it shows.
  const { rows: relations } = await l.db.query<{ id: string; type: string; from_id: string; to_id: string; props: Record<string, unknown> }>(
    `with s(id) as (select unnest($1::text[])) select r.id, r.type, r.from_id, r.to_id, r.props from relation r join s a on a.id = r.from_id join s b on b.id = r.to_id where r.valid_to is null order by r.id`,
    [items.map((e) => e.id)],
  );
  // An end said by name goes back in the lens as its id.
  lens.find = finds.map(sayTerm);
  lens.only = onlys.map(sayTerm);
  lens.not = nots.map(sayTerm);
  return {
    lens,
    items: items.map((e) => {
      const defs = l.registry.type(e.type)?.fields ?? {};
      const fields = Object.fromEntries(Object.entries(e.props ?? {}).filter(([key, value]) => defs[key]?.shown && value != null));
      return {
        id: e.id, kind: e.kind, type: e.type, title: e.title,
        // The start of the note, for a hover: the whole of it is on the item's page (or here, asked for whole).
        ...(e.body && { body: e.body.length > NOTE_START && !wholeIds.has(e.id) ? `${e.body.slice(0, NOTE_START)}…` : e.body }),
        visibility: e.visibility, status: e.status, open: e.is_open, owner: e.owner,
        created_at: e.created_at, updated_at: e.updated_at,
        ...(Object.keys(fields).length && { fields }),
        ...(spans && { time: filed!.filed.get(e.id) ?? spans.get(e.id) ?? [] }),
        ...(filed?.lane.has(e.id) && { lane: filed.lane.get(e.id) }),
        ...(filed?.stream.has(e.id) && { stream: filed.stream.get(e.id) }),
        ...(foundBy.has(e.id) ? { found: foundBy.get(e.id), terms: termsBy.get(e.id) } : stepOf.has(e.id) && { step: stepOf.get(e.id) }),
      };
    }),
    links: relations.map((r) => ({ id: r.id, type: r.type, from: r.from_id, to: r.to_id, ...(r.props && Object.keys(r.props).length && { props: r.props }) })),
    ...(filed && { lanes: filed.lanes, streams: filed.streams }),
    ...(cut && { cut: true }),
    ...(matched !== undefined && { matched }),
    // The items whose notes are sent whole, so a page keeping the answer current keeps those whole too (ui/replica.js).
    ...(whole && { whole: items.filter((e) => wholeIds.has(e.id)).map((e) => e.id) }),
  };
}
