// Saved views: every picture kept on the map, named, with what it is a picture of, so a person finds it without
// knowing which item it hangs on (docs/ui-strategy.md). A picture is a kept lens; a style kept about that lens
// names it, as the way it is drawn is what a person remembers. Pinned ones first, then the newest.

import { keptOf } from './lens-kept.ts';
import type { Archipelago } from './pelago.ts';

export interface Picture {
  /** The lens: the picture opens with it, from what it is of. */
  lens: string;
  /** Its name: the style's that draws it, else the lens's. */
  title: string;
  /** The shape it is drawn in, when a style says. */
  shape?: string;
  /** What it is a picture of, or nothing for one of the whole map. */
  of?: { id: string; title: string; type: string };
  /** The project that is in or is, nearest first: what a person knows the picture by. */
  project?: { id: string; title: string };
  pinned: boolean;
}

export async function savedViews(l: Archipelago, input: { limit?: number } = {}): Promise<{ pictures: Picture[]; more: number }> {
  const [lenses, styles] = await Promise.all([keptOf(l, 'lens', undefined), keptOf(l, 'style', undefined)]);
  const ofIds = [...new Set(lenses.flatMap((x) => x.about))];
  const { rows } = ofIds.length ? await l.db.query<{ id: string; title: string; type: string }>(`select id, title, type from entity where id = any($1::text[]) and archived_at is null`, [ofIds]) : { rows: [] };
  const items = new Map(rows.map((r) => [r.id, r]));
  const projectOf = await projects(l, ofIds);
  // keptOf answers oldest first; saved views read newest first, the pinned above the rest.
  const pictures = lenses
    .reverse()
    .map((x): Picture => {
      const style = styles.find((s) => s.about.includes(x.id));
      const of = x.about.map((id) => items.get(id)).find(Boolean);
      const shape = style?.props.shape;
      return { lens: x.id, title: style?.title || x.title, ...(typeof shape === 'string' && { shape }), ...(of && { of }), ...(of && projectOf(of.id) && { project: projectOf(of.id) }), pinned: x.props.pinned === true };
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const limit = input.limit ?? 100;
  return { pictures: pictures.slice(0, limit), more: Math.max(0, pictures.length - limit) };
}

/**
 * The nearest project each of some items is or is part of, going up "is part of" (the part_of closure): a project is
 * a type the packs put at that altitude, and the nearest is the one the others hold too.
 */
async function projects(l: Archipelago, ids: string[]): Promise<(id: string) => { id: string; title: string } | undefined> {
  const kinds = [...l.registry.types.values()].filter((t) => t.altitude === 'project').map((t) => t.id);
  const { rows } = await l.db.query<{ id: string; project: string; title: string; above: number }>(
    `select s.id, e.id as project, e.title, (select count(*)::int from part_closure up where up.descendant = e.id) as above
     from unnest($1::text[]) s(id) join entity e on (e.id = s.id or e.id in (select ancestor from part_closure c where c.descendant = s.id))
     where e.type = any($2::text[]) and e.archived_at is null`,
    [ids, kinds],
  );
  const nearest = new Map<string, { id: string; title: string; above: number }>();
  for (const r of rows) if (r.id === r.project || (nearest.get(r.id)?.id !== r.id && r.above > (nearest.get(r.id)?.above ?? -1))) nearest.set(r.id, { id: r.project, title: r.title, above: r.id === r.project ? Infinity : r.above });
  return (id) => {
    const found = nearest.get(id);
    return found && { id: found.id, title: found.title };
  };
}
