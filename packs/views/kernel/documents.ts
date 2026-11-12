// A document is writing for a reader, made of the map. Its note is the text, and a line holding only an item's id
// brings that item in at that place, as a section: so what the map says, the document says, with no copy to drift.
// Whoever may see a document may read it whole here; a person can make it public (the publish pack), frozen with
// the items it brings in that are not private. Read through the views pack's context (docs/kernel-packs.md, "Moving
// a service in the wave"): what is read, as the asker under row-level security; what a type shows, from the registry.

import type { KernelContext } from '#pelago/kernel';

/** A line that brings an item in: its id and nothing else. */
const SECTION = /^[ \t]*(e_[a-z0-9]{8})[ \t]*$/;

/** What reads a type's fields: a pack's context, or anything with the registry (the map, until the gather step). */
type Typed = Pick<KernelContext, 'registry'>;

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
export const shownOf = (ctx: Typed, type: string, props: Record<string, unknown>) => {
  const defs = ctx.registry.type(type)?.fields ?? {};
  return Object.fromEntries(Object.entries(props ?? {}).filter(([key, value]) => defs[key]?.shown && value != null));
};

type Row = { id: string; type: string; title: string; status: string; body?: string; props?: Record<string, unknown>; updated_at: string | Date; archived_at?: unknown };

/**
 * An item read whole by its note, as the one asking may see it: a document, or any other item (a post, a task), whose
 * note is read the way a document's is. Only a document's type can be published.
 */
export async function readDocument(ctx: KernelContext, id: string) {
  const [doc] = (await ctx.reads({ ids: [id] })) as Row[];
  if (!doc) throw new Error(`"${id}" is not on this map, or is not yours to read`);
  const body = doc.body ?? '';
  const items = new Map<string, Section>();
  const ids = sectionIds(body);
  const pictured = new Set(ids.length ? ((await ctx.reads({ pictures: ids })) as string[]) : []);
  const found = new Map((ids.length ? ((await ctx.reads({ ids })) as Row[]) : []).map((e) => [e.id, e]));
  for (const sid of ids) {
    const e = found.get(sid);
    if (e && !e.archived_at) items.set(sid, { id: e.id, type: e.type, title: e.title, status: e.status, body: e.body ?? '', updated_at: e.updated_at, picture: pictured.has(sid) });
  }
  // A section belongs inside its document. Those kept elsewhere are named, so whoever wrote them can move them in.
  const inside = new Set((ids.length ? ((await ctx.reads({ links: { from: ids, to: [doc.id], types: ['part_of'] } })) as { from_id: string }[]) : []).map((r) => r.from_id));
  const notInside = [...items.keys()].filter((sid) => !inside.has(sid));
  const props = doc.props ?? {};
  return { id: doc.id, type: doc.type, title: doc.title, status: doc.status, for: props.for ?? null, fields: shownOf(ctx, doc.type, props), updated_at: doc.updated_at, parts: assemble(body, items), ...(notInside.length && { not_inside: notInside }) };
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
export function forReader(ctx: Typed, doc: Given, via?: string, elsewhere: Map<string, string> = new Map()) {
  // Named as well as shown: other documents a reader can open where they are (a published one's pages), by title.
  const shown = new Set([...doc.items.map((item) => item.id), ...elsewhere.keys()]);
  const scrub = (text: string) => text.replace(/[ \t]*\(?\b(e_[a-z0-9]{8})\b\)?/g, (found, id) => (shown.has(id) ? found : ''));
  const items = new Map(doc.items.map((item) => [item.id, { ...item, body: scrub(item.body), ...(via && { via }) }]));
  const parts = assemble(doc.body, items).flatMap((part): Part[] => ('missing' in part ? [] : 'text' in part ? [{ text: scrub(part.text) }] : [part]));
  const named = [...elsewhere].filter(([id]) => parts.some((part) => ('text' in part ? part.text : 'section' in part ? part.section.body : '').includes(id)));
  return { type: doc.type, title: doc.title, status: doc.status, fields: shownOf(ctx, doc.type, doc.props), updated_at: doc.updated_at, parts, ...(named.length && { links: Object.fromEntries(named) }) };
}

/** The ids a document's note brings in, asked by the surface where it reads a document for anyone (surface.sections). */
export const sectionsOf = (_ctx: Typed, body: string) => sectionIds(body);
