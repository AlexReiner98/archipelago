// What the map keeps for looking at it: lenses and styles, with what each is about; the hubs that need views of
// their own; and where a lens or a style is seen at work.

import type { Archipelago } from './pelago.ts';

export interface Kept {
  id: string;
  title: string;
  props: Record<string, unknown>;
  about: string[];
}

/** Every lens or style kept on the map, with what each is about; and one named outright, retired or not. */
export async function keptOf(l: Archipelago, type: 'lens' | 'style', named: unknown): Promise<Kept[]> {
  const { rows } = await l.db.query<{ id: string; title: string; props: Record<string, unknown> }>(
    `select id, title, ${l.props} from entity where type = any($1::text[]) and archived_at is null and (is_open or id = $2) order by updated_at, id`,
    [l.registry.family(type), typeof named === 'string' ? named : null],
  );
  if (typeof named === 'string' && !rows.some((r) => r.id === named)) throw new Error(`No ${type} "${named}"`);
  const { rows: links } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'about' and valid_to is null and from_id = any($1::text[])`, [rows.map((r) => r.id)]);
  return rows.map((r) => ({ ...r, about: links.filter((link) => link.from_id === r.id).map((link) => link.to_id) }));
}

/** How many open things an item holds before it is a hub, unless its project says otherwise (hub_at). */
export const HUB_AT = 12;

/**
 * The hubs: open items that hold enough to need views of their own. How much
 * is enough is the nearest project's hub_at, or HUB_AT: a project still being
 * shaped sets it low, so that most of what is in it is treated as a hub.
 * Read off the map each time; nothing says an item is a hub that could go stale.
 */
export async function hubs(l: Archipelago) {
  const { rows: entities } = await l.db.query<{ id: string; type: string; title: string; props: Record<string, unknown> }>(`select id, type, title, ${l.props} from entity where archived_at is null and is_open`);
  const byId = new Map(entities.filter((e) => !e.type.startsWith('sys.') && !l.registry.isA(e.type, 'lens') && !l.registry.isA(e.type, 'style')).map((e) => [e.id, e]));
  const { rows: parts } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'part_of' and valid_to is null order by id`);
  const up = new Map<string, string>();
  const kids = new Map<string, string[]>();
  for (const p of parts) {
    if (!byId.has(p.from_id) || !byId.has(p.to_id) || up.has(p.from_id) || p.from_id === p.to_id) continue;
    up.set(p.from_id, p.to_id);
    kids.set(p.to_id, [...(kids.get(p.to_id) ?? []), p.from_id]);
  }
  const counts = new Map<string, number>();
  const inside = (id: string, trail = new Set<string>()): number => {
    const known = counts.get(id);
    if (known !== undefined) return known;
    if (trail.has(id)) return 0; // a loop of belonging: stop going round
    trail.add(id);
    const n = (kids.get(id) ?? []).reduce((sum, kid) => sum + 1 + inside(kid, trail), 0);
    trail.delete(id);
    counts.set(id, n);
    return n;
  };
  const at = (id: string): number => {
    for (let cur: string | undefined = id, steps = 0; cur !== undefined && steps < 64; cur = up.get(cur), steps++) {
      const e = byId.get(cur)!;
      if (typeof e.props.hub_at === 'number') return e.props.hub_at;
    }
    return HUB_AT;
  };
  const views = new Map<string, number>();
  for (const lens of await keptOf(l, 'lens', undefined)) for (const id of lens.about) views.set(id, (views.get(id) ?? 0) + 1);
  return [...byId.values()]
    .map((e) => ({ id: e.id, type: e.type, title: e.title, inside: inside(e.id), at: at(e.id), views: views.get(e.id) ?? 0 }))
    .filter((h) => h.inside > 0 && h.inside >= h.at)
    .sort((a, b) => b.inside - a.inside || a.title.localeCompare(b.title));
}

/** Where on the page a lens or a style is seen at work: the picture of what it is about, or of the whole map. Nothing for any other item. */
export async function pictureOf(l: Archipelago, id: string): Promise<string | undefined> {
  const item = await l.entity(id);
  if (!item || !(l.registry.isA(item.type, 'lens') || l.registry.isA(item.type, 'style'))) return undefined;
  const { rows } = await l.db.query<{ to_id: string }>(`select to_id from relation where type = 'about' and from_id = $1 and valid_to is null order by id limit 1`, [id]);
  return rows.length ? `graph?from=${rows[0].to_id}` : 'graph?lens';
}
