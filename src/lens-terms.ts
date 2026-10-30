// The lens's one list of terms (feature "One list of terms, three verbs", the owner, 30 Oct 2026). A term is a set of
// items, written as words that read the same in the bar, the address and an agent's lens; the part it stands in says
// what is done with that set: Find adds it, Only keeps what is in it, Not takes it away.
//
//   text <words> · type <t> (or the type alone) · kind <k> · id <item> · in <item> · related <item> · <link> <item> ·
//   <link>< <item> (what the item links to) · owner me|<person> · and Only's words (src/lens-only.ts)
//
// An end is an id or a name. A word's set can only be checked of items in hand, so a word is no term of Find.

import type { Archipelago } from './pelago.ts';
import { readWord, type Narrowing, type Word } from './lens-only.ts';
import { searchIds } from './search.ts';
import { OWNED_BY } from './owner-link.ts';

export type Term =
  | { sort: 'text'; said: string }
  | { sort: 'type'; type: string }
  | { sort: 'kind'; kind: string }
  | { sort: 'id'; id: string }
  | { sort: 'in'; end: string }
  | { sort: 'related'; end: string }
  | { sort: 'link'; link: string; end: string; back: boolean; owner?: boolean }
  | { sort: 'word'; word: Word; said: string };

const KIND = /^kind\s+(.+)$/i;
const SAID = /^(text|type|id|in|related|owner)\s+(.+)$/i;
const LINK = /^(\S+?)(<?)\s+(.+)$/;

/** One term as written; a term that reads as nothing is refused, in the words of the part it stands in. */
export function readTerm(l: Archipelago, raw: unknown, part: string): Term {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`filter.${part}: a term is words, not ${JSON.stringify(raw)}`);
  const s = raw.trim().replace(/\s+/g, ' ');
  const kind = KIND.exec(s)?.[1];
  if (kind) return { sort: 'kind', kind };
  const [, head, rest] = SAID.exec(s) ?? [];
  if (head) {
    const said = head.toLowerCase();
    if (said === 'text') return { sort: 'text', said: rest };
    if (said === 'id') return { sort: 'id', id: rest };
    if (said === 'in') return { sort: 'in', end: rest };
    if (said === 'related') return { sort: 'related', end: rest };
    if (said === 'owner') return { sort: 'link', link: OWNED_BY, end: rest, back: false, owner: true };
    if (!l.registry.types.has(l.registry.canonical(rest))) throw new Error(`filter.${part}: unknown type "${rest}"`);
    return { sort: 'type', type: rest };
  }
  const word = readWord(s);
  if (word) return { sort: 'word', word, said: s };
  const [, link, back, end] = LINK.exec(s) ?? [];
  if (link && l.registry.relations.has(l.registry.canonical(link))) return { sort: 'link', link, end, back: back === '<' };
  if (l.registry.types.has(l.registry.canonical(s))) return { sort: 'type', type: s };
  throw new Error(`filter.${part}: "${s}" is no term: text <words>, a type, kind <k>, id <item>, in <item>, related <item>, <link type> <item>, owner <person>, or one of Only's words (done, blocked, status <s>, no owner, over estimate, changed since <7d|date>, made since <7d|date>, by owner, by agent)`);
}

/** A term as words again, its end now the id it was found to be. */
export function sayTerm(t: Term): string {
  if (t.sort === 'text') return `text ${t.said}`;
  if (t.sort === 'type') return `type ${t.type}`;
  if (t.sort === 'kind') return `kind ${t.kind}`;
  if (t.sort === 'id') return `id ${t.id}`;
  if (t.sort === 'in') return `in ${t.end}`;
  if (t.sort === 'related') return `related ${t.end}`;
  if (t.sort === 'word') return t.said;
  return t.owner ? `owner ${t.end}` : `${t.link}${t.back ? '<' : ''} ${t.end}`;
}

/** The items an end names, as the viewer may see them: me, an id, or the one so titled (any case) of the types it may be. Nothing is guessed (decision e_45sgrfqd): a name two share is refused. */
export async function endsOf(l: Archipelago, t: Extract<Term, { end: string }>, me: string | null): Promise<string[]> {
  if (t.end === 'me') return me ? [me] : [];
  if ((await l.db.query('select id from entity where id = $1 and archived_at is null', [t.end])).rows.length) return [t.end];
  if (/^e_[a-z0-9]{8}$/.test(t.end)) return [];
  const def = t.sort === 'link' ? l.registry.relations.get(l.registry.canonical(t.link))! : null;
  const takes = def ? (t.sort === 'link' && t.back ? def.from : def.to) : ['*'];
  const types = takes.includes('*') ? null : takes.flatMap((x) => l.registry.family(x));
  const { rows } = await l.db.query<{ id: string; type: string }>(`select id, type from entity where lower(title) = lower($1) and archived_at is null${types ? ' and type = any($3::text[])' : ''} order by updated_at desc, id limit $2`, [t.end, 5, ...(types ? [types] : [])]);
  if (rows.length > 1) throw new Error(`filter: "${sayTerm(t)}": ${rows.length > 4 ? 'many items are' : `${rows.length} items are`} named "${t.end}" (${rows.map((r) => `${r.id}, a ${r.type}`).join('; ')}): name the one meant by its id`);
  if (rows[0]) t.end = rows[0].id;
  return rows.map((r) => r.id);
}

/** A term's set as a condition on an item (as e), for Only and Not. An end nobody can see leaves the set empty. */
export async function setOf(l: Archipelago, t: Exclude<Term, { sort: 'word' }>, me: string | null): Promise<Narrowing> {
  if (t.sort === 'text') return { cond: `e.id in (${searchIds('$?', false)})`, param: t.said };
  if (t.sort === 'type') return { cond: 'e.type = any($?::text[])', param: l.registry.family(t.type) };
  if (t.sort === 'kind') return { cond: 'e.kind = $?', param: t.kind };
  if (t.sort === 'id') return { cond: 'e.id = $?', param: t.id };
  const at = await endsOf(l, t, me);
  if (t.sort === 'in') return { cond: 'exists (select 1 from part_closure c where c.descendant = e.id and c.ancestor = any($?::text[]))', param: at };
  if (t.sort === 'related') return { cond: 'exists (select 1 from relation r where r.valid_to is null and ((r.from_id = e.id and r.to_id = any($?::text[])) or (r.to_id = e.id and r.from_id = any($?::text[]))))', param: at };
  const [near, far] = t.back ? ['to_id', 'from_id'] : ['from_id', 'to_id'];
  const types = l.registry.relationFamily(t.link).map((x) => `'${x}'`).join(',');
  return { cond: `exists (select 1 from relation r where r.${near} = e.id and r.${far} = any($?::text[]) and r.type in (${types}) and r.valid_to is null)`, param: at };
}
