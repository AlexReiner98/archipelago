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
  const projectOf = await projects(l);
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

/** The nearest project an item is or is part of, going up "is part of": a project is a type the packs put at that altitude. */
async function projects(l: Archipelago): Promise<(id: string) => { id: string; title: string } | undefined> {
  const kinds = [...l.registry.types.values()].filter((t) => t.altitude === 'project').map((t) => t.id);
  const { rows: found } = await l.db.query<{ id: string; title: string }>(`select id, title from entity where type = any($1::text[]) and archived_at is null`, [kinds]);
  const isProject = new Map(found.map((p) => [p.id, p]));
  const { rows: parts } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'part_of' and valid_to is null order by id`);
  const up = new Map<string, string>();
  for (const p of parts) if (!up.has(p.from_id) && p.from_id !== p.to_id) up.set(p.from_id, p.to_id);
  return (id) => {
    for (let cur: string | undefined = id, steps = 0; cur !== undefined && steps < 64; cur = up.get(cur), steps++) if (isProject.has(cur)) return isProject.get(cur);
    return undefined;
  };
}
