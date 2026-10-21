// Publishing a document: what anyone reads at /p/<workspace>/<id> is the document as it was when a person last
// published it, frozen (src/public-schema.ts, PUBLISHED). The draft is edited on the map, privately or not; nothing
// public changes until it is published again. Only a human publishes: the tools are theirs alone.
//
// What is frozen is what the public read gives (src/public-document.ts), and for each lens it brings in, the
// picture's data with nothing private in it and nothing that names a person or a session.

import { lens } from './lens.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import { publicDocument, readable } from './public-document.ts';

const ID = /^e_[a-z0-9]{8}$/;
const IDS = /[ \t]*\(?\b(e_[a-z0-9]{8})\b\)?/g;

/** An item's first sentence, or as much of its first paragraph as reads in a line: what a reader is told of a part. */
export function gist(body: string, most = 160): string {
  const first = body.split(/\n[ \t]*\n/).map((p) => p.replace(IDS, '').replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  const sentence = /^(.+?[.!?])(\s|$)/.exec(first)?.[1] ?? first;
  return sentence.length <= most ? sentence : `${sentence.slice(0, most - 1).replace(/\s+\S*$/, '')}…`;
}

type Answer = Awaited<ReturnType<typeof lens>>;

/** A lens's answer as a reader may have it: the picture's data, each part with its first line, nothing about who or which session. */
export function freezeLens(answer: Answer, bodies: Map<string, string>) {
  const quiet = <T extends { waits_on: unknown; sessions: number }>(s: T) => ({ ...s, waits_on: Array.isArray(s.waits_on) ? [] : {}, sessions: 0 });
  const { code: _code, ...style } = (answer.style ?? {}) as Record<string, unknown>;
  return {
    lens: answer.lens,
    style,
    said: answer.said,
    views: [],
    view: null,
    controls: [],
    viewer: null,
    items: answer.items.map((item) => ({ ...item, state: quiet(item.state), within: quiet(item.within), gist: gist(bodies.get(item.id) ?? '') })),
    links: answer.links,
    rest: answer.rest,
  };
}

/**
 * What a reader would be given of a public document now: what the public read gives (src/public-document.ts: the
 * sections it holds that are shared, the rest only by name and state), and for each lens among them its picture,
 * with nothing private in it.
 */
async function freeze(l: Archipelago, id: string) {
  // The other documents published here, which it may name by id and a reader then opens at their own pages.
  const { rows: others } = await l.db.query<{ id: string; title: string; path: string | null }>(
    `select e.id, e.title, p.path from published p join entity e on e.id = p.entity_id
     where p.entity_id <> $1 and e.visibility = 'public' and e.archived_at is null and e.private_to is null`,
    [id],
  );
  const reader = await publicDocument(l, id, new Map(others.map((o) => [o.id, o.title])));
  if (!reader) throw new Error(`"${id}" is not a public document.`);
  const sections = reader.parts.flatMap((part) => ('section' in part ? [part.section] : []));
  const lenses: Record<string, ReturnType<typeof freezeLens>> = {};
  const types: Record<string, string> = {};
  for (const section of sections.filter((s) => l.registry.isA(s.type, 'lens'))) {
    const answer = await lens(l, { lens: section.id });
    const { rows } = await l.db.query<{ id: string; body: string }>(
      `select id, body from entity where id = any($1::text[]) and visibility <> 'private' and private_to is null`,
      [answer.items.map((i) => i.id)],
    );
    const shown = new Map(rows.map((r) => [r.id, r.body]));
    const kept = { ...answer, items: answer.items.filter((i) => shown.has(i.id)), links: answer.links.filter((k) => shown.has(k.from) && shown.has(k.to)) };
    lenses[section.id] = freezeLens(kept, shown);
    for (const i of kept.items) types[i.type] = l.registry.type(i.type)?.title ?? i.type;
  }
  // Its own address word and place in the header, and the address word of each document it links to.
  const props = (await l.entity(id))?.props ?? {};
  const paths = Object.fromEntries(others.filter((o) => o.path && reader.links?.[o.id]).map((o) => [o.id, o.path]));
  return { ...reader, sections: sections.map((s) => s.id), lenses, types, path: pathOf(props.path), menu: typeof props.menu === 'number' ? props.menu : null, ...(Object.keys(paths).length && { paths }) };
}

/** An address word: lowercase letters and digits, words joined by single dashes. */
export const PATH = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const pathOf = (value: unknown) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !PATH.test(value) || value.length > 60) throw new Error(`"${value}" cannot be an address: use lowercase letters, digits and single dashes, such as how-it-works.`);
  return value;
};

/** Whether two answers say the same, whatever order their keys are kept in (the database keeps its own). */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(JSON.parse(JSON.stringify(a)))) === JSON.stringify(canon(b));

