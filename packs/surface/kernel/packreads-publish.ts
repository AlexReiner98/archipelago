// The reads the publish pack needs once it is on its context (wave 6b, e_pkytyzy7): items whole, which types can be public, the
// documents published beside one, the drafts at some address words, the documents an item holds, and a published
// document as anyone reads it. The same SQL its modules ran, each bounded by the id or words it is given (or naming an
// index), answered as the asker under row-level security; the published document through the database's narrow
// function alone, as anyone reads it.

import type { Archipelago } from '../../../src/pelago.ts';
import { finishedStatuses, readable } from '../../walls/kernel/public-document.ts';
import { drawingsGiven } from './public-views.ts';

export type PublishRead = {
  /** Items by id, every column as the asker may read them (archived ones too): what the publish pack's checks read of an item, as the map's own entity() does. */
  entities?: string[];
  /** The types a document is read whole as and can be public (types), and of those each status that says its writing is done, as type:status (finished). */
  publishable?: true;
  /** The other documents published here, public and not archived, which a document may name: id, title and path. */
  published_others?: string;
  /** Of some address words, the documents that can be public and are open or finished at each, not private: id and path. */
  draft_paths?: string[];
  /** The open or finished documents an item holds, at any depth, of the types that can be public: id and title, by title. */
  held_documents?: string;
  /** A published document as anyone reads it, with a drawing for each picture frozen before its shape had one, or null. */
  published_doc?: string;
};

const PUBLISH_READS = ['entities', 'publishable', 'published_others', 'draft_paths', 'held_documents', 'published_doc'] as const satisfies readonly (keyof PublishRead)[];
const ID = /^e_[a-z0-9]{8}$/;

const words = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.some((w) => typeof w !== 'string')) throw new Error('draft_paths is a list of address words');
  return v as string[];
};

/** The answer to one of these reads, or undefined when the read is none of them. */
export async function publishRead(l: Archipelago, q: PublishRead, pack?: string): Promise<unknown> {
  const asked = PUBLISH_READS.find((k) => q[k] !== undefined);
  if (!asked) return undefined;
  // The server's own packs alone, as the other service reads (./packreads-service.ts).
  if (!pack) throw new Error(`Only the server's own packs read ${asked}`);
  if (q.entities !== undefined) {
    const ids = q.entities;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('entities is a list of ids');
    const { rows } = await l.db.query(`select * from entity where id = any($1::text[])`, [ids]);
    return rows;
  }
  if (q.publishable) return { types: readable(l), finished: finishedStatuses(l) };
  if (q.published_others !== undefined) {
    const { rows } = await l.db.query<{ id: string; title: string; path: string | null }>(
      `select e.id, e.title, p.path from published p join entity e on e.id = p.entity_id
       where p.entity_id <> $1 and e.visibility = 'public' and e.archived_at is null and e.private_to is null`,
      [String(q.published_others)],
    );
    return rows;
  }
  if (q.draft_paths !== undefined) {
    const asked = words(q.draft_paths);
    if (!asked.length) return [];
    const { rows } = await l.db.query<{ id: string; path: string }>(
      `select id, props->>'path' as path from entity where type = any($1::text[]) and archived_at is null and (is_open or type || ':' || status = any($3::text[])) and private_to is null and props->>'path' = any($2::text[]) -- index entity_type_created`,
      [readable(l), asked, finishedStatuses(l)],
    );
    return rows;
  }
  if (q.held_documents !== undefined) {
    const { rows } = await l.db.query<{ id: string; title: string }>(
      `select e.id, e.title from entity e where e.id in (select descendant from part_closure where ancestor = $1)
         and e.type = any($2::text[]) and (e.is_open or e.type || ':' || e.status = any($3::text[])) and e.archived_at is null order by e.title`,
      [String(q.held_documents), readable(l), finishedStatuses(l)],
    );
    return rows;
  }
  const id = String(q.published_doc);
  if (!ID.test(id)) return null;
  const { rows } = await l.forAnyone().db.query<{ doc: Record<string, unknown> | null }>(`select pelago_published($1, $2::text[]) as doc`, [id, readable(l)]);
  const doc = rows[0]?.doc ?? null;
  const lenses = doc?.lenses as Record<string, { style?: Record<string, unknown> }> | undefined;
  return doc && lenses ? { ...doc, lenses: drawingsGiven(l, lenses) } : doc;
}
