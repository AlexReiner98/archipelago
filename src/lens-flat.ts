// The flat lens (the decision "The lens is a filter, a walk and a limit", 25 Oct 2026): a filter, a walk and a limit,
// and nothing else. What the filter includes picks the seeds; what it narrows by must all hold of every seed as well
// (only these types, within these items); what it excludes applies to everything but an item named by id, what the walk reaches included; the walk follows the link types named, each out, in or either way, step by step; the limit is the most it sends.
// The answer is items and the links among them: no containment, no places, no views, no style.
//
// Every read is bounded by the ids in hand, an end of a link, the type index or the limit, and runs as the viewer:
// row-level security keeps what they may not see out of the seeds, the walk and the links alike.

import { SYSTEM } from './head.ts';
import type { Archipelago } from './pelago.ts';
import { checkedAfter, holding, readWord, wordConditions, type Narrowing } from './lens-only.ts';
import { rankSql } from './search.ts';

/** One link term of a filter: the items that have a link of this type to `to` (or, with `from`, the items `from` links to). */
export interface LinkTerm {
  link: string;
  to?: string;
  from?: string;
}

/** Which term of the filter found an item: its words, a type, an id named, a link term. */
export type Found = 'text' | 'type' | 'id' | 'link' | 'in';

export interface FlatLens {
  /** What picks the seeds: any item any of these finds. */
  include: { text?: string[]; types?: string[]; ids?: string[]; links?: LinkTerm[]; in?: string[] };
  /** What must all hold of a seed as well: one of these types (flavours too), part of each of these items, however far down, and each of Only's words (src/lens-only.ts). */
  narrow: { only?: string[]; within?: string[]; words?: string[] };
  /** What is left out of everything: closed, system, or a type (its flavours too). */
  exclude: string[];
  /** The link types followed, each as named (`depends_on>` out, `depends_on<` in, `depends_on` either way), and how many steps. */
  walk: { over: string[] | 'all'; steps: number };
  /** The most items sent. */
  limit: number;
}

/** What is left out unless the lens says otherwise: the app's own configuration. */
const EXCLUDE_DEFAULT = [SYSTEM];
/** The most items one answer sends. */
export const LENS_LIMIT = 2000;
/** Items sent unless the lens says otherwise. */
const FLAT_LIMIT = 500;
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

/** A link term written as words ("tagged e_x", "tagged Urgent", "waits_on me", "part_of e_y") or as { link, to } or { link, from }; the end an id or a name. */
function readTerm(l: Archipelago, term: unknown): LinkTerm {
  const parsed = typeof term === 'string' ? ((([, link, to]) => ({ link, to }))(/^(\S+)\s+(.+)$/.exec(term.trim()) ?? []) as LinkTerm) : (term as LinkTerm);
  if (!parsed || typeof parsed.link !== 'string' || (typeof parsed.to === 'string') === (typeof parsed.from === 'string'))
    throw new Error(`include.links: a link term is "<link type> <id or name>", or { link, to } or { link, from }; not ${JSON.stringify(term)}`);
  if (!l.registry.relations.has(l.registry.canonical(parsed.link))) throw new Error(`include.links: unknown link type "${parsed.link}". Known: ${[...l.registry.relations.keys()].join(', ')}`);
  return parsed.to !== undefined ? { link: parsed.link, to: parsed.to } : { link: parsed.link, from: parsed.from };
}

