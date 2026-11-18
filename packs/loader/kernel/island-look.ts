// An island's own look (feature e_6efhubbz, decision e_3c3wr7jv, the owner, 17 Nov 2026): a layout or a part kept on
// the map that draws the island (core's link draws, decision e_gwfwbx3t; its island item, or its focus) is how that island is drawn, in every view it is in. The
// look's code stays in that kept item, behind the walls every layout and part runs behind; the island itself holds no
// look, and an island pack none (packs/loader/kernel/islands.ts). The view frames it. Read for the islands an answer
// holds alone; where several draw one island, the one changed last draws it. Where nothing draws an island, a style
// kept on the map on its item's type (on) may name a look for every island of that type (its `look`, task e_wnpnunpp:
// a build feature is drawn as lanes without a link per island); of several, the one changed last.

import type { Registry } from './packs.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';

/** What reading looks needs: a query and the registry, as the map has them and as the rules' decide is handed them. */
type Reads = { db: Pick<Archipelago['db'], 'query'>; registry: Pick<Registry, 'family' | 'isA'> };

/** An island's own look, as an answer names it: the kept item that draws it, what it is (a layout or a part) and its name. */
export interface IslandLook { id: string; kind: 'layout' | 'part'; title: string; /** When it last changed: what a page keys the code it fetched by. */ at: string; /** Whether it has code to draw by: one with none (a cap alone) leaves its island drawn as any other. */ coded: boolean; /** What it says of how big an island it reads well at: a number, "none", or nothing said (island-cap's). */ cap?: unknown; /** The preset it is a version of, if any. */ preset?: string }

type Row = { id: string; type: string; title: string; at: string; coded: boolean; cap: unknown; preset: string | null };
const LOOK = `e.id, e.type, e.title, e.updated_at::text as at, coalesce(e.props->>'code', '') <> '' as coded, e.props->'cap' as cap, e.props->>'preset' as preset`;

/** The look that draws each of these islands, by island id: none for an island with none. */
export async function islandLooks(map: Reads, islands: string[]): Promise<Map<string, IslandLook>> {
  const looks = new Map<string, IslandLook>();
  if (!islands.length) return looks;
  const layouts = map.registry.family('layout'), parts = map.registry.family('part'), kinds = [...layouts, ...parts];
  const lookOf = (r: Row): IslandLook => ({ id: r.id, kind: layouts.includes(r.type) ? 'layout' : 'part', title: r.title, at: r.at, coded: r.coded, ...(r.cap != null && { cap: r.cap }), ...(r.preset && { preset: r.preset }) });
  const { rows } = await map.db.query<Row & { island: string }>(
    `select r.to_id as island, ${LOOK} from relation r join entity e on e.id = r.from_id
      where r.to_id = any($1::text[]) and r.type = 'draws' and r.valid_to is null
        and e.archived_at is null and e.is_open and e.type = any($2::text[])
      order by e.updated_at desc, e.id`,
    [islands, kinds],
  );
  for (const r of rows) if (!looks.has(r.island)) looks.set(r.island, lookOf(r));
  const rest = islands.filter((id) => !looks.has(id));
  return rest.length ? byType(map, rest, looks, kinds, lookOf) : looks;
}

/** The islands nothing draws, given the look a style on their item's type names, the last changed first. */
async function byType(map: Reads, islands: string[], looks: Map<string, IslandLook>, kinds: string[], lookOf: (r: Row) => IslandLook) {
  const { rows: styles } = await map.db.query<{ on: unknown; look: string }>(
    `select props->'on' as on, props->>'look' as look from entity where type = any($1::text[]) and archived_at is null and is_open and props->>'look' is not null order by updated_at desc, id -- index entity_type`,
    [map.registry.family('style')],
  );
  const named = styles.filter((s) => Array.isArray(s.on) && s.on.length);
  if (!named.length) return looks;
  const [{ rows: isles }, { rows: kept }] = await Promise.all([
    map.db.query<{ id: string; type: string }>(`select id, type from entity where id = any($1::text[])`, [islands]),
    map.db.query<Row>(`select ${LOOK} from entity e where e.id = any($1::text[]) and e.archived_at is null and e.is_open and e.type = any($2::text[])`, [[...new Set(named.map((s) => s.look))], kinds]),
  ]);
  const found = new Map(kept.map((r) => [r.id, r]));
  for (const isle of isles) {
    const style = named.find((s) => found.has(s.look) && (s.on as unknown[]).some((o) => typeof o === 'string' && map.registry.isA(isle.type, o)));
    if (style) looks.set(isle.id, lookOf(found.get(style.look)!));
  }
  return looks;
}
