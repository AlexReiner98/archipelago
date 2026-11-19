// The reads of misses this pack answers (surface's slot surface.reads): misses, every miss lately with where it
// happened and what covers it, for the tree's drawing; and missed_here, what a reply's end counts as missed in one run
// (the rule write_node asks on it). misses.ts decides; this reads.

import type { KernelContext } from '#pelago/kernel';
import { bumps, missesOf, refusals, traps, uncoveredSince, type Node, type Written } from './misses.ts';
import type { Beat } from './record.ts';

/** The rule that asks for a trial node, as its beats name it. */
export const WRITE_NODE = 'reflex_said.write_node';
/** How far back misses are read unless asked, and at most, in days. */
const DAYS = 30;
const DAYS_MOST = 90;
/** The most misses one read answers, the newest first. */
const MISSES_MOST = 1000;

type Item = { id: string; type?: string; title?: string; status?: string; is_open?: boolean; created_at?: string; props?: Record<string, unknown> };
type Link = { from_id?: string; from?: string; to_id?: string; to?: string };
type Kept = { id: string; title: string; is_open: boolean; props: Record<string, unknown>; about: string[] };

const listed = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** The nodes kept on the map, with what each answers: its misses' phrases and its answers links. */
async function nodesOf(ctx: KernelContext): Promise<Node[]> {
  const { kept } = (await ctx.reads({ told_from: {} })) as { kept: Kept[] };
  const links = kept.length ? ((await ctx.reads({ links: { from: kept.map((k) => k.id), types: ['answers'] } })) as Link[]) : [];
  return kept.map((k) => ({
    id: k.id,
    open: k.is_open,
    for: listed(k.props.for),
    misses: listed(k.props.misses),
    answers: links.filter((l) => (l.from_id ?? l.from) === k.id).map((l) => String(l.to_id ?? l.to)),
  }));
}

/** Items as bumps or traps, each with the run that first wrote it. */
async function written(ctx: KernelContext, items: Item[]): Promise<Written[]> {
  const by = items.length ? ((await ctx.reads({ writers: items.map((i) => i.id) })) as { item: string; run: string }[]) : [];
  return items.map((i) => {
    const run = by.find((w) => w.item === i.id)?.run;
    const fors = listed(i.props?.for);
    return { id: i.id, title: i.title ?? i.id, at: i.created_at ?? '', ...(run && { run }), ...(fors.length && { for: fors }) };
  });
}

/** Items of a type a pack may not have here: none, where no pack declares it. */
const itemsOf = async (ctx: KernelContext, type: string, where?: Record<string, unknown>) =>
  ctx.registry.type(type) ? ((await ctx.reads({ items: { type, ...(where && { where }) } })) as Item[]) : [];

/** `misses: { days? }`: every miss lately (refusals on runs' stories, bumps, traps), the newest first, each with where and what covers it. */
export async function misses(ctx: KernelContext, q: { misses: { days?: unknown } }) {
  const days = Math.min(DAYS_MOST, Math.max(1, Number(q.misses?.days ?? DAYS) || DAYS));
  const from = new Date(ctx.now().getTime() - days * 86_400_000).toISOString();
  const nodes = await nodesOf(ctx);
  const runs = (await ctx.reads({ items: { type: 'run', between: { field: 'last_seen', from } }, fields: ['story', 'last_seen'] })) as Item[];
  const stories = Object.fromEntries(runs.map((r) => [r.id, (Array.isArray(r.props?.story) ? r.props!.story : []) as Beat[]]));
  const recent = (i: Item) => (i.created_at ?? '') >= from;
  const issues = (await itemsOf(ctx, 'issue', { kind: 'problem' })).filter(recent);
  const kept = (await itemsOf(ctx, 'instruction')).filter((i) => recent(i) && listed(i.props?.for).some((f) => f.startsWith('file:')));
  const all = missesOf([refusals(stories, nodes).filter((m) => m.at >= from), bumps(await written(ctx, issues), nodes), traps(await written(ctx, kept), nodes)]);
  return all.slice(0, MISSES_MOST);
}

/** `missed_here: { run }`: how many refusals in the run no node covers came since the rule write_node last asked there. */
export async function missed_here(ctx: KernelContext, q: { missed_here: { run: unknown } }): Promise<number> {
  const run = q.missed_here?.run;
  if (typeof run !== 'string' || !run) throw new Error('missed_here names a run');
  const [item] = (await ctx.reads({ ids: [run] })) as Item[];
  const story = (Array.isArray(item?.props?.story) ? item!.props!.story : []) as Beat[];
  if (!story.some((b) => b.did === 'refused')) return 0;
  return uncoveredSince(run, story, WRITE_NODE, await nodesOf(ctx)).length;
}

/** answer.misses: every miss lately, for the view reflex_said.misses. */
export const missesAnswer = (ctx: KernelContext, input: { days?: unknown }) => misses(ctx, { misses: input ?? {} });