/** The flat lens asked for, each field checked. A filter that includes nothing is refused: never the whole map. */
export function readFlat(l: Archipelago, input: Record<string, unknown>): FlatLens {
  const filter = (input.filter ?? {}) as Record<string, unknown>;
  if (typeof filter !== 'object' || Array.isArray(filter)) throw new Error('filter must be an object: { text, types, ids, links, in, only, within, exclude }');
  const include: FlatLens['include'] = {};
  // Words: one set, or several (each its own term, as Shift+Enter in the find bar adds one, e_e3k797d3).
  const words = [...new Set((Array.isArray(filter.text) ? filter.text : [filter.text]).filter((w) => w != null).map((w) => String(w).trim()).filter(Boolean))];
  if (words.length) include.text = words;
  if (filter.types !== undefined) include.types = names(filter.types, 'filter.types');
  if (filter.ids !== undefined) include.ids = names(filter.ids, 'filter.ids');
  if (filter.in !== undefined && (filter.in as unknown[]).length !== 0) include.in = names(filter.in, 'filter.in');
  if (filter.links !== undefined) {
    if (!Array.isArray(filter.links)) throw new Error('filter.links must be a list of link terms');
    include.links = filter.links.map((t) => readTerm(l, t));
  }
  for (const type of include.types ?? []) if (!l.registry.types.has(l.registry.canonical(type))) throw new Error(`filter.types: unknown type "${type}"`);
  const narrow: FlatLens['narrow'] = {};
  // Only takes types and plain words (decision e_xe5dx55e): a term that reads as a word is one, else it is a type.
  const onlyTerms = filter.only === undefined ? [] : names(filter.only, 'filter.only');
  const onlyWords = onlyTerms.filter((t) => readWord(t) !== undefined);
  const onlyTypes = onlyTerms.filter((t) => !onlyWords.includes(t));
  if (onlyTypes.length) narrow.only = onlyTypes;
  if (onlyWords.length) narrow.words = onlyWords;
  if (filter.within !== undefined && (filter.within as unknown[]).length !== 0) narrow.within = names(filter.within, 'filter.within');
  for (const type of narrow.only ?? []) if (!l.registry.types.has(l.registry.canonical(type))) throw new Error(`filter.only: unknown type "${type}": no type nor one of Only's words (done, blocked, status <s>, owner me|<person>, no owner, over estimate, changed since <7d|date>, made since <7d|date>, by owner, by agent)`);
  if (!include.text?.length && !include.types?.length && !include.ids?.length && !include.links?.length && !include.in?.length)
    throw new Error(narrow.only || narrow.within || narrow.words
      ? 'A lens includes something (filter: text, types, ids, links or in) for only and within to narrow: they narrow what the filter includes, and alone would read the whole map.'
      : 'A lens includes something (filter: text, types, ids, links or in): a filter that includes nothing would read the whole map.');
  const exclude = filter.exclude === undefined ? EXCLUDE_DEFAULT : names(filter.exclude, 'filter.exclude');
  for (const x of exclude) if (x !== 'closed' && x !== SYSTEM && !l.registry.types.has(l.registry.canonical(x))) throw new Error(`filter.exclude: "${x}" is not closed, system or a type`);
  const walkIn = (input.walk ?? {}) as Record<string, unknown>;
  const over = walkIn.over === undefined ? [] : walkIn.over === 'all' ? 'all' : names(walkIn.over, 'walk.over');
  if (over !== 'all') for (const { link } of over.map(wayOf)) if (!l.registry.relations.has(l.registry.canonical(link))) throw new Error(`walk.over: unknown link type "${link}" (a link type, with > to go out along it or < to come in)`);
  const steps = walkIn.steps ?? (over.length ? 1 : 0);
  if (!Number.isInteger(steps) || (steps as number) < 0 || (steps as number) > MAX_STEPS) throw new Error(`walk.steps must be a whole number from 0 to ${MAX_STEPS}`);
  const limit = input.limit ?? FLAT_LIMIT;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > LENS_LIMIT) throw new Error(`limit must be a whole number from 1 to ${LENS_LIMIT}`);
  return { include, narrow, exclude, walk: { over, steps: steps as number }, limit: limit as number };
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
  // What is excluded, as one condition on an item (as e); its last parameter is the types left out, with their flavours.
  const leftOut = lens.exclude.filter((x) => x !== 'closed' && x !== SYSTEM).flatMap((t) => l.registry.family(t));
  const keep = (n: number) => ['e.archived_at is null', lens.exclude.includes('closed') && 'e.is_open', lens.exclude.includes(SYSTEM) && `(e.kind is null or e.kind <> '${SYSTEM}')`, `e.type <> all($${n}::text[])`].filter(Boolean).join(' and ');
  // What a seed must also be, as conditions on it (as e) after what keep takes: one of the types it is narrowed to, and
  // part of each item it is narrowed within (the part_of closure, src/closure.ts). Within what the viewer cannot see,
  // nothing is: those items are read as the viewer first.
  const only = lens.narrow.only?.flatMap((t) => l.registry.family(t));
  const within = lens.narrow.within && (await l.db.query<{ id: string }>('select id from entity where id = any($1::text[]) and archived_at is null', [lens.narrow.within])).rows.map((r) => r.id);
  const hidden = within !== undefined && within.length < new Set(lens.narrow.within).size;
  const me = l.viewer || (await l.setting<string>('me')) || null;
  // Each narrowing term, numbered in order after what it follows: the types, within, then Only's words that are a
  // condition on the row. The words checked on what a read found (blocked, by owner, by agent) are not among them.
  const words = (lens.narrow.words ?? []).map((w) => readWord(w)!);
  const terms: Narrowing[] = [
    ...(only ? [{ cond: 'e.type = any($?::text[])', param: only }] : []),
    ...(within ? [{ cond: '(select count(*) from part_closure c where c.descendant = e.id and c.ancestor = any($?::text[])) = cardinality($?::text[])', param: within }] : []),
    ...(await wordConditions(l, words, me)),
  ];
  // An owner named by name is answered by its id, as a link's end is.
  if (lens.narrow.words) lens.narrow.words = lens.narrow.words.map((said, i) => (words[i].word === 'owner' ? `owner ${(words[i] as { who: string }).who}` : said));
  const narrowing = terms.filter((t) => t.param !== undefined).map((t) => t.param);
  const narrows = (n: number) => terms.map((t) => (t.param === undefined ? t.cond : t.cond.replaceAll('$?', `$${n++}`)));
  const narrowed = (n: number) => [keep(n), ...narrows(n + 1)].join(' and ');
  // Each read finds ids only; what is sent of them is read once, at the end. A seed is found narrowed; a step of the walk is not.
  const read = async (cond: string, sql: (keep: string) => string, own: unknown[], more: unknown[]) => (await l.db.query<{ id: string }>(sql(cond), [...own, leftOut, ...more])).rows.map((r) => r.id);
  const find = (sql: (keep: string) => string, own: unknown[]) => read(keep(own.length + 1), sql, own, []);
  const seed = (sql: (keep: string) => string, own: unknown[]) => (hidden ? Promise.resolve([]) : read(narrowed(own.length + 1), sql, own, narrowing));

  const sent = new Set<string>();
  const room = () => lens.limit + 1 - sent.size;
  // Why each item is there: the terms of the filter that found it (a seed may be found by more than one), or the step
  // of the walk that reached it. A person and an agent read the same reason (decision e_drt4g872: Find's terms).
  const foundBy = new Map<string, Found[]>();
  const stepOf = new Map<string, number>();
  const add = (ids: string[], by?: Found) => {
    for (const id of ids) {
      if (by && (sent.has(id) || room() > 0)) foundBy.set(id, [...new Set([...(foundBy.get(id) ?? []), by])]);
      if (room() > 0) sent.add(id);
    }
  };
  // Only's words checked on what a read found: then each read of seeds finds as many as one answer may send, for them
  // to keep what they hold of.
  const checked = checkedAfter(words);
  const reach = () => (checked ? LENS_LIMIT : room());
  const holds = async (found: string[]) => (checked ? holding(l, words, found) : found);
  // A term's end is an item's id, or else its name: the one item so titled (any case) of the types that end of the
  // link takes ("tagged Urgent" is the tag named Urgent), as the viewer may see it. Nothing is guessed (decision
  // e_45sgrfqd): a name two items share is refused, and the lens answered says the end by its id.
  const ends = async (term: LinkTerm, end: string) => {
    if ((await l.db.query('select 1 from entity where id = $1', [end])).rows.length) return [end];
    const def = l.registry.relations.get(term.link)!;
    const takes = term.to !== undefined ? def.to : def.from;
    const types = takes.includes('*') ? null : takes.flatMap((t) => l.registry.family(t));
    const { rows } = await l.db.query<{ id: string; type: string }>(`select id, type from entity where lower(title) = lower($1) and archived_at is null${types ? ' and type = any($3::text[])' : ''} order by updated_at desc, id limit $2`, [end, 5, ...(types ? [types] : [])]);
    if (rows.length > 1) throw new Error(`filter.links: "${term.link} ${end}": ${rows.length > 4 ? 'many items are' : `${rows.length} items are`} named "${end}" (${rows.map((r) => `${r.id}, a ${r.type}`).join('; ')}): name the one meant by its id`);
    if (rows[0]) term.to !== undefined ? (term.to = rows[0].id) : (term.from = rows[0].id);
    return rows.map((r) => r.id);
  };

  // The seeds, each narrowed: ids first, then what a link term finds, what is in an item, what the text finds, the
  // newest of each type named.
  const { ids, links, text, types } = lens.include;
  // An item named by id is always drawn: Not leaves out only what other terms find and what the walk reaches
  // (decision e_yasbwj45), and Only still narrows it.
  if (ids?.length && !hidden) add(await holds((await l.db.query<{ id: string }>(`select e.id from entity e where e.id = any($1::text[]) and ${['e.archived_at is null', ...narrows(2)].join(' and ')}`, [ids, ...narrowing])).rows.map((r) => r.id)), 'id');
  for (const term of links ?? []) {
    if (room() <= 0) break;
    const end = term.to ?? term.from!;
    const at = end === 'me' ? (me ? [me] : []) : await ends(term, end);
    if (!at.length) continue;
    const [near, far] = term.to !== undefined ? ['from_id', 'to_id'] : ['to_id', 'from_id'];
    add(await holds(await seed((k) => `select e.id from relation r join entity e on e.id = r.${near} where r.${far} = any($1::text[]) and r.type = any($2::text[]) and r.valid_to is null and ${k} order by e.updated_at desc, e.id limit $3`, [at, l.registry.relationFamily(term.link), reach()])), 'link');
  }
  // What is in an item, at any depth, read from the part_of closure (decision e_tvsdqjeq), the newest first; in an item
  // the viewer cannot see, nothing is.
  const inside = lens.include.in && (await l.db.query<{ id: string }>('select id from entity where id = any($1::text[]) and archived_at is null', [lens.include.in])).rows.map((r) => r.id);
  if (inside?.length && room() > 0) add(await holds(await seed((k) => `select e.id from part_closure c join entity e on e.id = c.descendant where c.ancestor = any($1::text[]) and ${k} order by e.updated_at desc, e.id limit $2`, [inside, reach()])), 'in');
  // The text is the search read's own (src/search.ts): the words in any form in the title or note, or as typed anywhere
  // in the title, the best match first; only when that finds nothing, titles with a word close to what was typed.
  // How many it found in all is kept (`matched`), counted over what the viewer may see and the filter keeps.
  let matched: number | undefined;
  for (const said of hidden ? [] : (text ?? [])) {
    if (room() <= 0) break;
    const finding = async (near: boolean) => (await l.db.query<{ id: string; n: number }>(
      `select e.id, count(*) over ()::int as n from entity e where e.id in (select pelago_search_ids($1, ${near})) and ${narrowed(3)} order by ${rankSql('$1', 'e.')} desc, e.updated_at desc, e.id limit $2`,
      [said, reach(), leftOut, ...narrowing])).rows;
    let rows = await finding(false);
    if (!rows.length) rows = await finding(true);
    const found = await holds(rows.map((r) => r.id));
    matched = (matched ?? 0) + (checked ? found.length : (rows[0]?.n ?? 0));
    add(found, 'text');
  }
  if (types?.length && room() > 0) add(await holds(await seed((k) => `select e.id from entity e where e.type = any($1::text[]) and ${k} order by e.created_at desc, e.id limit $2 -- index entity_type_created`, [types.flatMap((t) => l.registry.family(t)), reach()])), 'type');

  // The walk: a step at a time along the links named, each the way it is named (out along it, in to it, or either), to
  // what the filter does not exclude. An excluded item is not walked through. Each step is bounded by the ids reached
  // the step before and what room is left.
  const along = (way: 'out' | 'in') => (lens.walk.over === 'all' ? null : l.registry.relationFamily(...lens.walk.over.map(wayOf).filter((t) => t.way !== (way === 'out' ? 'in' : 'out')).map((t) => t.link)));
  // Out from an item is along its links (it is their from); in is back along the links to it. Every link goes both.
  const ways = ([['from_id', 'to_id', along('out')], ['to_id', 'from_id', along('in')]] as const).filter(([, , types]) => types?.length !== 0);
  for (let level = [...sent], n = 0; level.length && n < lens.walk.steps && room() > 0 && ways.length; n++) {
    const typed = ways.flatMap(([, , types]) => (types ? [types] : []));
    const way = (k: string) => ways.map(([near, far, types], i) => `select e.id, e.updated_at from relation r join unnest($1::text[]) s(id) on s.id = r.${near} join entity e on e.id = r.${far} where r.valid_to is null${types ? ` and r.type = any($${4 + ways.slice(0, i).filter(([, , t]) => t).length}::text[])` : ''} and e.id <> all($2::text[]) and ${k}`).join(' union ');
    level = await find((k) => `select id from (${way(k)}) w order by updated_at desc, id limit $3`, [level, [...sent], room(), ...typed]);
    for (const id of level) if (!sent.has(id)) stepOf.set(id, n + 1);
    add(level);
  }

  const cut = sent.size > lens.limit;
  const kept = [...sent].slice(0, lens.limit);
  const { rows } = await l.db.query<Row>(`select id, kind, type, title, case when id = any($2::text[]) then body else left(body, ${NOTE_START + 1}) end as body, visibility, status, is_open, owner, ${l.props}, created_at, updated_at from entity where id = any($1::text[])`, [kept, whole ? kept.slice(0, NOTES_WHOLE_MOST) : []]);
  const wholeIds = new Set(whole ? kept.slice(0, NOTES_WHOLE_MOST) : []);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = kept.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  // The links among what is sent, of every type: a canvas draws what ties what it shows.
  const { rows: relations } = await l.db.query<{ id: string; type: string; from_id: string; to_id: string; props: Record<string, unknown> }>(
    `with s(id) as (select unnest($1::text[])) select r.id, r.type, r.from_id, r.to_id, r.props from relation r join s a on a.id = r.from_id join s b on b.id = r.to_id where r.valid_to is null order by r.id`,
    [items.map((e) => e.id)],
  );
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
        ...(foundBy.has(e.id) ? { found: foundBy.get(e.id) } : stepOf.has(e.id) && { step: stepOf.get(e.id) }),
      };
    }),
    links: relations.map((r) => ({ id: r.id, type: r.type, from: r.from_id, to: r.to_id, ...(r.props && Object.keys(r.props).length && { props: r.props }) })),
    ...(cut && { cut: true }),
    ...(matched !== undefined && { matched }),
    // The items whose notes are sent whole, so a page keeping the answer current keeps those whole too (ui/replica.js).
    ...(whole && { whole: items.filter((e) => wholeIds.has(e.id)).map((e) => e.id) }),
  };
}
