// An item read whole by its note, as the one asking may see it: the `document` tool's answer. Copied from the views
// pack's reader (packs/views/kernel/documents.ts, readDocument and assemble), as this pack copies the small helpers it
// shares (./map.ts): a pack imports no other pack, and the views pack answers it by no service name. Read through the
// context, as the asker under row-level security.

import type { KernelContext } from '#pelago/kernel';
import { sectionIds, shownOf } from './map.ts';

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
}

/** A document as its reader meets it: the text between sections, and each section in its place. */
export type Part = { text: string } | { section: Section } | { missing: string };

/** Cut a note into its text and the places where items come in. An id that could not be read is said as missing. */
function assemble(body: string, items: Map<string, Section>): Part[] {
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

type Row = { id: string; type: string; title: string; status: string; body?: string; props?: Record<string, unknown>; updated_at: string | Date; archived_at?: unknown };

/** An item read whole by its note: a document, or any other item whose note is read the way a document's is. */
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