/** Publish a document as it stands: it becomes public, and what anyone reads of it is this, until it is published again. */
export async function publish(l: Archipelago, actor: Actor, id: string) {
  const doc = ID.test(id) ? await l.entity(id) : null;
  if (!doc || !readable(l).includes(doc.type)) throw new Error(`"${id}" is not a document that can be public.`);
  if (doc.archived_at) throw new Error(`"${doc.title}" is archived.`);
  pathOf(doc.props.path);
  if (doc.visibility !== 'public') await l.apply(actorId(actor), { ops: [{ op: 'update', id, visibility: 'public' }], reason: 'Published, for anyone to read' });
  const given = await freeze(l, id);
  if (given.path) {
    const { rows } = await l.db.query<{ title: string }>(`select given ->> 'title' as title from published where path = $1 and entity_id <> $2`, [given.path, id]);
    if (rows[0]) throw new Error(`"${rows[0].title}" is already published at /${given.path}: give this one another path.`);
  }
  const by = actor.person ?? actorId(actor);
  await l.db.transaction(async (tx) => {
    await tx.query(
      `insert into published (entity_id, workspace, given, published_by, path, menu) values ($1, $2, $3::jsonb, $4, $5, $6)
       on conflict (entity_id) do update set given = excluded.given, published_by = excluded.published_by, path = excluded.path, menu = excluded.menu, published_at = now()`,
      [id, l.workspace, JSON.stringify(given), by, given.path, given.menu],
    );
    await l.log(tx, { actor: actorId(actor), action: 'document.publish', target: id, reason: 'Published as it stands', detail: { sections: given.sections.length, lenses: Object.keys(given.lenses).length } });
  });
  return { published: id, sections: given.sections.length, lenses: Object.keys(given.lenses).length, ...(given.path && { path: given.path }) };
}

/** Take a document down: it is shared again, and its address answers nothing. */
export async function unpublish(l: Archipelago, actor: Actor, id: string) {
  const doc = await l.entity(id);
  if (!doc) throw new Error(`No item "${id}".`);
  await l.db.transaction(async (tx) => {
    await tx.query(`delete from published where entity_id = $1`, [id]);
    await l.log(tx, { actor: actorId(actor), action: 'document.unpublish', target: id, reason: 'No longer published' });
  });
  if (doc.visibility === 'public') await l.apply(actorId(actor), { ops: [{ op: 'update', id, visibility: 'shared' }], reason: 'No longer published' });
  return { unpublished: id };
}

/** Whether a document is published, when and by whom, and whether its draft now says something else. */
export async function publishedState(l: Archipelago, id: string) {
  const { rows } = await l.db.query<{ given: Record<string, unknown>; published_by: string; published_at: Date }>(`select given, published_by, published_at from published where entity_id = $1`, [id]);
  if (!rows[0]) return { published: false };
  const now = await freeze(l, id).catch(() => null);
  return { published: true, at: rows[0].published_at, by: rows[0].published_by, changed: !now || !same(now, rows[0].given) };
}

/** A published document as anyone reads it, or null. Read through one narrow function: nothing of the map as it is now. */
export async function publishedDocument(l: Archipelago, id: string) {
  if (!ID.test(id)) return null;
  const { rows } = await l.forAnyone().db.query<{ doc: Record<string, unknown> | null }>(`select pelago_published($1, $2::text[]) as doc`, [id, readable(l)]);
  return rows[0]?.doc ?? null;
}

/** The figure of one section a published document holds, or null. */
export async function publishedPicture(l: Archipelago, id: string, section: string): Promise<{ content_type: string; bytes: Buffer } | null> {
  if (!ID.test(id) || !ID.test(section)) return null;
  const { rows } = await l.forAnyone().db.query<{ content_type: string; data: string }>(
    `select content_type, encode(bytes, 'base64') as data from pelago_published_picture($1, $2::text[], $3)`,
    [id, readable(l), section],
  );
  return rows[0] ? { content_type: rows[0].content_type, bytes: Buffer.from(rows[0].data, 'base64') } : null;
}

/** The published document at an address word, as anyone reads it, or null. */
export async function publishedAt(l: Archipelago, path: string) {
  if (!PATH.test(path)) return null;
  const { rows } = await l.forAnyone().db.query<{ doc: Record<string, unknown> | null }>(`select pelago_published_at($1, $2::text[]) as doc`, [path, readable(l)]);
  return rows[0]?.doc ?? null;
}

/** A site's published pages, for its header and its sitemap: id, title as published, path and place. */
export async function sitePages(l: Archipelago): Promise<{ id: string; title: string; path: string | null; menu: number | null; published_at: string }[]> {
  const { rows } = await l.forAnyone().db.query<{ pages: never[] }>(`select pelago_site_pages($1::text[]) as pages`, [readable(l)]);
  return rows[0]?.pages ?? [];
}
