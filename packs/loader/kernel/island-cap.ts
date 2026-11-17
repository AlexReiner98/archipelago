// How many items an island may hold (task e_qs4yd7gk; decision e_bgw2u5aw, the owner, 17 Nov 2026): the cap is the
// look's, since how big a graph reads well is a property of how it is drawn. An island takes the cap of its own look
// (a layout or part kept about it, packs/loader/kernel/island-look.ts), else the cap its look's preset ships; an island
// with no look of its own takes the cap of the map-shaped drawing every island is drawn with (canvas's Map ships 40),
// the owner's kept version of it first. A look built for big graphs says "none". The whole island counts, finished
// work included (e_2cf9ptkm). What becomes of a change past it is decide's alone (packs/rules/kernel/rules.ts, core's
// rule island_full): this only reads the fact, over_cap, for each op that adds to an island past its cap.

import { ISLAND } from './island-items.ts';
import { islandLooks } from './island-look.ts';
import { layoutsOf } from './layouts.ts';
import type { Registry } from './packs.ts';
import type { Q } from '../../database/kernel/db.ts';

/** An island's cap: a whole number, or null for none. */
export type Most = number | null;
/** Where an island stands against its cap, as the islands answer carries it. */
export interface Cap { count: number; most: Most }

/** A cap as a look or a drawing says it: undefined where it says neither a number nor "none". */
export const capOf = (v: unknown): Most | undefined => (v === 'none' ? null : typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);

type OpLike = { op: string; id?: string; ref?: string; type?: string; title?: string; props?: Record<string, unknown> };
type Found = { id: string; type: string; title: string; props: Record<string, unknown> };

/** The drawings the packs ship, with the cap each says. */
const shipped = (reg: Registry) => layoutsOf(reg.packs as Parameters<typeof layoutsOf>[0]) as { id: string; shape: string; cap?: unknown }[];

/** The cap of an island with no look of its own: the map-shaped drawing's, the owner's kept version of it first; none where no pack ships one. */
export async function mapCap(q: Q, reg: Registry): Promise<Most> {
  const map = shipped(reg).find((d) => d.shape === 'map');
  if (!map) return null;
  const kept = await q.query<{ props: Record<string, unknown> }>(
    `select props from entity where type = any($1::text[]) and props->>'preset' = $2 and archived_at is null and is_open order by updated_at desc limit 1 -- index entity_type`,
    [reg.family('layout'), map.id],
  );
  const own = capOf(kept.rows[0]?.props.cap);
  return own !== undefined ? own : (capOf(map.cap) ?? null);
}

/** The cap each of these islands is under, by island id. */
export async function islandCaps(q: Q, reg: Registry, islands: string[]): Promise<Map<string, Most>> {
  const caps = new Map<string, Most>();
  if (!islands.length) return caps;
  // The island's look, as islandLooks reads it (the one place that says how a look names its island): its cap, else its preset's.
  for (const [island, look] of await islandLooks({ db: q, registry: reg }, islands)) {
    const own = capOf(look.cap); // none (null) is a cap said, not one left unsaid
    const most = own !== undefined ? own : capOf(shipped(reg).find((d) => d.id === look.preset)?.cap);
    if (most !== undefined) caps.set(island, most);
  }
  const missing = islands.filter((id) => !caps.has(id));
  if (missing.length) {
    const most = await mapCap(q, reg);
    for (const id of missing) caps.set(id, most);
  }
  return caps;
}

/** How many items live on each of these islands now, archived ones aside. */
export async function islandCounts(q: Q, islands: string[]): Promise<Map<string, number>> {
  if (!islands.length) return new Map();
  const { rows } = await q.query<{ island: string; n: number }>(
    `select props->>'island' as island, count(*)::int as n from entity where props->>'island' = any($1::text[]) and archived_at is null group by 1 -- index entity_island`,
    [islands],
  );
  return new Map(rows.map((r) => [r.island, Number(r.n)]));
}

/** Each of these islands against its cap. */
export async function islandStands(q: Q, reg: Registry, islands: string[]): Promise<Map<string, Cap>> {
  const [counts, caps] = await Promise.all([islandCounts(q, islands), islandCaps(q, reg, islands)]);
  return new Map(islands.map((id) => [id, { count: counts.get(id) ?? 0, most: caps.get(id) ?? null }]));
}

/** An island as props.island names it: a ref in braces for one this change makes. */
const islandKey = (v: unknown) => (typeof v === 'string' && v ? v.replace(/^\{([^{}\s]+)\}$/, '$1') : undefined);

/**
 * For each op, whether the island it adds an item to would be past its cap once the whole change applies: said as a
 * phrase for the refusal ("Aperture business" would hold 179 items, past its cap of 40), undefined where it is not.
 * `found` is the items the ops name, as they are before the change. A move or an archive takes one from its island.
 */
export async function overCap(q: Q, reg: Registry, ops: OpLike[], found: Map<string, Found>): Promise<(string | undefined)[]> {
  const made = new Set(ops.flatMap((o) => (o.op === 'create' && o.ref && reg.isA(o.type ?? '', ISLAND) ? [o.ref] : [])));
  const moved = (o: OpLike, before?: Found) => o.op === 'update' && before !== undefined && o.props?.island !== undefined && islandKey(o.props.island) !== before.props.island;
  const adds = ops.map((o) => {
    const before = o.id ? found.get(o.id) : undefined;
    if (o.op === 'create' && !reg.isA(o.type ?? '', ISLAND)) return islandKey(o.props?.island);
    if (moved(o, before)) return islandKey(o.props!.island);
    if (o.op === 'restore' && before) return islandKey(before.props.island);
    return undefined;
  });
  const net = new Map<string, number>();
  for (const k of adds) if (k) net.set(k, (net.get(k) ?? 0) + 1);
  for (const o of ops) {
    const before = o.id ? found.get(o.id) : undefined;
    const k = before && (moved(o, before) || o.op === 'archive') ? islandKey(before.props.island) : undefined;
    if (k) net.set(k, (net.get(k) ?? 0) - 1);
  }
  const growing = [...net].filter(([, n]) => n > 0).map(([k]) => k);
  if (!growing.length) return ops.map(() => undefined);
  const there = growing.filter((k) => !made.has(k));
  const [stands, titles, fresh] = await Promise.all([
    islandStands(q, reg, there),
    q.query<{ id: string; title: string }>(`select id, title from entity where id = any($1::text[])`, [there]),
    made.size ? mapCap(q, reg) : null, // an island this change makes has no look yet: the map's cap
  ]);
  const titleOf = (k: string) => titles.rows.find((r) => r.id === k)?.title ?? String(ops.find((o) => o.ref === k)?.title ?? k);
  const past = new Map<string, string>();
  for (const k of growing) {
    const most = made.has(k) ? fresh : (stands.get(k)?.most ?? null);
    const after = (stands.get(k)?.count ?? 0) + net.get(k)!;
    if (most !== null && after > most) past.set(k, `"${titleOf(k)}" would hold ${after} items, past its cap of ${most}`);
  }
  return adds.map((k) => (k ? past.get(k) : undefined));
}
