// The clock: the kernel's one duty in time (decision e_esqevwkf, the owner, 11 Nov 2026), the clocks pack's. Once a
// minute it finds what came due since its last pass: each occurrence of an item whose type says when it happens (the
// when capability: a moment, a span's start, or a repeat's hour on each day it falls on, in the workspace's zone). For
// each it records an item.due event and tells the packs that hear item.due (root.due, the loader's), which do whatever
// is to be done: the clock decides nothing and names no pack. Its cursor is kept in the workspace's settings (the read
// `clock`), so a pass after a restart catches up on what came due while it was down, a day at most; the first pass ever
// starts from now. An automation that watches a query comes due when it starts to match instead, by the same fact: the
// automation_triggers pack answers what its edges met (act.report.due_on). A hearer is told the event's seq, and in its
// detail the item's version (its last position in the fact stream) and the packs it came due under (the read
// `due_of`), so what it does can name what it answered. It runs every minute in each workspace while this server leads
// (the pack's timer, tick), and a pass that fails is told to the owner (the alerts pack, act.report.alert).

import type { KernelContext } from '#pelago/kernel';
import { DEFAULT_ZONE, startsOf, type Timed, type When } from './when.ts';

/** The furthest back a pass looks: what came due while the server was down longer than this is let go. */
const CATCH_UP_MS = 24 * 3_600_000;
/** How often the clock passes. */
export const EVERY_MS = 60_000;

export interface Due {
  item: string;
  type: string;
  title: string;
  /** The instant the occurrence begins. */
  at: string;
  /** Come due by a query starting to match (act.report.due_on): the edge met, the items that met it, and the value. */
  edge?: string;
  matched?: string[];
  value?: unknown;
}

type Item = Timed & { title: string };
type Told = { target: string; reason: string; detail: Record<string, unknown> };

/** The day an instant falls on in a zone, as a date. */
const dayIn = (at: number, zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** The occurrences of these items that begin after `from` and at or before `to`, in a zone, earliest first. */
export function dueBetween(ctx: Pick<KernelContext, 'registry'>, items: Item[], from: number, to: number, zone: string): Due[] {
  // From the start of the day `from` falls on: a repeat is laid out a whole day at a time.
  // To a moment past `to`: what begins at `to` itself is due.
  const out: Due[] = [];
  for (const e of items) {
    const when = ctx.registry.type(e.type)?.capabilities.when as When | undefined;
    if (!when) continue;
    for (const at of startsOf(when, e, dayIn(from, zone), to + 1, zone))
      if (at > from && at <= to) out.push({ item: e.id, type: e.type, title: e.title, at: new Date(at).toISOString() });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** The types whose items happen at a time. */
const timedTypes = (ctx: KernelContext) => [...ctx.registry.types.values()].filter((t) => t.capabilities.when).map((t) => t.id);

/** One pass: what came due since the last, each recorded and told to the packs that hear it. Answers what came due. */
export async function duePass(ctx: KernelContext, now = Date.now()): Promise<Due[]> {
  const { last, zone } = (await ctx.reads({ clock: { now } })) as { last?: number; zone: string | null };
  const tell = async (e: Told) => {
    // The item's version and the packs it came due under: those its island runs, the map's elsewhere.
    const { version, packs } = (await ctx.reads({ due_of: e.target })) as { version: number | null; packs: unknown[] };
    await ctx.call('root.due', { ...e, detail: { ...e.detail, version, packs } });
  };
  const types = timedTypes(ctx);
  const due: Due[] = [];
  if (last !== undefined && types.length && now > last) {
    const rows = (await ctx.reads({ timed: types })) as Item[];
    due.push(...dueBetween(ctx, rows, Math.max(last, now - CATCH_UP_MS), now, zone || DEFAULT_ZONE));
    for (const d of due) await tell({ target: d.item, reason: `"${d.title}" is due`, detail: { type: d.type, at: d.at } });
  }
  // What watches a query comes due when it starts to match: asked on every pass, the first included.
  const met = await ctx.call<{ now: number }, { met: Due; told: Told }[]>('act.report.due_on', { now });
  for (const m of met) await tell(m.told);
  return [...due, ...met.map((m) => m.met)];
}

/** The clocks pack's timer: one pass, and a pass that fails told to the workspace's owner (act.report.alert). */
export async function tick(ctx: KernelContext): Promise<void> {
  try {
    await duePass(ctx);
  } catch (err) {
    const body = `A pass over what came due failed: ${(err as Error).message}`;
    await ctx.call('act.report.alert', { key: 'clock', title: 'The clock failed', body, from: 'pelago' }).catch((e: Error) => ctx.said(`telling the owner the clock failed did not work: ${e.message}`));
  }
}
