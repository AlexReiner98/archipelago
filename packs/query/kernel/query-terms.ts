// The lens's one list of terms (feature "One list of terms, three verbs", the owner, 30 Oct 2026). A term is a set of
// items, written as words that read the same in the bar, the address and an agent's lens; the part it stands in says
// what is done with that set: Find adds it, Only keeps what is in it, Not takes it away.
//
//   held (what changes held for me touch) · frontier (the open work recent sessions reach, the runs pack's) ·
//   worked <run> (what a session changed, touched or worked on) · moved (what reads a finding that moved since, the
//   attention pack's) · text <words> · type <t> (or the type alone) · kind <k> · id <item> · in <item> · related <item> ·
//   <link> <item> · island <island> (what lives on it) · <link>< <item> (what the item links to) · owner me|<person> ·
//   and Only's words (./query-only.ts)
//
// An end is an id or a name. A word's set can only be checked of items in hand, so a word is no term of Find.
//
// Any other word is a term a pack provides as the service term.<word>: asked with the rest of the term as its end and
// who is asking, it answers the ids of its set ({ ids }), as the viewer may see them. The query pack may call the whole
// family (kernel.families). What a term's set is on the map is read by the reads API (flat, flat_ends).

import type { KernelContext } from '#pelago/kernel';
import { readWord, type Word } from './query-only.ts';

type Registry = KernelContext['registry'];

export type Term =
  | { sort: 'text'; said: string }
  | { sort: 'type'; type: string }
  | { sort: 'kind'; kind: string }
  | { sort: 'id'; id: string }
  | { sort: 'in'; end: string }
  | { sort: 'related'; end: string }
  | { sort: 'island'; end: string }
  | { sort: 'held' }
  | { sort: 'moved' }
  | { sort: 'frontier' }
  | { sort: 'worked'; end: string }
  | { sort: 'link'; link: string; end: string; back: boolean; owner?: boolean }
  | { sort: 'word'; word: Word; said: string }
  | { sort: 'service'; word: string; end?: string };

/** What a term is read against: the registry, and the words packs provide as terms (ctx.provided('term')). */
export interface Terms { registry: Registry; served: ReadonlySet<string> }

/** The link that names an item's owner (core's owned_by). */
const OWNED_BY = 'owned_by';
/** The type an island is. */
const ISLAND = 'island';

const KIND = /^kind\s+(.+)$/i;
const SAID = /^(text|type|id|in|related|island|owner|worked)\s+(.+)$/i;
const LINK = /^(\S+?)(<?)\s+(.+)$/;
const SERVED = /^([a-z][a-z0-9_]*)(?:\s+(.+))?$/i;

/** What a term is read against, for this context: its registry and the term words provided here. */
export const termsOf = (ctx: KernelContext): Terms => ({ registry: ctx.registry, served: new Set(ctx.provided('term')) });

/** A term a pack provides, if the words are one: its word, and the rest as its end. */
function servedTerm(at: Terms, s: string): Term | undefined {
  const [, word, end] = SERVED.exec(s) ?? [];
  return word && at.served.has(word.toLowerCase()) ? { sort: 'service', word: word.toLowerCase(), ...(end !== undefined && { end }) } : undefined;
}

/** One term as written; a term that reads as nothing is refused, in the words of the part it stands in. */
export function readTerm(at: Terms, raw: unknown, part: string): Term {
  const reg = at.registry;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`filter.${part}: a term is words, not ${JSON.stringify(raw)}`);
  const s = raw.trim().replace(/\s+/g, ' ');
  if (/^held$/i.test(s)) return { sort: 'held' };
  if (/^moved$/i.test(s)) return { sort: 'moved' };
  if (/^frontier$/i.test(s)) return { sort: 'frontier' };
  const kind = KIND.exec(s)?.[1];
  if (kind) return { sort: 'kind', kind };
  const [, head, rest] = SAID.exec(s) ?? [];
  if (head) {
    const said = head.toLowerCase();
    if (said === 'text') return { sort: 'text', said: rest };
    if (said === 'id') return { sort: 'id', id: rest };
    if (said === 'in') return { sort: 'in', end: rest };
    if (said === 'related') return { sort: 'related', end: rest };
    if (said === 'island') return { sort: 'island', end: rest };
    if (said === 'worked') return { sort: 'worked', end: rest };
    if (said === 'owner') return { sort: 'link', link: OWNED_BY, end: rest, back: false, owner: true };
    if (!reg.types.has(reg.canonical(rest))) throw new Error(`filter.${part}: unknown type "${rest}"`);
    return { sort: 'type', type: rest };
  }
  const word = readWord(s);
  if (word) return { sort: 'word', word, said: s };
  const [, link, back, end] = LINK.exec(s) ?? [];
  if (link && reg.relations.has(reg.canonical(link))) return { sort: 'link', link, end, back: back === '<' };
  if (reg.types.has(reg.canonical(s))) return { sort: 'type', type: s };
  const served = servedTerm(at, s);
  if (served) return served;
  throw new Error(`filter.${part}: "${s}" is no term: held, moved, frontier, worked <session>, text <words>, a type, kind <k>, id <item>, in <item>, related <item>, island <island>, <link type> <item>, owner <person>, or one of Only's words (done, blocked, status <s>, no owner, over estimate, changed since|before <7d|date>, made since|before <7d|date>, by owner, by agent)`);
}

