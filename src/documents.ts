// A document is writing for a reader, made of the map. Its note is the text, and a line holding only an item's id
// brings that item in at that place, as a section: so what the map says, the document says, with no copy to drift.
// Whoever may see a document may read it whole here; a person can make it public (src/public-view.ts), frozen with
// the items it brings in that are not private.

import type { Q } from './db.ts';
import type { Actor, Archipelago } from './pelago.ts';

/** A line that brings an item in: its id and nothing else. */
const SECTION = /^[ \t]*(e_[a-z0-9]{8})[ \t]*$/;

export interface Section {
  id: string;
  type: string;
  title: string;
  status: string;
  body: string;
  updated_at: string | Date;
  /** Whether a figure is kept for it, shown above its text. */
  picture?: boolean;
  /** Read through a share with this workspace: the item here that the share is, for its figure. */
  via?: string;
}

/** A document as its reader meets it: the text between sections, and each section in its place. */
export type Part = { text: string } | { section: Section } | { missing: string };

/** The ids a document's note brings in, in the order it brings them. */
export function sectionIds(body: string): string[] {
  return [...new Set(body.split('\n').flatMap((line) => SECTION.exec(line)?.[1] ?? []))];
}

/** Cut a note into its text and the places where items come in. An id that could not be read is said as missing. */
export function assemble(body: string, items: Map<string, Section>): Part[] {
  const parts: Part[] = [];
  let text: string[] = [];
  const flush = () => {
    const joined = text.join('\n').trim();
    if (joined) parts.push({ text: joined });
    text = [];
  };
  for (const line of body.split('\n')) {
    const id = SECTION.exec(line)?.[1];
    if (!id) {
      text.push(line);
      continue;
    }
    flush();
    const found = items.get(id);
    parts.push(found ? { section: found } : { missing: id });
  }
  flush();
  return parts;
}

/**
 * A kernel type. Once what a workspace held a document another workspace shared with it as (dropped 10 Nov 2026); its
 * starter was the plain document a link wrapped a view or an item in on a map with core alone, before public views.
 */
export const SHARED = 'shared_document';

/** Of an item's fields, those its type's pack marks as shown: what a page may lay out (an invoice's number, dates, total). */
export const shownOf = (l: Archipelago, type: string, props: Record<string, unknown>) => {
  const defs = l.registry.type(type)?.fields ?? {};
  return Object.fromEntries(Object.entries(props ?? {}).filter(([key, value]) => defs[key]?.shown && value != null));
};

/**
 * An item read whole by its note, as the one asking may see it: a document, or any other item (a post, a task), whose
 * note is read the way a document's is. Only a document's type can be published.
 */
export async function readDocument(l: Archipelago, id: string) {
  const doc = await l.entity(id);
  if (!doc) throw new Error(`"${id}" is not on this map, or is not yours to read`);
  const items = new Map<string, Section>();
  const ids = sectionIds(doc.body);
  const pictured = new Set((await l.db.query<{ entity_id: string }>(`select entity_id from picture where entity_id = any($1::text[])`, [ids])).rows.map((r) => r.entity_id));
  for (const sid of ids) {
    const e = await l.entity(sid);
    if (e && !e.archived_at) items.set(sid, { id: e.id, type: e.type, title: e.title, status: e.status, body: e.body, updated_at: e.updated_at, picture: pictured.has(sid) });
  }
  // A section belongs inside its document. Those kept elsewhere are named, so whoever wrote them can move them in.
  const inside = new Set(
    (await l.db.query<{ from_id: string }>(`select from_id from relation where type = 'part_of' and valid_to is null and to_id = $1 and from_id = any($2::text[])`, [doc.id, ids])).rows.map((r) => r.from_id),
  );
  const notInside = [...items.keys()].filter((sid) => !inside.has(sid));
  return { id: doc.id, type: doc.type, title: doc.title, status: doc.status, for: doc.props.for ?? null, fields: shownOf(l, doc.type, doc.props), updated_at: doc.updated_at, parts: assemble(doc.body, items), ...(notInside.length && { not_inside: notInside }) };
}

/** A document read from outside the map, as the database gave it: the document and the items it brings in. */
export interface Given {
  id: string;
  type: string;
  title: string;
  body: string;
  status: string;
  props: Record<string, unknown>;
  updated_at: string;
  items: Section[];
}

/**
 * What a reader from outside the map is given of a document: an item it does not bring in is not named either, so
 * where a text points at one the reader is told less, not more. `via` marks each section as read through that share.
 */
export function forReader(l: Archipelago, doc: Given, via?: string, elsewhere: Map<string, string> = new Map()) {
  // Named as well as shown: other documents a reader can open where they are (a published one's pages), by title.
  const shown = new Set([...doc.items.map((item) => item.id), ...elsewhere.keys()]);
  const scrub = (text: string) => text.replace(/[ \t]*\(?\b(e_[a-z0-9]{8})\b\)?/g, (found, id) => (shown.has(id) ? found : ''));
  const items = new Map(doc.items.map((item) => [item.id, { ...item, body: scrub(item.body), ...(via && { via }) }]));
  const parts = assemble(doc.body, items).flatMap((part): Part[] => ('missing' in part ? [] : 'text' in part ? [{ text: scrub(part.text) }] : [part]));
  const named = [...elsewhere].filter(([id]) => parts.some((part) => ('text' in part ? part.text : 'section' in part ? part.section.body : '').includes(id)));
  return { type: doc.type, title: doc.title, status: doc.status, fields: shownOf(l, doc.type, doc.props), updated_at: doc.updated_at, parts, ...(named.length && { links: Object.fromEntries(named) }) };
}
