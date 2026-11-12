// What publishing a document would freeze, and where its publishing stands: the publish pack's half of publishing
// (docs/kernel-packs.md, "Where each module goes"). Publishing itself, taking a document down and the public reads stay
// the kernel's (src/published.ts), behind the rules and the walls. What is frozen is what the public read gives
// (src/public-document.ts), and for each view kept on the map it brings in, the picture's data (src/query-saved.ts)
// with nothing private in it and nothing that names a person or a session.

import { notify } from '../../../src/notify.ts';
import type { Actor, Archipelago } from '../../../src/pelago.ts';
import { draftDocument, finishedStatuses, publicDocument, readable } from '../../../src/public-document.ts';
import { picturesOf } from './published-pictures.ts';
import { logged } from '../../../src/logged.ts';

const ID = /^e_[a-z0-9]{8}$/;

/**
 * What a reader would be given of a public document now: what the public read gives (src/public-document.ts: the
 * sections it holds that are shared, the rest only by name and state), and for each lens among them its picture,
 * with nothing private in it.
 */
export async function freezeDocument(l: Archipelago, id: string, draft = false) {
  // The other documents published here, which it may name by id and a reader then opens at their own pages.
  const { rows: others } = await l.db.query<{ id: string; title: string; path: string | null }>(
    `select e.id, e.title, p.path from published p join entity e on e.id = p.entity_id
     where p.entity_id <> $1 and e.visibility = 'public' and e.archived_at is null and e.private_to is null`,
    [id],
  );
  const reader = await (draft ? draftDocument : publicDocument)(l, id, new Map(others.map((o) => [o.id, o.title])));
  if (!reader) throw new Error(`"${id}" is not a public document.`);
  const sections = reader.parts.flatMap((part) => ('section' in part ? [part.section] : []));
  const { lenses, types } = await picturesOf(l, sections, true);
  // Its own address word and place in the header, and the address word of each document it links to: by its id, or
  // by its address ([Quickstart](/quickstart), [home](/) for the front page).
  const props = (await l.entity(id))?.props ?? {};
  const said = JSON.stringify(reader.parts);
  const linked = (o: { id: string; path: string | null }) => Boolean(reader.links?.[o.id]) || said.includes(`](/${o.path === 'home' ? '' : o.path})`);
  const paths = Object.fromEntries(others.filter((o) => o.path && linked(o)).map((o) => [o.id, o.path]));
  return { ...reader, sections: sections.map((s) => s.id), lenses, types, path: pathOf(props.path), menu: typeof props.menu === 'number' ? props.menu : null, ...(Object.keys(paths).length && { paths }) };
}

/**
 * What publishing a document now would freeze, without publishing it: for its preview (src/published-preview.ts).
 * One not yet public is read as it will be once it is.
 */
export async function wouldPublish(l: Archipelago, id: string) {
  const doc = ID.test(id) ? await l.entity(id) : null;
  if (!doc || !readable(l).includes(doc.type)) throw new Error(`"${id}" is not a document that can be public.`);
  if (doc.private_to) throw new Error(`"${doc.title}" is private: share it, and its preview shows it as it would be published.`);
  const given = await freezeDocument(l, id, doc.visibility !== 'public');
  // A draft at an address takes it from what is published there: it is what publishing would put there.
  const drafts = await draftPaths(l, given.parts), taken = new Set(Object.values(drafts));
  const published = ('paths' in given ? given.paths : {}) as Record<string, string>;
  return { ...given, paths: { ...Object.fromEntries(Object.entries(published).filter(([, path]) => !taken.has(path))), ...drafts } };
}

/** The drafts a document links to by address ([Quickstart](/quickstart), [home](/) for the front page): in its preview each leads to its own, as it will once published. */
async function draftPaths(l: Archipelago, parts: unknown) {
  const words = [...new Set([...JSON.stringify(parts).matchAll(/\]\(\/([a-z0-9-]*)\)/g)].map((m) => m[1] || 'home'))];
  if (!words.length) return {};
  const { rows } = await l.db.query<{ id: string; path: string }>(
    `select id, props->>'path' as path from entity where type = any($1::text[]) and archived_at is null and (is_open or type || ':' || status = any($3::text[])) and private_to is null and props->>'path' = any($2::text[]) -- index entity_type_created`,
    [readable(l), words, finishedStatuses(l)],
  );
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
export async function publishedState(l: Archipelago, id: string) {
  // An item no type of which can be public (a post, a task) has no draft to preview: a page reads it as its reader sees it.
  const item = await l.entity(id);
  if (item && (!readable(l).includes(item.type) || item.private_to || item.visibility === 'private')) return { published: false, publishable: false };
  const { rows } = await l.db.query<{ given: Record<string, unknown>; published_by: string; published_at: Date }>(`select given, published_by, published_at from published where entity_id = $1`, [id]);
  if (!rows[0]) return { published: false };
  const now = await freezeDocument(l, id).catch(logged(`published ${id}: its draft could not be frozen to compare, so it reads as changed`, null));
  const { style_at: _, look: _look, ...given } = rows[0].given;
  return { published: true, at: rows[0].published_at, by: rows[0].published_by, changed: !now || !same(now, given) };
}

/** The open or finished documents an item holds, at any depth, of the types that can be public: what Publish all publishes. */
async function heldDocuments(l: Archipelago, within: string) {
  const { rows } = await l.db.query<{ id: string; title: string }>(
    `select e.id, e.title from entity e where e.id in (select descendant from part_closure where ancestor = $1)
       and e.type = any($2::text[]) and (e.is_open or e.type || ':' || e.status = any($3::text[])) and e.archived_at is null order by e.title`,
    [within, readable(l), finishedStatuses(l)],
  );
  return rows;
}

/** What publishing everything in an item would do: each document it holds, whether it is published, and whether its draft now says something else. */
export async function publishPlan(l: Archipelago, within: string) {
  const item = ID.test(within) ? await l.entity(within) : null;
  if (!item) throw new Error(`No item "${within}".`);
  const documents = [];
  for (const doc of await heldDocuments(l, within)) {
    const state = await publishedState(l, doc.id);
    documents.push({ id: doc.id, title: doc.title, published: state.published, changed: state.published ? state.changed : true });
  }
  return { within: { id: item.id, title: item.title }, documents, to_publish: documents.filter((d) => d.changed).length };
}

/** An agent asks for an item's documents to be published: a notification about it for the person, who publishes with one click. */
export async function publishAsk(l: Archipelago, actor: Actor, within: string, reason?: string) {
  const plan = await publishPlan(l, within);
  if (!plan.to_publish) return { asked: false, note: `Everything in "${plan.within.title}" is published as it stands.` };
  const n = plan.to_publish;
  const title = `${n} document${n === 1 ? '' : 's'} in "${plan.within.title}" to publish`.slice(0, 200);
  await notify(l, actor, { title, body: [reason, plan.documents.filter((d) => d.changed).map((d) => `- ${d.title}`).join('\n')].filter(Boolean).join('\n\n'), about: within });
  return { asked: true, to_publish: n, note: 'The person is notified; publishing is theirs, with one click on the item’s page.' };
}