/** A term as words again, its end now the id it was found to be. */
export function sayTerm(t: Term): string {
  if (t.sort === 'text') return `text ${t.said}`;
  if (t.sort === 'type') return `type ${t.type}`;
  if (t.sort === 'kind') return `kind ${t.kind}`;
  if (t.sort === 'id') return `id ${t.id}`;
  if (t.sort === 'in') return `in ${t.end}`;
  if (t.sort === 'related') return `related ${t.end}`;
  if (t.sort === 'island') return `island ${t.end}`;
  if (t.sort === 'held') return 'held';
  if (t.sort === 'moved') return 'moved';
  if (t.sort === 'frontier') return 'frontier';
  if (t.sort === 'worked') return `worked ${t.end}`;
  if (t.sort === 'word') return t.said;
  if (t.sort === 'service') return t.end === undefined ? t.word : `${t.word} ${t.end}`;
  return t.owner ? `owner ${t.end}` : `${t.link}${t.back ? '<' : ''} ${t.end}`;
}

/** The most items the frontier term finds: as many as one canvas reads comfortably. */
export const FRONTIER_MOST = 60;

/** Each item's reasons the frontier finds, in their order, the strongest first; each with its few words. */
export type Reasons = Map<string, { why: string; said: string }[]>;

/**
 * The frontier of the whole workspace (the runs pack's answer.frontier, asked from no place: its recent sessions
 * wherever they ran), as each item's reasons in their order, the strongest first; each reason with its few words.
 */
export async function frontierOf(ctx: KernelContext): Promise<Reasons> {
  const f = await ctx.call<unknown, { items: { id: string; reasons: { why: string; said: string }[] }[] }>('answer.frontier', { limit: FRONTIER_MOST, said: true });
  return new Map(f.items.map((i) => [i.id, i.reasons.map((r) => ({ why: r.why, said: r.said }))]));
}

/**
 * The ids a provided term's set holds, as its provider answers them: ids alone, anything else refused. Asked as the map
 * that asks, so the provider reads as the viewer does, under their row-level security (bug e_8e5pd7dy).
 */
async function servedIds(ctx: KernelContext, t: Extract<Term, { sort: 'service' }>, me: string | null): Promise<string[]> {
  const out = await ctx.call<unknown, { ids?: unknown }>(`term.${t.word}`, { ...(t.end !== undefined && { end: t.end }), me });
  if (!Array.isArray(out?.ids) || out.ids.some((id) => typeof id !== 'string')) throw new Error(`filter: the term "${sayTerm(t)}" answered no ids: its provider answers { ids }`);
  return out.ids as string[];
}

/** What the sessions named changed, touched or were set to work on (the runs pack's answer.worked_on). */
export async function workedBy(ctx: KernelContext, runs: string[]): Promise<string[]> {
  return (await ctx.call<unknown, { ids: string[] }>('answer.worked_on', { runs })).ids;
}

/** A term as the reads API reads its set (flat): as the lens says it, the items its end names, its set where a pack answers it. */
export type Found = Term & { as: string; at?: string[]; ids?: string[] };

const hasEnd = (t: Term): t is Extract<Term, { end: string }> => 'end' in t && typeof t.end === 'string' && t.sort !== 'service';

/** The types an end may name: what the link takes at that end, an island, a session; any (null) for the rest. */
function takes(reg: Registry, t: Extract<Term, { end: string }>): string[] | null {
  const def = t.sort === 'link' ? reg.relations.get(reg.canonical(t.link))! : null;
  const types = def ? (t.sort === 'link' && t.back ? def.from : def.to) : t.sort === 'island' ? [ISLAND] : t.sort === 'worked' ? ['run'] : ['*'];
  return types.includes('*') ? null : types;
}

/**
 * The terms as the reads API reads them: each end found as the viewer may see it (me, an id, or the one so titled, any
 * case, of the types it may be: nothing is guessed, decision e_45sgrfqd, so a name two share is refused) and set as its
 * id, and each set a pack answers asked of it once.
 */
export async function found(ctx: KernelContext, terms: Term[], me: string | null, read: { reasons?: Promise<Reasons> } = {}): Promise<Found[]> {
  const ended = terms.filter(hasEnd).filter((t) => t.end !== 'me');
  const asked = ended.length ? ((await ctx.reads({ flat_ends: ended.map((t) => ({ end: t.end, types: takes(ctx.registry, t) })) })) as { ids?: string[]; named?: { id: string; type: string }[] }[]) : [];
  const at = new Map<Term, string[]>();
  ended.forEach((t, i) => {
    const one = asked[i];
    if (one.ids) return void at.set(t, one.ids);
    const rows = one.named ?? [];
    if (rows.length > 1) throw new Error(`filter: "${sayTerm(t)}": ${rows.length > 4 ? 'many items are' : `${rows.length} items are`} named "${t.end}" (${rows.map((r) => `${r.id}, a ${r.type}`).join('; ')}): name the one meant by its id`);
    if (rows[0]) t.end = rows[0].id;
    at.set(t, rows.map((r) => r.id));
  });
  for (const t of terms) if (hasEnd(t) && t.end === 'me') at.set(t, me ? [me] : []);
  let moved: Promise<string[]> | undefined;
  const out: Found[] = [];
  for (const t of terms) {
    const ends = at.get(t);
    let ids: string[] | undefined;
    if (t.sort === 'moved') ids = await (moved ??= ctx.call<unknown, { ids: string[] }>('answer.moved', {}).then((a) => a.ids));
    else if (t.sort === 'frontier') ids = [...(await (read.reasons ??= frontierOf(ctx))).keys()];
    else if (t.sort === 'service') ids = await servedIds(ctx, t, me);
    else if (t.sort === 'worked') ids = ends?.length ? await workedBy(ctx, ends) : [];
    out.push({ ...t, as: sayTerm(t), ...(ends && { at: ends }), ...(ids && { ids }) });
  }
  return out;
}
