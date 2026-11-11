// The clock's other half (decision e_esqevwkf: "from items' when or a watched query"; the shape e_52e35bft): an
// automation whose `on` names a query comes due when that query starts to match, by its edge, not at a time. Each pass
// of the clock asks each enabled automation's query again, once the log has moved since it last asked, and writes the
// same item.due fact a time writes, its detail saying which edge and which items: the packs that hear item.due act on
// it as on a time. The kernel decides nothing beyond "this came due" and names no pack.
//
// What an edge has met is remembered, so a restart or a second pass does not fire it again: per automation, in the
// workspace's settings (src/operational.ts, setting), beside the clock's cursor, with the `on` it was met under. The
// first pass over an `on` only learns what already matches: a query starts to match after it is set, never before.

import { checkOn, edgeOf, type Edge, type On } from './automation-rules.ts';
import { flatRead } from './query-flat.ts';
import type { Archipelago, Entity } from './pelago.ts';
import { headPos } from './tail.ts';

/** Where the clock keeps what each automation's edge has met, by the automation's id. */
const MEMORY = 'due_on:';

/** What an edge has met, kept between passes. */
interface Memory {
  /** The `on` it was met under: another `on` starts again from what matches then. */
  on: string;
  /** The log's position when the query was last asked: until the log moves, nothing can start to match. */
  pos: number;
  /** first: whether it has fired (or matched when first asked). */
  done?: boolean;
  /** each: the items that have matched. first_per: the values met. crosses: the items at or over n. */
  seen?: (string | number | boolean)[];
}

/** One firing of a query's edge: the automation, the edge met and what met it. */
export interface Met {
  item: string;
  type: string;
  title: string;
  at: string;
  edge: string;
  matched: string[];
  value?: unknown;
}

/** The value of a field of an item: a field its type declares, else a column of its head (status, owner, title). */
const valueOf = (e: Entity, field: string): unknown => (field in (e.props ?? {}) ? e.props[field] : (e as unknown as Record<string, unknown>)[field]);
const key = (v: unknown): string | number | boolean => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v));

/**
 * What an edge meets, given the items its query matches now and what it remembered: the firings, and what to remember.
 * Without memory (the first pass over this `on`) it only learns what matches.
 */
export function meet(edge: Edge, now: Entity[], was: Memory | undefined, on: string, pos: number): { met: Omit<Met, 'item' | 'type' | 'title' | 'at'>[]; keep: Memory } {
  const met: Omit<Met, 'item' | 'type' | 'title' | 'at'>[] = [];
  const first = !was;
  const seen = new Set(was?.seen ?? []);
  switch (edge.kind) {
    case 'first': {
      const done = Boolean(was?.done) || (now.length > 0 && first);
      if (!done && now.length) met.push({ edge: 'first', matched: now.map((e) => e.id) });
      return { met, keep: { on, pos, done: done || now.length > 0 } };
    }
    case 'each': {
      for (const e of now) if (!seen.has(e.id) && !first) met.push({ edge: 'each', matched: [e.id] });
      // What left the query may match again later, and then it starts to match again.
      return { met, keep: { on, pos, seen: now.map((e) => e.id) } };
    }
    case 'first_per': {
      const values = new Map<string | number | boolean, string[]>();
      for (const e of now) {
        const v = valueOf(e, edge.field);
        if (v === undefined || v === null || v === '') continue;
        values.set(key(v), [...(values.get(key(v)) ?? []), e.id]);
      }
      for (const [v, ids] of values) if (!seen.has(v) && !first) met.push({ edge: `first_per:${edge.field}`, matched: ids, value: v });
      // A value once met stays met: one firing for each value, ever.
      return { met, keep: { on, pos, seen: [...new Set([...seen, ...values.keys()])] } };
    }
    case 'crosses': {
      const over: string[] = [];
      for (const e of now) {
        const v = Number(valueOf(e, edge.field));
        if (!Number.isFinite(v) || v < edge.n) continue;
        over.push(e.id);
        if (!seen.has(e.id) && !first) met.push({ edge: `crosses:${edge.n}`, matched: [e.id], value: v });
      }
      // An item back under n may cross it again: it is no longer remembered as over.
      return { met, keep: { on, pos, seen: over } };
    }
  }
}

/** One pass over the automations that watch a query: each edge met recorded as item.due, and told to the packs. */
export async function onPass(l: Archipelago, now: number, tell: (event: { action: string; target: string; reason: string; detail: Record<string, unknown> }) => Promise<void>): Promise<Met[]> {
  const types = l.registry.family('automation');
  if (!types.length) return [];
  const { rows: autos } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and status = 'enabled' and archived_at is null and props ? 'on' order by id limit 200 -- index entity_type`, [types]);
  if (!autos.length) return [];
  const pos = await headPos(l.db);
  const out: Met[] = [];
  for (const auto of autos) {
    const on = auto.props.on as On;
    if (checkOn(on).length) continue;
    const said = JSON.stringify(on);
    const memo = await l.setting<Memory>(MEMORY + auto.id);
    const was = memo?.on === said ? memo : undefined;
    if (was && was.pos === pos) continue;
    let ids: string[];
    try {
      ids = ((await flatRead(l, on.query as Record<string, unknown>)) as { items: { id: string }[] }).items.map((i) => i.id);
    } catch {
      continue; // a query that no longer reads (a type gone, an item named that is gone) meets nothing
    }
    const { rows: items } = ids.length ? await l.db.query<Entity>(`select * from entity where id = any($1::text[])`, [ids]) : { rows: [] as Entity[] };
    const order = new Map(ids.map((id, i) => [id, i]));
    items.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const { met, keep } = meet(edgeOf(on), items, was, said, pos);
    await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [MEMORY + auto.id, JSON.stringify(keep)]);
    for (const m of met) {
      const firing: Met = { item: auto.id, type: auto.type, title: auto.title, at: new Date(now).toISOString(), ...m };
      await tell({ action: 'item.due', target: auto.id, reason: `"${auto.title}" is due: its query ${m.edge === 'first' ? 'matched' : `met ${m.edge}`}`, detail: { type: auto.type, at: firing.at, on: { edge: m.edge, matched: m.matched, ...(m.value !== undefined && { value: m.value }) } } });
      out.push(firing);
    }
  }
  return out;
}
