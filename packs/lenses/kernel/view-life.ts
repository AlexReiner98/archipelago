// Views and layouts have a life (task e_gkv58kqb): working (an agent's, about its task), kept (only on the owner's
// word) and retired. Before it, both were current or retired. A migration, run when a workspace opens, after the
// layouts have moved (packs/styles, layout-move.ts), sorts each one still current once, as the owner agreed (7 Nov
// 2026): a pinned view is kept, one about an item already closed is retired, any other view is working; a layout is
// kept, since its code ran only once the owner let it. One change set the system appends (ctx.move), so the log keeps
// what each was. What it reads is the reads API's (marked, links, ids), as the map that opens.

import type { KernelContext } from '#pelago/kernel';

/** A fact of the log (src/log.ts, Fact): a field set, or taken off. */
export type Fact = ['+', string, string, unknown] | ['-', string, string];

/** The status a view or layout had before its life. */
const BEFORE = 'current';

export interface Before {
  id: string;
  /** A view (true) or a layout. */
  view: boolean;
  pinned: boolean;
  /** Whether what it is about is all closed: true only when it is about something, and none of that is open. */
  ended: boolean;
}

type Marked = { id: string; type: string; props: Record<string, unknown> };
type Item = { id: string; is_open: boolean; archived_at: unknown };

/** The status each takes: pure. */
export const lifeOf = (b: Before): 'working' | 'kept' | 'retired' => (!b.view || b.pinned ? 'kept' : b.ended ? 'retired' : 'working');

/** The facts that sort them: pure. */
export const livesMoved = (rows: Before[]): Fact[] => rows.map((r): Fact => ['+', r.id, 'status', lifeOf(r)]);

/** Whether a field read as the database casts text to a boolean says yes (coalesce((props ->> 'pinned')::boolean, false)). */
const yes = (v: unknown) => v != null && ['true', 't', 'yes', 'y', 'on', '1'].includes(String(v).trim().toLowerCase());

/** The migration: returns how many took each status. */
export async function moveLives(ctx: KernelContext): Promise<Record<string, number>> {
  if (!ctx.registry.types.has('lens') || !ctx.registry.types.has('layout')) return {};
  const views = ctx.registry.family('lens');
  const rows = (await ctx.reads({ marked: { types: [...views, ...ctx.registry.family('layout')], status: BEFORE, archived: true } })) as Marked[];
  if (!rows.length) return {};
  const about = (await ctx.reads({ links: { from: rows.map((r) => r.id), types: ['about'] } })) as { from_id: string; to_id: string }[];
  const ends = about.length ? ((await ctx.reads({ ids: [...new Set(about.map((a) => a.to_id))] })) as Item[]) : [];
  const open = new Map(ends.map((e) => [e.id, e.is_open && e.archived_at == null]));
  const before = rows.map((r): Before => {
    const of = about.filter((a) => a.from_id === r.id && open.has(a.to_id));
    return { id: r.id, view: views.includes(r.type), pinned: yes(r.props.pinned), ended: of.length > 0 && of.every((a) => !open.get(a.to_id)) };
  });
  await ctx.move('lens.lived', 'Views and layouts have a life: each current one sorted once, as the owner agreed (pinned or a layout kept, about a closed item retired, the rest working)', livesMoved(before));
  const counts: Record<string, number> = {};
  for (const b of before) counts[lifeOf(b)] = (counts[lifeOf(b)] ?? 0) + 1;
  return counts;
}

/**
 * Pins go (task e_uqzth53z): the ids a view held by hand are terms of its filter now (id ...), so it draws what it
 * drew, and pinned, which its life has read (kept), is taken off. Pure: a view's props in, its facts out.
 */
export function pinsMoved(id: string, props: Record<string, unknown>): Fact[] {
  const facts: Fact[] = [];
  const pins = Array.isArray(props.pins) ? props.pins.filter((p): p is string => typeof p === 'string' && p !== '') : [];
  if (pins.length) {
    const filter = (props.filter && typeof props.filter === 'object' ? props.filter : {}) as { find?: string[] };
    const find = [...(filter.find ?? [])];
    for (const pin of pins) if (!find.includes(`id ${pin}`)) find.push(`id ${pin}`);
    facts.push(['+', id, 'filter', { ...filter, find }]);
  }
  for (const field of ['pins', 'pinned']) if (field in props) facts.push(['-', id, field]);
  return facts;
}

/** The migration, after the lives are sorted (it reads pinned): returns the views it moved. */
export async function movePins(ctx: KernelContext): Promise<string[]> {
  if (!ctx.registry.types.has('lens')) return [];
  const rows = (await ctx.reads({ marked: { types: ctx.registry.family('lens'), keys: ['pins', 'pinned'], archived: true } })) as Marked[];
  const facts = rows.flatMap((r) => pinsMoved(r.id, r.props));
  if (!facts.length) return [];
  await ctx.move('lens.moved', 'Pins go: the ids a view held by hand are id terms of its filter, and pinned is its life now (kept)', facts);
  return rows.map((r) => r.id);
}
