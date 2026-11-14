// What publishing a document would freeze, and where its publishing stands: the publish pack's half of publishing
// (docs/kernel-packs.md, "Where each module goes"). Publishing itself and taking a document down are ./published.ts,
// behind the rules and the walls. What is frozen is what the public read gives (the reads API's public_document, the
// walls' scrub), and for each view kept on the map it brings in, the picture's data (./published-pictures.ts) with
// nothing private in it and nothing that names a person or a session.

import type { KernelContext } from '#pelago/kernel';
import { itemOf, publishable } from './map.ts';
import { picturesOf } from './published-pictures.ts';

const ID = /^e_[a-z0-9]{8}$/;

type Section = { id: string; type: string } & Record<string, unknown>;
type Reader = { parts: ({ section: Section } | Record<string, unknown>)[]; links?: Record<string, unknown> } & Record<string, unknown>;

/**
 * What a reader would be given of a public document now: what the public read gives (the sections it holds that are
 * shared, the rest only by name and state), and for each lens among them its picture, with nothing private in it.
 */
export async function freezeDocument(ctx: KernelContext, id: string, draft = false) {
  // The other documents published here, which it may name by id and a reader then opens at their own pages.
  const others = (await ctx.reads({ published_others: id })) as { id: string; title: string; path: string | null }[];
  const reader = (await ctx.reads({ public_document: { id, ...(draft && { draft: true }), elsewhere: Object.fromEntries(others.map((o) => [o.id, o.title])) } })) as Reader | null;
  if (!reader) throw new Error(`"${id}" is not a public document.`);
  const sections = reader.parts.flatMap((part) => ('section' in part ? [part.section as Section] : []));
  const { lenses, types } = await picturesOf(ctx, sections, true);
  // Its own address word and place in the header, and the address word of each document it links to: by its id, or
  // by its address ([Quickstart](/quickstart), [home](/) for the front page).
  const props = (await itemOf(ctx, id))?.props ?? {};
  const said = JSON.stringify(reader.parts);
  const linked = (o: { id: string; path: string | null }) => Boolean(reader.links?.[o.id]) || said.includes(`](/${o.path === 'home' ? '' : o.path})`);
  const paths = Object.fromEntries(others.filter((o) => o.path && linked(o)).map((o) => [o.id, o.path]));
  return { ...reader, sections: sections.map((s) => s.id), lenses, types, path: pathOf(props.path), menu: typeof props.menu === 'number' ? props.menu : null, ...(Object.keys(paths).length && { paths }) };
}

export type Frozen = Awaited<ReturnType<typeof freezeDocument>>;

/**
 * What publishing a document now would freeze, without publishing it: for its preview (./published-preview.ts).
 * One not yet public is read as it will be once it is.
 */
export async function wouldPublish(ctx: KernelContext, id: string) {
  const doc = ID.test(id) ? await itemOf(ctx, id) : null;
  if (!doc || !(await publishable(ctx)).types.includes(doc.type)) throw new Error(`"${id}" is not a document that can be public.`);
  if (doc.private_to) throw new Error(`"${doc.title}" is private: share it, and its preview shows it as it would be published.`);
  const given = await freezeDocument(ctx, id, doc.visibility !== 'public');
  // A draft at an address takes it from what is published there: it is what publishing would put there.
  const drafts = await draftPaths(ctx, given.parts), taken = new Set(Object.values(drafts));
  const published = ('paths' in given ? given.paths : {}) as Record<string, string>;
  return { ...given, paths: { ...Object.fromEntries(Object.entries(published).filter(([, path]) => !taken.has(path))), ...drafts } };
}

/** The drafts a document links to by address ([Quickstart](/quickstart), [home](/) for the front page): in its preview each leads to its own, as it will once published. */
async function draftPaths(ctx: KernelContext, parts: unknown) {
  const words = [...new Set([...JSON.stringify(parts).matchAll(/\]\(\/([a-z0-9-]*)\)/g)].map((m) => m[1] || 'home'))];
  if (!words.length) return {};
  const rows = (await ctx.reads({ draft_paths: words })) as { id: string; path: string }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.path]));
}

/** An address word: lowercase letters and digits, words joined by single dashes. */
export const PATH = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const pathOf = (value: unknown) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !PATH.test(value) || value.length > 60) throw new Error(`"${value}" cannot be an address: use lowercase letters, digits and single dashes, such as how-it-works.`);
  return value;
};

/** Whether two answers say the same, whatever order their keys are kept in (the database keeps its own). */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(JSON.parse(JSON.stringify(a)))) === JSON.stringify(canon(b));

/** Whether a document is published, when and by whom, and whether its draft now says something else. */
export async function publishedState(ctx: KernelContext, id: string) {
  // An item no type of which can be public (a post, a task) has no draft to preview: a page reads it as its reader sees it.
  const item = await itemOf(ctx, id);
  if (item && (!(await publishable(ctx)).types.includes(item.type) || item.private_to || item.visibility === 'private')) return { published: false, publishable: false };
  const row = (await ctx.reads({ published_row: id })) as { given: Record<string, unknown>; published_by: string; published_at: Date } | null;
  if (!row) return { published: false };
  const now = await freezeDocument(ctx, id).catch((err: unknown) => (ctx.said(`published ${id}: its draft could not be frozen to compare, so it reads as changed: ${err instanceof Error ? err.message : String(err)}`), null));
  // What was kept beside the words (the look, the marks its part drew them with) is not the draft to compare.
  const { style_at: _, look: _look, marks: _marks, marks_error: _error, ...given } = row.given;
  return { published: true, at: row.published_at, by: row.published_by, changed: !now || !same(now, given) };
}

/** What publishing everything in an item would do: each document it holds, whether it is published, and whether its draft now says something else. */
export async function publishPlan(ctx: KernelContext, within: string) {
  const item = ID.test(within) ? await itemOf(ctx, within) : null;
  if (!item) throw new Error(`No item "${within}".`);
  const documents = [];
  // The open or finished documents it holds, at any depth, of the types that can be public: what Publish all publishes.
  for (const doc of (await ctx.reads({ held_documents: within })) as { id: string; title: string }[]) {
    const state = await publishedState(ctx, doc.id);
    documents.push({ id: doc.id, title: doc.title, published: state.published, changed: state.published ? state.changed : true });
  }
  return { within: { id: item.id, title: item.title }, documents, to_publish: documents.filter((d) => d.changed).length };
}
