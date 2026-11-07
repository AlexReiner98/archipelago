// Saved views: every picture kept on the map, named, with what it is a picture of, so a person finds it without
// knowing which item it hangs on (docs/ui-strategy.md). A picture is a kept lens, named by its own title; the shape
// it is drawn in comes from the style or layout it names, else one kept about it. The kept first, then the newest. A working view lives as long as what it is about: once all of that has closed, it is retired with
// it, and left out (task e_gkv58kqb).

import { keptOf } from './query-kept.ts';
import { bringersIn } from './query-saved.ts';
import type { Archipelago } from './pelago.ts';

export interface Picture {
  /** The lens: the picture opens with it, from what it is of. */
  lens: string;
  /** Its name: the lens's own title. */
  title: string;
  /** The shape it is drawn in, when a style says. */
  shape?: string;
  /** What it is a picture of, or nothing for one of the whole map. */
  of?: { id: string; title: string; type: string };
  /** The project that is in or is, nearest first: what a person knows the picture by. */
  project?: { id: string; title: string };
  /** The document that brings it in: it is a part of that page, read there, and not one of the views a person picks from. */
  document?: { id: string; title: string };
  /** Its note's first line: what it shows. */
  note?: string;
  /** Its life: working (an agent's, until the owner keeps it) or kept (on the owner's word). */
  life: 'working' | 'kept';
}

export async function savedViews(l: Archipelago, input: { limit?: number } = {}): Promise<{ pictures: Picture[]; more: number; ended?: string[] }> {
  const [all, styles] = await Promise.all([keptOf(l, 'lens', undefined), keptOf(l, ['style', 'layout'], undefined)]);
  const ofIds = [...new Set(all.flatMap((x) => x.about))];
  const { rows } = ofIds.length ? await l.db.query<{ id: string; title: string; type: string; is_open: boolean }>(`select id, title, type, is_open from entity where id = any($1::text[]) and archived_at is null`, [ofIds]) : { rows: [] };
  const items = new Map(rows.map((r) => [r.id, r]));
  const { rows: lives } = all.length ? await l.db.query<{ id: string; status: string; note: string | null }>(`select id, status, left(split_part(btrim(body), E'
', 1), 200) as note from entity where id = any($1::text[])`, [all.map((x) => x.id)]) : { rows: [] };
  const notes = new Map(lives.filter((r) => r.note).map((r) => [r.id, r.note!]));
  const kept = new Set(lives.filter((r) => r.status === 'kept').map((r) => r.id));
  // A working view about items that have all closed (or gone) is retired with them.
  const ended = all.filter((x) => !kept.has(x.id) && x.about.length > 0 && x.about.every((id) => !items.get(id)?.is_open)).map((x) => x.id);
  const lenses = all.filter((x) => !ended.includes(x.id));
  const projectOf = await projects(l, ofIds);
  const { rows: held } = lenses.length
    ? await l.db.query<{ lens: string; id: string; title: string }>(`select m.to_id as lens, e.id, e.title from mention m join entity e on e.id = m.from_id where m.to_id = any($1::text[]) and e.type = any($2::text[]) and e.archived_at is null order by e.id`, [lenses.map((x) => x.id), bringersIn(l)])
    : { rows: [] };
  const documents = new Map(held.map((r) => [r.lens, { id: r.id, title: r.title }]));
  // keptOf answers oldest first; saved views read newest first, the kept above the rest.
  const pictures = lenses
    .reverse()
    .map((x): Picture => {
      // The style the view names itself, as the page draws it, else one kept about it.
      const own = (x.props.style ?? {}) as Record<string, unknown>;
      const named = styles.find((s) => s.id === own.style);
      const style = named ?? styles.find((s) => s.about.includes(x.id));
      const found = x.about.map((id) => items.get(id)).find(Boolean);
      const of = found && { id: found.id, title: found.title, type: found.type };
      // A style it names lies over its own settings, and a layout with code draws no shape.
      const shape = named ? (typeof named.props.code === 'string' ? undefined : (named.props.shape ?? own.shape)) : (own.shape ?? style?.props.shape);
      const document = documents.get(x.id);
      return { lens: x.id, title: x.title, ...(typeof shape === 'string' && { shape }), ...(of && { of }), ...(of && projectOf(of.id) && { project: projectOf(of.id) }), ...(document && { document }), ...(notes.has(x.id) && { note: notes.get(x.id) }), life: kept.has(x.id) ? 'kept' : 'working' };
    })
    .sort((a, b) => Number(b.life === 'kept') - Number(a.life === 'kept'));
  const limit = input.limit ?? 100;
  return { pictures: pictures.slice(0, limit), more: Math.max(0, pictures.length - limit), ...(ended.length && { ended }) };
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
