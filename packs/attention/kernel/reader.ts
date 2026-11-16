// Where attention's reads come from. Weighing some items it was handed (among: the frontier's), everything it reads of
// them is read at once, in one statement (the read attention_state, packs/surface/kernel/packreads-frontier.ts), or
// handed in already read (state: the frontier reads it with its own); else each read is asked by itself. Both answer
// each read alike, so what is weighed is the same either way (test/frontier-once.test.ts).
import type { KernelContext } from '#pelago/kernel';
import type { Edge } from './blocks.ts';
import type { Settled } from './confirm.ts';
import { movedReadings, type Moved, type MovedRead } from './moved.ts';
import { byId, type Item, type Link } from './rows.ts';

type Crossed = { id: string; type: string; title: string; status: string; owner: string | null };
export type Bounds = { due: (Crossed & { due: string; overdue: boolean })[]; under: (Crossed & { value: number; limit: number })[] };
export type ConfirmRead = { count: number; on_agents_judgment: number; on_owners_word: number; upto: number; questions: Settled[] };
type Top = { id: string; top: string; title: string };

/** What attention_state answers: each read's answer, for the items it was asked of. */
export interface State {
  owner: string | null;
  /** The items asked of, as the read ids gives them, in its order. */
  rows: Item[];
  /** The others its parts name: whom a link waits on, what blocks, the sessions, what is read, what was settled. */
  named: Item[];
  waits: Link[];
  blocks: Edge[];
  holds: { resource: string; held_by_title: string }[];
  bounds: Bounds;
  works: Link[];
  moved?: MovedRead;
  confirm: ConfirmRead | null;
  tops: Top[];
}

export interface Reader {
  owner(): Promise<string | null>;
  /** The items asked of, live or not, in the order the read ids gives them; undefined when they are not known yet. */
  among?: Item[];
  byId(ids: string[]): Promise<Map<string, Item>>;
  waits(from: string[], types: string[]): Promise<Link[]>;
  blocks(ids: string[]): Promise<Edge[]>;
  holds(): Promise<{ resource: string; held_by_title: string }[]>;
  bounds(days: number, ids: string[]): Promise<Bounds>;
  works(to: string[]): Promise<Link[]>;
  moved(readers: string[]): Promise<Map<string, Moved[]>>;
  confirm(): Promise<ConfirmRead>;
  tops(ids: string[]): Promise<Top[]>;
}

/** Each read asked by itself. */
export const apart = (ctx: KernelContext): Reader => ({
  owner: async () => (await ctx.reads({ owner: true })) as string | null,
  byId: (ids) => byId(ctx, ids),
  waits: async (from, types) => (await ctx.reads({ links: { from, types } })) as Link[],
  blocks: async (ids) => (await ctx.reads({ blocks: ids })) as Edge[],
  holds: async () => (await ctx.reads({ holds: true })) as { resource: string; held_by_title: string }[],
  bounds: async (days, ids) => (await ctx.reads({ bounds: { ids, days } })) as Bounds,
  works: async (to) => (await ctx.reads({ links: { to, types: ['works_on'] } })) as Link[],
  moved: (readers) => movedReadings(ctx, readers),
  confirm: async () => (await ctx.reads({ confirm: { limit: 40 } })) as ConfirmRead,
  tops: async (ids) => (await ctx.reads({ tops: ids })) as Top[],
});

/** Every read answered from what was read at once. */
export function atOnce(ctx: KernelContext, s: State): Reader {
  const known = new Map([...s.named, ...s.rows].map((e) => [e.id, e]));
  const none = () => {
    throw new Error('attention: confirm was not read for these items');
  };
  return {
    owner: async () => s.owner,
    among: s.rows,
    byId: async (ids) => new Map(ids.flatMap((id) => (known.has(id) ? [[id, known.get(id)!] as const] : []))),
    waits: async () => s.waits,
    blocks: async () => s.blocks,
    holds: async () => s.holds,
    bounds: async () => s.bounds,
    works: async () => s.works,
    moved: (readers) => movedReadings(ctx, readers, { ...(s.moved ?? { reading: [], last: [], facts: [] }), read: known }),
    confirm: async () => s.confirm ?? none(),
    tops: async () => s.tops,
  };
}
