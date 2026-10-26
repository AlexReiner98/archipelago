// What the map keeps for looking at it: kept views (lens items) and styles, with what each is about; the hubs that need views of
// their own; and where a lens or a style is seen at work.

import { SYSTEM } from './head.ts';
import { scopeOf } from './places.ts';
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
 * The hubs within an item or a place: open items in it that hold enough to need views of their own. How much is
 * enough is the nearest project's hub_at, or HUB_AT: a project still being shaped sets it low, so that most of what
 * is in it is treated as a hub. Read off what is in it each time (what is open and not the system's, and what is
 * part of what); nothing says an item is a hub that could go stale. Across the whole map it is not read: it would
 * read every item.
 */
export async function hubs(l: Archipelago, within?: string) {
  if (!within) throw new Error('hubs reads within an item or a place (within): across the whole map it would read every item.');
  const scope = [...(await scopeOf(l, within, true))];
  const { rows: entities } = await l.db.query<{ id: string; type: string; title: string; kind: string | null; is_open: boolean; props: Record<string, unknown> }>(
    `select id, type, title, kind, is_open, jsonb_build_object('hub_at', props -> 'hub_at') as props from entity where id = any($1::text[]) and archived_at is null`,
    [scope],
  );
  const { rows: relations } = await l.db.query<{ type: string; from_id: string; to_id: string }>(
    `with s(id) as (select unnest($1::text[])) select r.type, r.from_id, r.to_id from relation r join s a on a.id = r.from_id join s b on b.id = r.to_id where r.valid_to is null and r.type = 'part_of' order by r.id`,
    [scope],
  );
  const above = await hubAtAbove(l, within);
  const read = { entities, relations };
  const byId = new Map(read.entities.filter((e) => e.is_open && e.kind !== SYSTEM).map((e) => [e.id, e]));
  const parts = read.relations.filter((r) => r.type === 'part_of');
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
    return above;
  };
  const views = new Map<string, number>();
  for (const lens of await keptOf(l, 'lens', undefined)) for (const id of lens.about) views.set(id, (views.get(id) ?? 0) + 1);
  return [...byId.values()]
    .map((e) => ({ id: e.id, type: e.type, title: e.title, inside: inside(e.id), at: at(e.id), views: views.get(e.id) ?? 0 }))
    .filter((h) => h.inside > 0 && h.inside >= h.at)
    .sort((a, b) => b.inside - a.inside || a.title.localeCompare(b.title));
}

/** The hub_at of the nearest item an item is part of (itself included) that says one, step by step up; else HUB_AT. */
async function hubAtAbove(l: Archipelago, id: string): Promise<number> {
  const { rows } = await l.db.query<{ hub_at: unknown }>(
    `with recursive up(id, n) as (select $1::text, 0 union select r.to_id, up.n + 1 from relation r join up on r.from_id = up.id where r.type = 'part_of' and r.valid_to is null and up.n < 64)
     select e.props -> 'hub_at' as hub_at from up join entity e on e.id = up.id where jsonb_typeof(e.props -> 'hub_at') = 'number' order by up.n limit 1`,
    [id],
  );
  return rows.length ? Number(rows[0].hub_at) : HUB_AT;
}

/** Where on the page a kept view or a style is seen at work: the view itself, or the picture of what a style is about, or of the whole map. Nothing for any other item. */
export async function pictureOf(l: Archipelago, id: string): Promise<string | undefined> {
  const item = await l.entity(id);
  if (item && l.registry.isA(item.type, 'lens')) return `v?canvas=${id}`;
  if (!item || !l.registry.isA(item.type, 'style')) return undefined;
  const { rows } = await l.db.query<{ to_id: string }>(`select to_id from relation where type = 'about' and from_id = $1 and valid_to is null order by id limit 1`, [id]);
  return rows.length ? `graph?from=${rows[0].to_id}` : 'graph?lens';
}
