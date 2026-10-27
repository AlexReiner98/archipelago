// Publishing a document: what anyone reads at /p/<workspace>/<id> is the document as it was when a person last
// published it, frozen (src/public-schema.ts, PUBLISHED). The draft is edited on the map, privately or not; nothing
// public changes until it is published again. A human publishes; an agent only where the workspace's owner has
// allowed it (agent_publish, a rule of the core pack the owner lifts on the Workspace page), each time logged with the authority it said it acted on.
// Taking a document down stays the human's.
//
// What is frozen is what the public read gives (src/public-document.ts), and for each view kept on the map it brings
// in, the picture's data (src/lens-saved.ts) with nothing private in it and nothing that names a person or a session.

import { authorityOf } from './authority.ts';
import { drawingFor } from './drawings.ts';
import { notify } from './notify.ts';
import { actorId, type Actor, type Archipelago, type Authority } from './pelago.ts';
import { SHARED } from './documents.ts';
import { publicDocument, readable } from './public-document.ts';
import { picturesOf } from './published-pictures.ts';
import { freezeShared } from './published-share.ts';
import { republished } from './published-live.ts';
import { mayDo } from './rules.ts';

const ID = /^e_[a-z0-9]{8}$/;

export { gist, picturesOf } from './published-pictures.ts';
/**
 * What a reader would be given of a public document now: what the public read gives (src/public-document.ts: the
 * sections it holds that are shared, the rest only by name and state), and for each lens among them its picture,
 * with nothing private in it.
 */
async function freeze(l: Archipelago, id: string) {
  // One another workspace shares with this one is frozen as that workspace gives it.
  const item = await l.entity(id);
  if (item?.type === SHARED) return { ...(await freezeShared(l, item)), path: pathOf(item.props.path), menu: typeof item.props.menu === 'number' ? item.props.menu : null };
  // The other documents published here, which it may name by id and a reader then opens at their own pages.
  const { rows: others } = await l.db.query<{ id: string; title: string; path: string | null }>(
    `select e.id, e.title, p.path from published p join entity e on e.id = p.entity_id
     where p.entity_id <> $1 and e.visibility = 'public' and e.archived_at is null and e.private_to is null`,
    [id],
  );
  const reader = await publicDocument(l, id, new Map(others.map((o) => [o.id, o.title])));
  if (!reader) throw new Error(`"${id}" is not a public document.`);
  const sections = reader.parts.flatMap((part) => ('section' in part ? [part.section] : []));
  const { lenses, types } = await picturesOf(l, sections, true);
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

type Said = Pick<Authority, 'of' | 'basis'>;

/** Whether this actor may publish here: a human always, an agent where no rule refuses it (core's agent_publish, lifted by the owner). */
const mayPublish = (l: Archipelago, actor: Actor) => mayDo(l.db, l.registry, actor.kind === 'human', 'publish');

/** Publish a document as it stands: it becomes public, and what anyone reads of it is this, until it is published again. */
export async function publish(l: Archipelago, actor: Actor, id: string, said?: Said) {
  await mayPublish(l, actor);
  const authority = authorityOf(actor.kind === 'human', actorId(actor), said);
  const doc = ID.test(id) ? await l.entity(id) : null;
  if (!doc || !readable(l).includes(doc.type)) throw new Error(`"${id}" is not a document that can be public.`);
  if (doc.archived_at) throw new Error(`"${doc.title}" is archived.`);
  pathOf(doc.props.path);
  // A shared one is frozen first: whether its sender lets it be published is known before it is made public.
  const early = doc.type === SHARED ? await freeze(l, id) : null;
  if (doc.visibility !== 'public') await l.apply(actorId(actor), { ops: [{ op: 'update', id, visibility: 'public' }], reason: 'Published, for anyone to read' }, { authority });
  const given = early ?? (await freeze(l, id));
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
    await l.log(tx, { actor: actorId(actor), action: 'document.publish', target: id, reason: 'Published as it stands', detail: { sections: given.sections.length, lenses: Object.keys(given.lenses).length, authority } });
  });
  // A page open on it with ?live draws it anew.
  republished(l.workspace, id);
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
  return withDrawings(l, rows[0]?.doc ?? null);
}

/**
 * A published document with a drawing for each picture frozen before its shape had one: the pack's own drawing for
 * that shape, or the flow's, as the page drew such a picture then. A page published since keeps the drawing it was
 * published with.
 */
function withDrawings(l: Archipelago, doc: Record<string, unknown> | null) {
  const lenses = doc?.lenses as Record<string, { lens?: { time?: unknown }; style?: Record<string, unknown> }> | undefined;
  if (!doc || !lenses) return doc;
  const given = Object.fromEntries(
    Object.entries(lenses).map(([id, frozen]) => {
      const style = frozen.style ?? {};
      // One whose style has code of its own is drawn by its shape's drawing here, as the page drew it by its shape before.
      if (style.drawing) return [id, frozen];
      // A picture on a time axis was drawn along it, unless it was a grid or a flow.
      const shape = frozen.lens?.time && !['grid', 'flow'].includes(String(style.shape)) ? 'time' : String(style.shape);
      const drawing = drawingFor(l.registry, { shape }, []) ?? drawingFor(l.registry, { shape: 'flow' }, []);
      return [id, drawing ? { ...frozen, style: { ...style, drawing } } : frozen];
    }),
  );
  return { ...doc, lenses: given };
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
  return withDrawings(l, rows[0]?.doc ?? null);
}

/** A site's published pages, for its header and its sitemap: id, title as published, path and place. */
export async function sitePages(l: Archipelago): Promise<{ id: string; title: string; path: string | null; menu: number | null; published_at: string }[]> {
  const { rows } = await l.forAnyone().db.query<{ pages: never[] }>(`select pelago_site_pages($1::text[]) as pages`, [readable(l)]);
  return rows[0]?.pages ?? [];
}

/** The open documents an item holds, at any depth, of the types that can be public: what Publish all publishes. */
async function heldDocuments(l: Archipelago, within: string) {
  const { rows } = await l.db.query<{ id: string; title: string }>(
    `with recursive down(id, depth) as (
       select $1::text, 0
       union select r.from_id, d.depth + 1 from relation r join down d on r.to_id = d.id
       where r.type = 'part_of' and r.valid_to is null and d.depth < 8
     )
     select e.id, e.title from entity e where e.id in (select id from down where depth > 0)
       and e.type = any($2::text[]) and e.is_open and e.archived_at is null order by e.title`,
    [within, readable(l)],
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

/**
 * Publish every document an item holds, then publish them again, so each links to the others at the addresses they
 * now have. One that cannot be published (its path is taken) is said, and the rest go ahead.
 */
export async function publishAll(l: Archipelago, actor: Actor, within: string, said?: Said) {
  await mayPublish(l, actor);
  const { documents } = await publishPlan(l, within);
  if (!documents.length) throw new Error('It holds no document that can be published.');
  const refused = new Map<string, string>();
  for (const pass of [1, 2])
    for (const doc of documents.filter((d) => !refused.has(d.id)))
      await publish(l, actor, doc.id, said).catch((err: Error) => pass === 1 && refused.set(doc.id, err.message));
  return {
    published: documents.filter((d) => !refused.has(d.id)).map((d) => ({ id: d.id, title: d.title })),
    ...(refused.size && { refused: documents.filter((d) => refused.has(d.id)).map((d) => ({ id: d.id, title: d.title, error: refused.get(d.id) })) }),
  };
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
