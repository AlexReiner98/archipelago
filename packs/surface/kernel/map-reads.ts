// The kernel's reads of the map (docs/kernel-packs.md, "The root packs": `get`, `search`, `trail`, `events`,
// `proposals` are surface's). The write root's Archipelago class keeps only writes; its callers ask these here. Only what
// the asker may see: every read here is the map's own, under its viewer's row-level security.
//
// - search is surface's own read (searchMap, src/search.ts).
// - events is the activity log as read (readEvents, src/eventlog.ts), the views pack's: the surface asks it where an
//   answer needs it (the tool events, and get's recent events, src/tool-reads.ts), not here, which would owe a service.
// - proposals is the write root's (proposalsOf, src/proposals.ts): the write path reads its own queue (withdraw).

import type { Archipelago } from '../../write/kernel/pelago.ts';
import { proposalsOf } from '../../write/kernel/proposals.ts';

/** Whether an item is there though the reader may not see it (pelago_item_hidden, src/schema.ts). */
export async function hidden(l: Archipelago, id: string): Promise<boolean> {
  if (!/^e_[a-z0-9]{8}$/.test(id)) return false;
  return Boolean((await l.db.query<{ h: boolean }>(`select pelago_item_hidden($1) as h`, [id])).rows[0]?.h);
}

/** An item, what it is tied to and what holds it: what get answers, but its recent events (asked of the activity log by the caller). */
export async function getItem(l: Archipelago, id: string) {
  const entity = await l.entity(id);
  // One the reader may not see is said to be hidden, not missing: an agent can tell a private item from a wrong id.
  if (!entity) throw new Error((await hidden(l, id)) ? `Item "${id}" is private to someone else: you cannot read it` : `No item "${id}"`);
  const rel = `r.id as relation, r.type, r.props, r.confidence, e.id, e.type as entity_type, e.title, e.status`;
  // All at once: on a database over the network each read is a few round trips, and the trail is several reads.
  const [out, inc, source, trailed, mentioned_in] = await Promise.all([
    l.db.query(`select ${rel} from relation r join entity e on e.id = r.to_id where r.from_id = $1 and r.valid_to is null`, [id]),
    l.db.query(`select ${rel} from relation r join entity e on e.id = r.from_id where r.to_id = $1 and r.valid_to is null`, [id]),
    entity.source_id ? l.entity(entity.source_id) : undefined,
    trail(l, id),
    l.mentionedIn(id), // the way back for a link written as an id, kept on the class (it names a pack's style)
  ]);
  return {
    entity,
    source: source && { id: source.id, title: source.title, uri: source.props.uri },
    trail: trailed,
    mentioned_in,
    outgoing: out.rows,
    incoming: inc.rows,
  };
}

/**
 * Where an item sits: what it is part of, what that is part of, and so on, outermost first, each with the views
 * kept about it (lenses, not shortcuts), so a page can lead back up to a picture it was reached from. Led to two
 * things, it goes up the nearer: the one that is itself part of something. Only what the asker may see.
 */
export async function trail(l: Archipelago, id: string) {
  const trail: { id: string; type: string; title: string; views: { id: string; title: string }[] }[] = [];
  const seen = new Set([id]);
  for (let at = id; trail.length < 8; ) {
    const { rows } = await l.db.query<{ id: string; type: string; title: string }>(
      `select e.id, e.type, e.title from relation r join entity e on e.id = r.to_id
       where r.from_id = $1 and r.type = 'part_of' and r.valid_to is null and e.archived_at is null
       order by exists (select 1 from relation u where u.from_id = e.id and u.type = 'part_of' and u.valid_to is null) desc, e.title`,
      [at],
    );
    const next = rows.find((r) => !seen.has(r.id));
    if (!next) break;
    seen.add(next.id);
    trail.unshift({ ...next, views: [] });
    at = next.id;
  }
  if (!trail.length) return trail;
  const { rows } = await l.db.query<{ id: string; title: string; about: string }>(
    `select v.id, v.title, a.to_id as about from entity v join relation a on a.from_id = v.id and a.type = 'about' and a.valid_to is null
     where v.type = any($1::text[]) and v.archived_at is null and v.is_open and a.to_id = any($2::text[])
     order by (v.props ->> 'place')::numeric nulls last, v.title`,
    [l.registry.family('lens'), trail.map((t) => t.id)],
  );
  for (const v of rows) trail.find((t) => t.id === v.about)?.views.push({ id: v.id, title: v.title });
  return trail;
}

export const proposals = proposalsOf;
