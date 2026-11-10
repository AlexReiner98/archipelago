// A link to a view or a single item, not only a document: what is not a document is given as the document that brings
// it in alone (made once, about it, and kept for its next link), so a link still shows one document and what it brings
// in, read through the same narrow function (pelago_shared_document in src/schema.ts). A view a link brings in is
// drawn live, from what the whole workspace may see of its answer, as publishing would freeze it.

import { SHARED, sharedDocument, shownOf } from './documents.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { picturesOf } from './published-pictures.ts';
import { bringersIn, isKept, keptPicture } from './query-saved.ts';

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
  return Object.keys(lenses).length ? { ...doc, lenses: (await import('./published.ts')).drawingsGiven(l, lenses), types } : doc;
}

/**
 * The items a link to `id` leaves out because they are private: a view's that are, or the item itself. Told to the
 * person as they make the link, so a view whose items are all private (a new map's, where private is the default) is
 * not given as an empty page without their knowing; whether to share them is theirs.
 */
export async function privateIn(l: Archipelago, id: string): Promise<{ id: string; title: string }[]> {
  const item = await l.entity(id);
  if (!item) return [];
  const ids = isKept(l, item.type) ? ((await keptPicture(l, id).catch(() => null))?.items ?? []).map((i) => i.id) : [id];
  if (!ids.length) return [];
  const { rows } = await l.db.query<{ id: string; title: string }>(`select id, title from entity where id = any($1::text[]) and (visibility = 'private' or private_to is not null) and archived_at is null`, [ids]);
  return rows;
}

/**
 * One item a link shows, read as its page reads it, for the sheet a reader opens it in: only an item the link already
 * shows (a section of its document, or a part of a view it draws, never what the view leaves out as private), its
 * title, state, fields and note, an id in the note that the link does not show cut out. Null for anything else.
 */
export async function sharedItem(l: Archipelago, secret: string, id: string) {
  if (!/^e_[a-z0-9]{8}$/.test(id)) return null;
  const view = await sharedView(l, secret);
  if (!view) return null;
  const lenses = ('lenses' in view ? view.lenses : {}) as Record<string, { items: { id: string }[] }>;
  const shown = new Set([...view.parts.flatMap((p) => ('section' in p ? [p.section.id] : [])), ...Object.values(lenses).flatMap((v) => v.items.map((i) => i.id))]);
  if (!shown.has(id)) return null;
  const { rows: [e] } = await l.db.query<{ id: string; type: string; title: string; status: string; body: string; props: Record<string, unknown>; updated_at: Date }>(
    `select id, type, title, status, body, props, updated_at from entity where id = $1 and visibility <> 'private' and private_to is null and archived_at is null`,
    [id],
  );
  if (!e) return null;
  const body = (e.body ?? '').replace(/[ \t]*\(?\b(e_[a-z0-9]{8})\b\)?/g, (found, ref) => (shown.has(ref) ? found : ''));
  return { item: { id: e.id, type: l.registry.type(e.type)?.title ?? e.type, title: e.title, status: e.status, fields: shownOf(l, e.type, e.props), body, updated_at: e.updated_at } };
}

/** What a link's data address answers: the document, or with `item`, the one item it shows that a reader opened. */
export const sharedAnswer = (l: Archipelago, secret: string, item: string | null) => (item ? sharedItem(l, secret, item) : sharedView(l, secret));
