// The flat lens (the decision "The lens is a filter, a walk and a limit", 25 Oct 2026): a filter, a walk and a limit,
// and nothing else. The filter is three lists of one kind of term (packs/query/kernel/query-terms.ts): Find's sets are added to pick the
// seeds, each of Only's must hold of every seed as well, and Not's are taken away from everything the walk reaches too.
// The walk follows the link types named, each out, in or either way, step by step; the limit is the most it sends.
// The answer is items and the links among them: no containment, no places, no views, no style. A lens may also name
// a window of time (`time`, packs/query/kernel/timeaxis.ts): it finds nothing more, and each item says where it falls in the window.
//
// Every read is bounded by the ids in hand, an end of a link, the type index or the limit, and runs as the viewer:
// row-level security keeps what they may not see out of the seeds, the walk and the links alike. The SQL is the reads
// API's (flat, packs/surface/kernel/packreads-flat.ts); what a pack answers of a term is asked here, by its name.

import type { KernelContext } from '#pelago/kernel';
import { atInstant, saysDay, type Word } from './query-only.ts';
import { found, readTerm, sayTerm, termsOf, type Found as FoundTerm, type Reasons, type Term, type Terms } from './query-terms.ts';
import { placeAll, readAxis, resolveAxis, windowOf, zoneOf, type Span, type TimeAxis } from './timeaxis.ts';
import { islandPack } from './island-legend.ts';

export { termsOf };

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

/** The kernel flag's kind: the app's own configuration. */
const SYSTEM = 'system';
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

/** A view kept in the words before the three lists, in them: what the migration writes (packs/lenses/kernel/query-saved.ts). */
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
export function readFlat(at: Terms, input: Record<string, unknown>): FlatLens {
  const reg = at.registry;
  const asked = (input.filter ?? {}) as Record<string, unknown>;
  if (typeof asked !== 'object' || Array.isArray(asked)) throw new Error('filter must be an object: { find, only, not }, each a list of terms');
  const filter = asked as { find?: unknown; only?: unknown; not?: unknown };
  const part = (name: 'find' | 'only' | 'not', value: unknown) => {
    if (value !== undefined && !Array.isArray(value)) throw new Error(`filter.${name} must be a list of terms`);
    // Words with nothing in them are no term: find sends what was typed.
    return [...new Set(((value ?? []) as unknown[]).filter((t) => !/^\s*text\s*$/i.test(String(t))).map((t) => sayTerm(readTerm(at, t, name))))];
  };
  const find = part('find', filter.find);
  const only = part('only', filter.only);
  const not = filter.not === undefined ? NOT_DEFAULT : part('not', filter.not);
  for (const t of find.map((x) => readTerm(at, x, 'find'))) if (t.sort === 'word' || t.sort === 'kind') throw new Error(`filter.find: "${sayTerm(t)}" can narrow what is found (only, not) but finds nothing itself: alone it would read the whole map`);
  if (!find.length && !input.preview)
    throw new Error(only.length
      ? 'A lens includes something (filter.find) for only to narrow: alone, it would read the whole map.'
      : 'A lens includes something (filter.find): a filter that includes nothing would read the whole map.');
  const walkIn = (input.walk ?? {}) as Record<string, unknown>;
  const over = walkIn.over === undefined ? [] : walkIn.over === 'all' ? 'all' : names(walkIn.over, 'walk.over');
  if (over !== 'all') for (const { link } of over.map(wayOf)) if (!reg.relations.has(reg.canonical(link))) throw new Error(`walk.over: unknown link type "${link}" (a link type, with > to go out along it or < to come in)`);
  const steps = walkIn.steps ?? (over.length ? 1 : 0);
  if (!Number.isInteger(steps) || (steps as number) < 0 || (steps as number) > MAX_STEPS) throw new Error(`walk.steps must be a whole number from 0 to ${MAX_STEPS}`);
  const limit = input.limit ?? FLAT_LIMIT;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > LENS_LIMIT) throw new Error(`limit must be a whole number from 1 to ${LENS_LIMIT}`);
  return { find, only, not, walk: { over, steps: steps as number }, limit: limit as number, ...(input.time !== undefined && { time: readAxis(input.time) }) };
}

/** Why a lens cannot be read, or nothing: read as the flat lens reads it, and nothing asked of the map. */
export function flatProblem(ctx: KernelContext, input: Record<string, unknown>): string | undefined {
  try {
    readFlat(termsOf(ctx), input);
  } catch (err) {
    return (err as Error).message;
  }
  return undefined;
}

interface Row {
  id: string; type: string; title: string; body: string;
  visibility: string; status: string; is_open: boolean; owner: string | null;
  props: Record<string, unknown>; created_at: Date; updated_at: Date;
}

