// The clock: the kernel's one duty in time (decision e_esqevwkf, the owner, 11 Nov 2026). Once a minute it finds what
// came due since its last pass: each occurrence of an item whose type says when it happens (the when capability: a
// moment, a span's start, or a repeat's hour on each day it falls on, in the workspace's zone). For each it records an
// item.due event and tells the packs that hear item.due, which do whatever is to be done: the kernel decides nothing
// and names no pack. Its cursor is kept in the workspace's settings, so a pass after a restart catches up on what came
// due while it was down, a day at most; the first pass ever starts from now. An automation that watches a query
// comes due when it starts to match instead (src/due-on.ts), by the same fact. A hearer is told the event's seq, and in
// its detail the item's version (its last position in the fact stream), and the packs it came due under (src/pack-versions.ts), so what it does can name what it answered.

import { onPass } from './due-on.ts';
import { packVersions } from './pack-versions.ts';
import { hostFor } from './packtools.ts';
import type { Archipelago, Entity } from './pelago.ts';
import { spansOf, zoneOf } from './timeaxis.ts';

const CURSOR = 'due_cursor';
/** The furthest back a pass looks: what came due while the server was down longer than this is let go. */
const CATCH_UP_MS = 24 * 3_600_000;
const EVERY_MS = 60_000;

export interface Due {
  item: string;
  type: string;
  title: string;
  /** The instant the occurrence begins. */
  at: string;
  /** Come due by a query starting to match (src/due-on.ts): the edge met, the items that met it, and the value. */
  edge?: string;
  matched?: string[];
  value?: unknown;
}

/** The day an instant falls on in a zone, as a date. */
const dayIn = (at: number, zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** The occurrences of these items that begin after `from` and at or before `to`, in a zone, earliest first. */
export function dueBetween(l: Archipelago, items: Pick<Entity, 'id' | 'type' | 'title' | 'props' | 'created_at' | 'status' | 'is_open'>[], from: number, to: number, zone: string): Due[] {
  // From the start of the day `from` falls on: a repeat is laid out a whole day at a time.
  // To a moment past `to`: the axis keeps what begins before its end, and what begins at `to` itself is due.
  const axis = { from: dayIn(from, zone), to: new Date(to + 1).toISOString(), by: ['when' as const] };
  const out: Due[] = [];
  for (const e of items)
    for (const span of spansOf(l, e, axis, zone)) {
      const at = Date.parse(span.start);
      if (at > from && at <= to) out.push({ item: e.id, type: e.type, title: e.title, at: span.start });
    }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** The types whose items happen at a time. */
const timedTypes = (l: Archipelago) => [...l.registry.types.values()].filter((t) => t.capabilities.when).map((t) => t.id);

/** One pass: what came due since the last, each recorded and told to the packs that hear it. Answers what came due. */
export async function duePass(l: Archipelago, now = Date.now()): Promise<Due[]> {
  const last = await l.setting<number>(CURSOR);
  await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [CURSOR, JSON.stringify(now)]);
  const host = hostFor(l.registry);
  const tell = async (event: { action: string; target: string; reason: string; detail: Record<string, unknown> }) => {
    const version = (await versionsOf(l, [event.target])).get(event.target) ?? null;
    const told = { ...event, detail: { ...event.detail, version, packs: packVersions(l.registry) } };
    const seq = await l.log(l.db, { actor: 'agent:pelago', ...told });
    host.tell(l, 'kernel', { ...told, seq });
  };
  const types = timedTypes(l);
  const due: Due[] = [];
  if (last !== undefined && types.length && now > last) {
    const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and is_open and archived_at is null`, [types]);
    due.push(...dueBetween(l, rows, Math.max(last, now - CATCH_UP_MS), now, await zoneOf(l)));
    for (const d of due) await tell({ action: 'item.due', target: d.item, reason: `"${d.title}" is due`, detail: { type: d.type, at: d.at } });
  }
  // What watches a query comes due when it starts to match (src/due-on.ts): asked on every pass, the first included.
  return [...due, ...(await onPass(l, now, tell))];
}

/** Each item's version: the position of its last fact in the fact stream, what a hearer acted on. */
async function versionsOf(l: Archipelago, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const { rows } = await l.db.query<{ id: string; pos: number }>(`select id, max(pos)::int as pos from log_fact where stream = 'facts' and id = any($1::text[]) group by id -- index log_fact_history`, [ids]);
  return new Map(rows.map((r) => [r.id, r.pos]));
}

const clocks = new WeakMap<Archipelago, ReturnType<typeof setInterval>>();

/** Start the workspace's clock; the leader alone runs it (src/leader.ts). */
export function startClock(l: Archipelago, onError: (err: Error) => void): void {
  stopClock(l);
  clocks.set(l, setInterval(() => void duePass(l).catch(onError), EVERY_MS).unref());
}

export function stopClock(l: Archipelago): void {
  clearInterval(clocks.get(l));
  clocks.delete(l);
}
