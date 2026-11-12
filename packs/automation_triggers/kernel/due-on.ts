// The clock's other half (decision e_esqevwkf: "from items' when or a watched query"; the shape e_52e35bft): an
// automation whose `on` names a query comes due when that query starts to match, by its edge, not at a time. Each pass
// of the clock asks each enabled automation's query again, once the log has moved since it last asked, and hands the
// clock the same item.due a time makes, its detail saying which edge and which items: the packs that hear item.due act
// on it as on a time. This decides nothing beyond "this came due".
//
// What an edge has met is this pack's memory (the read `memory`), per automation by its id. The manifest declares its
// prefix, `due_on:` (kernel.memory), the one the clock kept it under before it moved here, so a map keeps what its
// edges met and no `first` edge fires again (decision e_a8dh8fg3, the owner, 12 Nov 2026).
//
// A map that has taken the automations pack out has nothing to act on what comes due: a pass there does nothing.

import type { KernelContext } from '#pelago/kernel';
import { checkOn, edgeOf, type On } from './automation-rules.ts';
import { meet, type Matched, type Memory, type Met } from './edges.ts';

/** The pack that does what an automation says once it is due: without it on a map, nothing here runs there. */
export const ACTS = 'automations';
/** The most automations one pass asks, as the clock asked before. */
const AUTOMATIONS = 200;
/** The most pages of enabled automations one pass reads, each of 500. */
const PAGES = 10;

/** Whether the automations pack is on in this map. */
export const acting = (ctx: Pick<KernelContext, 'registry'>): boolean => ctx.registry.packs.some((p) => p.id === ACTS);

type Item = Matched & { type: string; title: string; status?: string | null; props?: Record<string, unknown> | null };
type Tell = (event: { action: string; target: string; reason: string; detail: Record<string, unknown> }) => Promise<void>;

/** The enabled automations that watch a query, by id, at most AUTOMATIONS: read a page at a time, PAGES at most. */
async function watching(ctx: KernelContext): Promise<Item[]> {
  const out: Item[] = [];
  let after: string | undefined;
  for (let n = 0; n === 0 || (after && n < PAGES); n++) {
    const page = (await ctx.reads({ items: { type: 'automation', status: 'enabled' }, page: { size: 500, ...(after && { after }) } })) as { rows: Item[]; next?: string };
    out.push(...page.rows.filter((a) => a.props && 'on' in a.props));
    after = page.next;
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, AUTOMATIONS);
}

/** One pass over the automations that watch a query: each edge met told to the clock, which records it as item.due. */
export async function onPass(ctx: KernelContext, now: number, tell: Tell): Promise<Met[]> {
  if (!acting(ctx) || !ctx.registry.family('automation').length) return [];
  const autos = await watching(ctx);
  if (!autos.length) return [];
  const pos = (await ctx.reads({ log_head: true })) as number;
  const out: Met[] = [];
  for (const auto of autos) {
    const on = auto.props!.on as On;
    if (checkOn(on).length) continue;
    const said = JSON.stringify(on);
    const memo = (await ctx.reads({ memory: { key: auto.id } })) as Memory | null;
    const was = memo?.on === said ? memo : undefined;
    if (was && was.pos === pos) continue;
    let ids: string[];
    try {
      ids = ((await ctx.reads({ view: 'flat', params: on.query as Record<string, unknown> })) as { items: { id: string }[] }).items.map((i) => i.id);
    } catch {
      continue; // a query that no longer reads (a type gone, an item named that is gone) meets nothing
    }
    const items = ids.length ? ((await ctx.reads({ ids })) as Item[]) : [];
    const order = new Map(ids.map((id, i) => [id, i]));
    items.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const { met, keep } = meet(edgeOf(on), items, was, said, pos);
    await ctx.reads({ memory: { key: auto.id, value: keep } });
    for (const m of met) {
      const firing: Met = { item: auto.id, type: auto.type, title: auto.title, at: new Date(now).toISOString(), ...m };
      await tell({ action: 'item.due', target: auto.id, reason: `"${auto.title}" is due: its query ${m.edge === 'first' ? 'matched' : `met ${m.edge}`}`, detail: { type: auto.type, at: firing.at, on: { edge: m.edge, matched: m.matched, ...(m.value !== undefined && { value: m.value }) } } });
      out.push(firing);
    }
  }
  return out;
}
