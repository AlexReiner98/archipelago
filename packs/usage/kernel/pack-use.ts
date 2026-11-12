// How much each thing a pack declares is used on this map, for the Packs screen: the items of each type and the links
// of each link type standing now (with how many were made in the last 30 days), and from the uses stream
// (uses.ts) the last 30 days of each view's reads, each instruction's sayings, and each rule's holds, refusals and
// asks. Every read is the context's, bounded: by the types named, or by the days and a limit of entries (the reads
// type_counts and uses_lately, packs/surface/kernel/packreads-service.ts); what is held in memory is root.uses.

import type { KernelContext } from '#pelago/kernel';
/** How a declaration's use is counted, as the loader reads it from a manifest (packs/loader/kernel/pack-touches.ts). */
type Counted = { by: 'items' | 'links'; type: string } | { by: 'ruling' | 'view' | 'told'; id: string };
/** One thing a pack declares, as the loader reads it: the fields this counts by and fills. */
interface Touched { counts?: Counted; used?: number; said?: string }

/** What the Packs screen asks of a pack's states (answer.pack_use): each with how much of what it touches is used here. */
export const packUse = async (ctx: KernelContext, input: { states: State[] }) => ({ states: await withUse(ctx, Array.isArray(input?.states) ? input.states : []) });
import { useKey, type UseKind } from './uses.ts';

/** How far back a use is counted. */
export const USE_DAYS = 30;

const DAY_MS = 86_400_000;
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
type OpFact = ['+', string, string, unknown] | ['-', string, string];

/** Each use key's count over the last USE_DAYS days: what the stream holds, and what is counted but not yet written (root.uses). */
async function usesLately(ctx: KernelContext): Promise<Map<string, number>> {
  const from = dayOf(Date.now() - (USE_DAYS - 1) * DAY_MS), to = dayOf(Date.now());
  const out = new Map<string, number>();
  const add = (key: string, day: string, n: number) => day >= from && out.set(key, (out.get(key) ?? 0) + n);
  const [written, held] = await Promise.all([
    ctx.reads({ uses_lately: { days: [from, to] } }) as Promise<{ facts: OpFact[] }[]>,
    ctx.call<unknown, { key: string; day: string; n: number }[]>('root.uses', { held: true }),
  ]);
  for (const e of written) for (const f of e.facts) if (f[0] === '+' && f[1].startsWith('key:')) add(f[1].slice('key:'.length), f[2], Number(f[3]) || 0);
  for (const r of held) add(r.key, r.day, r.n);
  return out;
}

type Standing = { type: string; n: number; lately: number };

/** The items of each type, and of the links of each link type, standing now and made in the last USE_DAYS days. */
async function standing(ctx: KernelContext, types: string[], links: string[]) {
  const since = new Date(Date.now() - USE_DAYS * DAY_MS).toISOString();
  const counted = (types.length || links.length ? await ctx.reads({ type_counts: { types, links, since } }) : { items: [], links: [] }) as { items: Standing[]; links: Standing[] };
  return { items: new Map(counted.items.map((r) => [r.type, r])), links: new Map(counted.links.map((r) => [r.type, r])) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type State = { touches: { key: string; n: number; items: Touched[] }[] };

/** The pack states given, each counted thing with how much it was used here (`used`, and `said` in words), and each group with how many are unused. */
export async function withUse<S extends State>(ctx: KernelContext, states: S[]): Promise<(Omit<S, 'touches'> & { use_days: number; touches: (S['touches'][number] & { unused: number })[] })[]> {
  const counted = states.flatMap((s) => s.touches.flatMap((g) => g.items.flatMap((t) => (t.counts ? [t.counts] : []))));
  const of = (by: Counted['by']) => [...new Set(counted.flatMap((c) => (c.by === by && 'type' in c ? [c.type] : [])))];
  const [{ items, links }, uses] = await Promise.all([standing(ctx, of('items'), of('links')), usesLately(ctx)]);
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
