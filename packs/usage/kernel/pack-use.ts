// How much each thing a pack declares is used on this map, for the Packs screen: the items of each type and the links
// of each link type standing now (with how many were made in the last 30 days), and from the uses stream
// (src/uses.ts) the last 30 days of each view's reads, each instruction's sayings, and each rule's holds, refusals and
// asks. Every read is bounded: by the types named, by an index, or by the days and a limit of entries.

import { heldCounts } from '../../../src/pack-counts.ts';
import type { Counted, Touched } from './pack-touches.ts';
import type { Archipelago } from '../../../src/pelago.ts';
import { opEntries, type OpStream } from '../../../src/streams.ts';
import { USES, useKey, type UseKind } from './uses.ts';

/** How far back a use is counted. */
export const USE_DAYS = 30;
/** The most entries of the uses stream read: a minute's counts are one entry, so this is weeks of steady use. */
const USE_ENTRIES = 50_000;

const DAY_MS = 86_400_000;
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Each use key's count over the last USE_DAYS days: what the stream holds, and what is counted but not yet written. */
async function usesLately(l: Archipelago): Promise<Map<string, number>> {
  const from = dayOf(Date.now() - (USE_DAYS - 1) * DAY_MS), to = dayOf(Date.now());
  const out = new Map<string, number>();
  const add = (key: string, day: string, n: number) => day >= from && out.set(key, (out.get(key) ?? 0) + n);
  for (const e of await opEntries(l.db, USES as OpStream, { days: [from, to], limit: USE_ENTRIES }))
    for (const f of e.facts) if (f[0] === '+' && f[1].startsWith('key:')) add(f[1].slice('key:'.length), f[2], Number(f[3]) || 0);
  for (const r of heldCounts(l.workspace, USES)) add(r.key, r.day, r.n);
  return out;
}

/** The items of each type, and of the links of each link type, standing now and made in the last USE_DAYS days. */
async function standing(l: Archipelago, types: string[], links: string[]) {
  const since = new Date(Date.now() - USE_DAYS * DAY_MS).toISOString();
  const [items, ties] = await Promise.all([
    types.length ? l.db.query<{ type: string; n: number; lately: number }>(`select type, count(*)::int as n, count(*) filter (where created_at >= $2)::int as lately from entity where type = any($1::text[]) and archived_at is null group by type -- index entity_type_created`, [types, since]) : { rows: [] },
    links.length ? l.db.query<{ type: string; n: number; lately: number }>(`select type, count(*)::int as n, count(*) filter (where valid_from >= $2)::int as lately from relation where type = any($1::text[]) and valid_to is null group by type -- index relation_open_type`, [links, since]) : { rows: [] },
  ]);
  return { items: new Map(items.rows.map((r) => [r.type, r])), links: new Map(ties.rows.map((r) => [r.type, r])) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type State = { touches: { key: string; n: number; items: Touched[] }[] };

/** The pack states given, each counted thing with how much it was used here (`used`, and `said` in words), and each group with how many are unused. */
export async function withUse<S extends State>(l: Archipelago, states: S[]): Promise<(Omit<S, 'touches'> & { use_days: number; touches: (S['touches'][number] & { unused: number })[] })[]> {
  const counted = states.flatMap((s) => s.touches.flatMap((g) => g.items.flatMap((t) => (t.counts ? [t.counts] : []))));
  const of = (by: Counted['by']) => [...new Set(counted.flatMap((c) => (c.by === by && 'type' in c ? [c.type] : [])))];
  const [{ items, links }, uses] = await Promise.all([standing(l, of('items'), of('links')), usesLately(l)]);
  const use = (kind: UseKind, id: string) => uses.get(useKey(kind, id.replace(/\s/g, '_'))) ?? 0;
  const measure = (c: Counted): { used: number; said: string } => {
    if (c.by === 'items' || c.by === 'links') {
      const r = (c.by === 'items' ? items : links).get(c.type);
      return { used: r?.n ?? 0, said: `${plural(r?.n ?? 0, c.by === 'items' ? 'item' : 'link')} here, ${r?.lately ?? 0} made in ${USE_DAYS} days` };
    }
    if (c.by === 'view') return { used: use('view', c.id), said: `read ${plural(use('view', c.id), 'time')} in ${USE_DAYS} days` };
    if (c.by === 'told') return { used: use('told', c.id), said: `said ${plural(use('told', c.id), 'time')} in ${USE_DAYS} days` };
    const id = (c as { id: string }).id;
    const [held, refused, asked] = (['held', 'refused', 'asked'] as const).map((k) => use(k, id));
    return { used: held + refused + asked, said: `${[held && `held ${plural(held, 'change')}`, refused && `refused ${plural(refused, 'change')}`, asked && `asked ${plural(asked, 'time')}`].filter(Boolean).join(', ') || 'never held, refused or asked'} in ${USE_DAYS} days` };
  };
  return states.map((s) => ({
    ...s,
    use_days: USE_DAYS,
    touches: s.touches.map((g) => {
      const its = g.items.map((t) => (t.counts ? { ...t, ...measure(t.counts) } : t));
      return { ...g, items: its, unused: its.filter((t) => t.used === 0).length };
    }),
  }));
}