/** What the reads API's flat read answers: the rows sent, the links among them, and why each is there. */
interface Seeded {
  items: Row[];
  links: { id: string; type: string; from_id: string; to_id: string; props: Record<string, unknown> }[];
  whole: string[];
  found: Record<string, Found[]>;
  terms: Record<string, string[]>;
  step: Record<string, number>;
  on_islands: boolean;
  islands: { id: string; title?: string; pack?: string | null }[];
  cut?: boolean;
  matched?: number;
}

type Filed = { filed: Record<string, Span[]>; lane: Record<string, string | null>; stream: Record<string, string | null>; lanes: unknown[]; streams: unknown[] };

/** A word term with its time as an instant, as the reads API reads it. */
const instants = (terms: FoundTerm[], zone: string | null): FoundTerm[] => terms.map((t) => (t.sort === 'word' ? { ...t, word: atInstant(t.word, zone) } : t));

const has = (o: Record<string, unknown> | undefined, id: string) => Boolean(o) && Object.hasOwn(o!, id);

/** The flat lens answered: the lens as read, the items (head and shown fields), the links among them, and whether the limit cut it. */
export async function flatRead(ctx: KernelContext, input: Record<string, unknown>) {
  const at = termsOf(ctx);
  const lens = readFlat(at, input);
  // How much of each note is sent is not the lens: the same items, their notes whole for a drawing that reads them.
  if (input.notes !== undefined && input.notes !== 'whole') throw new Error('notes must be "whole", or left out for the start of each note');
  const whole = input.notes === 'whole';
  // Asked by a page that keeps the answer current: where the log stood before anything was read, so the facts after it
  // that the page plays reach what this answer holds, and nothing said while it was read is missed (ui/live.js).
  if (input.follow !== undefined && input.follow !== true) throw new Error('follow must be true, or left out');
  const pos = input.follow ? ((await ctx.reads({ flat_pos: true } as never)) as number) : undefined;
  // On a time axis its ends said from today are worked out now, in the workspace's zone; a seed is open, or changed
  // since the window began (as the old placed read had it), so the sessions of past months do not crowd it out.
  const zone = lens.time ? await zoneOf(ctx) : null;
  if (lens.time) lens.time = resolveAxis(lens.time, zone!);
  const since = lens.time ? new Date(windowOf(lens.time, zone!)[0]).toISOString() : undefined;
  const me = ((await ctx.reads({ me: true })) as string | null) || null;
  const finds = lens.find.map((t) => readTerm(at, t, 'find'));
  const onlys = lens.only.map((t) => readTerm(at, t, 'only'));
  const nots = lens.not.map((t) => readTerm(at, t, 'not'));
  // What a term offered would change, asked before it is added: its terms read as the lens's are.
  const preview = input.preview as { part?: string; terms?: unknown; ids?: unknown } | undefined;
  if (preview) {
    if (preview.part !== 'find' && preview.part !== 'only' && preview.part !== 'not') throw new Error('preview.part must be find, only or not');
    if (!Array.isArray(preview.terms) || preview.terms.length > PREVIEW_TERMS) throw new Error(`preview.terms must be a list of at most ${PREVIEW_TERMS} terms`);
  }
  const offered = preview ? (preview.terms as unknown[]).map((raw) => ({ raw: String(raw), term: readTerm(at, raw, preview.part!) })) : [];
  // Each end found and each set a pack answers asked, once; the frontier's reasons are kept for what it finds.
  const read: { reasons?: Promise<Reasons> } = {};
  const all = await found(ctx, [...finds, ...onlys, ...nots, ...offered.map((x) => x.term)], me, read);
  const words = all.flatMap((t) => (t.sort === 'word' ? [t.word as Word] : []));
  const terms = instants(all, saysDay(words) ? (zone ?? (await zoneOf(ctx))) : null);
  const [f, o, n] = [finds.length, onlys.length, nots.length];
  const flat = {
    find: terms.slice(0, f), only: terms.slice(f, f + o), not: terms.slice(f + o, f + o + n),
    said_not: (input.filter as { not?: unknown } | undefined)?.not !== undefined,
    walk: lens.walk, limit: lens.limit, me,
    ...(since && { since }), ...(whole && { whole }),
    ...(preview && { preview: { part: preview.part, terms: offered.map((x, i) => ({ raw: x.raw, term: terms[f + o + n + i] })), ids: Array.isArray(preview.ids) ? preview.ids : [] } }),
  };
  if (preview) return (await ctx.reads({ flat } as never)) as never;
  const seeded = (await ctx.reads({ flat } as never)) as Seeded;
  const items = seeded.items;
  // On a time axis, where each falls in its window.
  const spans = lens.time && (await placeAll(ctx, items, lens.time, zone!));
  // And whose lane each is in and what it counts toward (the views pack's): a person's, or each session its own.
  const filed = spans && (await ctx.call<unknown, Filed>('answer.time_lanes', { items: items.map(({ id, type, title, owner }) => ({ id, type, title, owner })), spans: Object.fromEntries(spans), me }));
  // Each run sent says where its session stands (the runs pack's), read for all of them at once.
  const runs = items.filter((e) => ctx.registry.isA(e.type, 'run')).map((e) => e.id);
  const marks = runs.length ? (await ctx.call<unknown, { marks: Record<string, unknown> }>('answer.session_marks', { runs })).marks : {};
  // Where each lives, on a map with islands on, and each island's name, in the order they come: a drawing draws each
  // island's border from them (task e_auw7hb3v). Each island's legend names the pack it speaks and what is used there.
  const islandOf = (e: Row) => (seeded.on_islands && typeof e.props?.island === 'string' ? (e.props.island as string) : undefined);
  const onIsle = new Map(items.flatMap((e) => (islandOf(e) ? [[e.id, islandOf(e)!] as const] : [])));
  const usedOn = (isle: string) => ({
    types: items.filter((e) => onIsle.get(e.id) === isle).map((e) => e.type),
    links: seeded.links.filter((r) => onIsle.get(r.from_id) === isle && onIsle.get(r.to_id) === isle).map((r) => r.type),
  });
  const why = read.reasons && (await read.reasons);
  const wholeIds = new Set(seeded.whole);
  // An end said by name goes back in the lens as its id.
  lens.find = finds.map(sayTerm);
  lens.only = onlys.map(sayTerm);
  lens.not = nots.map(sayTerm);
  return {
    lens,
    // Who is looking (a person), so a drawing can say what waits on them.
    ...(me && { viewer: me }),
    items: items.map((e) => {
      const type = ctx.registry.type(e.type), defs = type?.fields ?? {};
      const fields = Object.fromEntries(Object.entries(e.props ?? {}).filter(([key, value]) => defs[key]?.shown && value != null));
      return {
        id: e.id, type: e.type,
        // What its type is a flavour of, nearest first (task: work), as a link says it: a drawing reads shapes and colours by it.
        ...(type && type.lineage.length > 1 && { is: type.lineage.slice(1) }),
        title: e.title,
        // The start of the note, for a hover: the whole of it is on the item's page (or here, asked for whole).
        ...(e.body && { body: e.body.length > NOTE_START && !wholeIds.has(e.id) ? `${e.body.slice(0, NOTE_START)}…` : e.body }),
        // Where it stands in its course, so every drawing reads one phase and keeps no registry.
        visibility: e.visibility, status: e.status, ...(type?.statuses.phases?.[e.status] && { phase: type.statuses.phases[e.status] }), open: e.is_open, owner: e.owner,
        ...(has(marks, e.id) && { session: marks[e.id] }),
        // Found by the frontier: why it needs attention now, the strongest first, each a word and its few words.
        ...(why?.has(e.id) && { reasons: why.get(e.id) }),
        created_at: e.created_at, updated_at: e.updated_at,
        ...(Object.keys(fields).length && { fields }),
        ...(islandOf(e) && { island: islandOf(e) }),
        ...(spans && { time: filed!.filed[e.id] ?? spans.get(e.id) ?? [] }),
        ...(filed && has(filed.lane, e.id) && { lane: filed.lane[e.id] }),
        ...(filed && has(filed.stream, e.id) && { stream: filed.stream[e.id] }),
        ...(has(seeded.found, e.id) ? { found: seeded.found[e.id], terms: seeded.terms[e.id] } : has(seeded.step, e.id) && { step: seeded.step[e.id] }),
      };
    }),
    // A link that extends another says what it is a flavour of (`is`, nearest first), so a drawing treats it as its root.
    links: seeded.links.map((r) => ({ id: r.id, type: r.type, ...(flavourOf(ctx.registry, r.type).length && { is: flavourOf(ctx.registry, r.type) }), from: r.from_id, to: r.to_id, ...(r.props && Object.keys(r.props).length && { props: r.props }) })),
    ...(seeded.islands.length && { islands: seeded.islands.map((r) => { const pack = r.pack ? islandPack(ctx.registry, r.pack, usedOn(r.id)) : undefined; return { id: r.id, ...(r.title !== undefined && { title: r.title }), ...(pack && { pack }) }; }) }),
    ...(filed && { lanes: filed.lanes, streams: filed.streams }),
    ...(seeded.cut && { cut: true }),
    ...(seeded.matched !== undefined && { matched: seeded.matched }),
    // The items whose notes are sent whole, so a page keeping the answer current keeps those whole too (ui/replica.js).
    ...(whole && { whole: seeded.whole }),
    ...(pos !== undefined && { pos }),
  };
}

/** What a link type is a flavour of, nearest first: [] for a root. */
const flavourOf = (registry: KernelContext['registry'], type: string): string[] => {
  const out: string[] = [];
  for (let r = registry.relations.get(type); r?.extends && !out.includes(r.extends); r = registry.relations.get(r.extends)) out.push(r.extends);
  return out;
};

