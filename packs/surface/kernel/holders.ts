// Who holds what, for the flat answer (round 6, pass 11): a drawing says who is at work on an item, or who it waits on, so the
// answer carries them, named, beside the item: the people with works_on to it, the people it waits_on, and its owner. A session
// at work on it is the answer's `sessions` already, so a run is not repeated here. Only what the items sent have: bounded by
// their ids, never a read of the map.

import type { Archipelago } from '../../write/kernel/pelago.ts';

/** One holder of an item: how it holds it (works, waits), who, and by what name. */
export interface Holder {
  how: 'works' | 'waits';
  id: string;
  name: string;
}

/** A person's name as a strip says it: their title, or the part of an email before the @. */
export const nameOf = (title: string) => (title.includes('@') ? title.split('@')[0]! : title).trim() || title;

/** The holders of each of `ids`, by item id; an item nobody holds is left out. */
export async function holdersOf(l: Pick<Archipelago, 'db' | 'registry'>, ids: string[]): Promise<Record<string, Holder[]>> {
  const out: Record<string, Holder[]> = {};
  if (!ids.length) return out;
  const works = l.registry.relationFamily('works_on'), waits = l.registry.relationFamily('waits_on'), people = l.registry.family('person');
  const add = (item: string, h: Holder) => ((out[item] ??= []).some((x) => x.how === h.how && x.id === h.id) ? 0 : out[item]!.push(h));
  const { rows } = await l.db.query<{ item: string; how: 'works' | 'waits'; id: string; title: string }>(
    `select r.to_id as item, 'works' as how, p.id, p.title from relation r join entity p on p.id = r.from_id
      where r.type = any($2::text[]) and r.valid_to is null and r.to_id = any($1::text[]) and p.type = any($4::text[]) and p.archived_at is null
     union all
     select r.from_id as item, 'waits' as how, p.id, p.title from relation r join entity p on p.id = r.to_id
      where r.type = any($3::text[]) and r.valid_to is null and r.from_id = any($1::text[]) and p.type = any($4::text[]) and p.archived_at is null
     order by 1, 2, 3`,
    [ids, works, waits, people],
  );
  for (const r of rows) add(r.item, { how: r.how, id: r.id, name: nameOf(r.title) });
  // The owner, named: an item that is under way is held by the person who owns it.
  const owners = await l.db.query<{ item: string; id: string; title: string }>(`select e.id as item, o.id, o.title from entity e join entity o on o.id = e.owner where e.id = any($1::text[]) and o.archived_at is null`, [ids]);
  for (const r of owners.rows) add(r.item, { how: 'works', id: r.id, name: nameOf(r.title) });
  return out;
}
