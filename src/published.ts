// Publishing a document: what anyone reads at /p/<workspace>/<id> is the document as it was when a person last
// published it, frozen (src/public-schema.ts, PUBLISHED). The draft is edited on the map, privately or not; nothing
// public changes until it is published again. A human publishes; an agent only where the workspace's owner has
// allowed it (agent_publish, a rule of the core pack the owner lifts on the Workspace page), each time logged with the authority it said it acted on.
// Taking a document down stays the human's.
//
// This is the kernel's half (docs/kernel-packs.md, Publishing and baking): publishing, taking down, and the public
// reads through their narrow functions, behind the rules and the walls. What publishing freezes, its plan and its
// state are the publish pack's (packs/publish/kernel/published-freeze.ts), re-exported here for those that read them.

import { authorityOf } from './authority.ts';
import { headOf } from './log.ts';
import { actorId, type Actor, type Archipelago, type Authority } from './pelago.ts';
import { readable } from './public-document.ts';
import { freezeDocument, PATH, pathOf, publishPlan } from './published-freeze.ts';
import { republished } from './published-live.ts';
import { drawingsGiven, keepPublicView } from './public-view-store.ts';

import { mayDo } from './rules.ts';
import { pageLook } from './styles.ts';

const ID = /^e_[a-z0-9]{8}$/;

export { gist, picturesOf } from './published-pictures.ts';
export { freezeDocument, PATH, pathOf, publishAsk, publishedState, publishPlan, wouldPublish } from './published-freeze.ts';

type Said = Pick<Authority, 'of' | 'basis'>;

/**
 * Whether this actor may publish here: a human always, an agent where no rule refuses it (core's agent_publish, lifted
 * by the owner). A token that may only propose never does: publishing is not held, and it asks with publish_ask.
 */
async function mayPublish(l: Archipelago, actor: Actor) {
  if (actor.may && actor.may !== 'change') throw new Error('This token may only propose: ask for the document to be published (ask, action publish_ask).');
  await mayDo(l.db, l.registry, actor.kind === 'human', 'publish');
}

/** Publish a document as it stands: it becomes public, and what anyone reads of it is this, until it is published again. */
export async function publish(l: Archipelago, actor: Actor, id: string, said?: Said) {
  await mayPublish(l, actor);
  const authority = authorityOf(actor.kind === 'human', actorId(actor), said);
  const doc = ID.test(id) ? await l.entity(id) : null;
  if (!doc || !readable(l).includes(doc.type)) throw new Error(`"${id}" is not a document that can be public.`);
  if (doc.archived_at) throw new Error(`"${doc.title}" is archived.`);
  pathOf(doc.props.path);
  if (doc.visibility !== 'public') await l.apply(actorId(actor), { ops: [{ op: 'update', id, visibility: 'public' }], reason: 'Published, for anyone to read' }, { authority });
  // Drawn as the map's styles stand now (src/styles.ts, pageLook), kept with it until it is published again.
  const frozen = await freezeDocument(l, id);
  const given = { ...frozen, style_at: (await headOf(l.db)).pos, look: await pageLook(l, { ...frozen, id }) };
  if (given.path) {
    const { rows } = await l.db.query<{ title: string }>(
      `select given ->> 'title' as title from published where path = $1 and entity_id <> $2 union all select given ->> 'title' from public_view where path = $1 and entity_id <> $2`,
      [given.path, id],
    );
    if (rows[0]) throw new Error(`"${rows[0].title}" is already published at /${given.path}: give this one another path.`);
  }
  const by = actor.person ?? actorId(actor);
  await l.db.transaction(async (tx) => {
    await tx.query(
      `insert into published (entity_id, workspace, given, published_by, path, menu) values ($1, $2, $3::jsonb, $4, $5, $6)
       on conflict (entity_id) do update set given = excluded.given, published_by = excluded.published_by, path = excluded.path, menu = excluded.menu, published_at = now()`,
      [id, l.workspace, JSON.stringify(given), by, given.path, given.menu],
    );
    // What a reader is given is its public view (src/public-view.ts): publishing a document shares it as it stands.
    await keepPublicView(tx, l.workspace, id, given, by);
    await l.log(tx, { actor: actorId(actor), action: 'document.publish', target: id, reason: 'Published as it stands', detail: { sections: given.sections.length, lenses: Object.keys(given.lenses).length, authority } });
  });
  // A page open on it with ?live draws it anew.
  republished(l.workspace, id);
  return { published: id, sections: given.sections.length, lenses: Object.keys(given.lenses).length, ...(given.path && { path: given.path }) };
}

/** Take a document down: it is shared again, and its address answers nothing. Only a human may (core's agent_unpublish). */
export async function unpublish(l: Archipelago, actor: Actor, id: string) {
  await mayDo(l.db, l.registry, actor.kind === 'human', 'unpublish');
  const doc = await l.entity(id);
  if (!doc) throw new Error(`No item "${id}".`);
  await l.db.transaction(async (tx) => {
    await tx.query(`delete from published where entity_id = $1`, [id]);
    await tx.query(`delete from public_view where entity_id = $1`, [id]);
    await l.log(tx, { actor: actorId(actor), action: 'document.unpublish', target: id, reason: 'No longer published' });
  });
  if (doc.visibility === 'public') await l.apply(actorId(actor), { ops: [{ op: 'update', id, visibility: 'shared' }], reason: 'No longer published' });
  return { unpublished: id };
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
  const lenses = doc?.lenses as Record<string, { style?: Record<string, unknown> }> | undefined;
  if (!doc || !lenses) return doc;
  return { ...doc, lenses: drawingsGiven(l, lenses) };
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
