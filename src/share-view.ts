// A link to a view or a single item, not only a document: what is not a document is given as the document that brings
// it in alone (made once, about it, and kept for its next link), so a link still shows one document and what it brings
// in, read through the same narrow function (pelago_shared_document in src/schema.ts). A view a link brings in is
// drawn live, from what the whole workspace may see of its answer, as publishing would freeze it.

import { SHARED, sharedDocument } from './documents.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { picturesOf } from './published-pictures.ts';
import { bringersIn } from './query-saved.ts';

/**
 * The types a screen reads whole, as a document is, that a link may open (not one another workspace shares). On a map
 * with none of those (core alone), the starter a shared document comes from: a note whose lines bring items in reads
 * whole all the same (query document), so a view or an item can be given as a link on any map.
 */
export const readWhole = (l: Archipelago) => {
  const types = bringersIn(l).filter((t) => t !== SHARED);
  const plain = l.registry.type(SHARED)?.starter;
  return types.length || !plain ? types : [plain];
};

/** The type a wrapping document is made of: one read whole that is no flavour of another (a plain document, not an invoice). */
const documentType = (l: Archipelago) => {
  const types = readWhole(l);
  return types.find((t) => !types.some((o) => o !== t && l.registry.isA(t, o))) ?? types[0];
};

/**
 * The document a link to `id` opens: the item itself when it is a document, else the one that brings it in alone,
 * made about it the first time. Only what the one asking may see, and nothing archived.
 */
export async function shareable(l: Archipelago, actor: Actor, id: string): Promise<string> {
  const item = await l.entity(id);
  if (!item || item.type === SHARED) throw new Error(`"${id}" is not a document of this workspace, nor a view or item of it you can read: only those can be given as a link.`);
  if (item.archived_at) throw new Error(`"${item.title}" is archived.`);
  const docs = readWhole(l);
  if (docs.includes(item.type)) return item.id;
  const type = documentType(l);
  if (!type) throw new Error('This map has no type to give it a link with.');
  // One made for an earlier link is used again: its note still brings in this item, and nothing else.
  const { rows } = await l.db.query<{ id: string }>(
    `select e.id from relation r join entity e on e.id = r.from_id
     where r.to_id = $1 and r.type = 'about' and r.valid_to is null and e.type = any($2::text[]) and e.archived_at is null and trim(e.body) = $1
     order by e.created_at limit 1`,
    [item.id, docs],
  );
  if (rows[0]) return rows[0].id;
  const made = await l.change(actor, {
    reason: `To give "${item.title}" as a link`,
    ops: [
      { op: 'create', ref: 'doc', type, title: item.title, body: item.id, visibility: item.visibility as 'private' | 'shared' | 'public' },
      { op: 'link', type: 'about', from: 'doc', to: item.id },
    ],
  });
  const doc = 'created' in made ? (made.created as Record<string, string>).doc : undefined;
  if (!doc) throw new Error(`No link was made: the document to give "${item.title}" with waits for the owner.`);
  return doc;
}

/** What a link shows, read as anyone with no login, with each view it brings in drawn as the workspace may see it now. */
export async function sharedView(l: Archipelago, secret: string) {
  const doc = await sharedDocument(l, secret);
  if (!doc) return null;
  const sections = doc.parts.flatMap((p) => ('section' in p ? [p.section] : []));
  const { lenses, types } = await picturesOf(l, sections, true);
  return Object.keys(lenses).length ? { ...doc, lenses, types } : doc;
}
