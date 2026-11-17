// An island's own look (feature e_6efhubbz, decision e_3c3wr7jv, the owner, 17 Nov 2026): a layout or a part kept on
// the map about the island (its island item, or its focus) is how that island is drawn, in every view it is in. The
// look's code stays in that kept item, behind the walls every layout and part runs behind; the island itself holds no
// look, and an island pack none (packs/loader/kernel/islands.ts). The view frames it. Read for the islands an answer
// holds alone; where several are kept about one island, the one changed last draws it.

import type { Archipelago } from '../../write/kernel/pelago.ts';

/** An island's own look, as an answer names it: the kept item that draws it, what it is (a layout or a part) and its name. */
export interface IslandLook { id: string; kind: 'layout' | 'part'; title: string; /** When it last changed: what a page keys the code it fetched by. */ at: string }

/** The look kept about each of these islands, by island id: none for an island with none. */
export async function islandLooks(map: Archipelago, islands: string[]): Promise<Map<string, IslandLook>> {
  const looks = new Map<string, IslandLook>();
  if (!islands.length) return looks;
  const layouts = map.registry.family('layout'), parts = map.registry.family('part');
  const { rows } = await map.db.query<{ island: string; id: string; type: string; title: string; at: string }>(
    `select r.to_id as island, e.id, e.type, e.title, e.updated_at::text as at from relation r join entity e on e.id = r.from_id
      where r.to_id = any($1::text[]) and r.type = 'about' and r.valid_to is null
        and e.archived_at is null and e.is_open and e.type = any($2::text[])
      order by e.updated_at desc, e.id`,
    [islands, [...layouts, ...parts]],
  );
  for (const r of rows) if (!looks.has(r.island)) looks.set(r.island, { id: r.id, kind: layouts.includes(r.type) ? 'layout' : 'part', title: r.title, at: r.at });
  return looks;
}
