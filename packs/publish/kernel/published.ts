// Publishing a document: what anyone reads at /p/<workspace>/<id> is the document as it was when a person last
// published it, frozen (packs/database/kernel/public-schema.ts, PUBLISHED). The draft is edited on the map, privately or not; nothing
// public changes until it is published again. A human publishes; an agent only where the workspace's owner has
// allowed it (agent_publish, a rule of the core pack the owner lifts on the Workspace page), each time logged with the
// authority it said it acted on. Taking a document down stays the human's.
//
// Who may is the rules' (root.may); the rows a reader is given, the event that says it and the item's visibility are
// written by the root that keeps those rows (root.publish, the database's), as the one publishing. What publishing
// freezes, its plan and its state are ./published-freeze.ts, re-exported here for those that read them.

import type { KernelContext } from '#pelago/kernel';
import { actorId, authorityOf, itemOf, publishable, type Actor, type Said } from './map.ts';
import { freezeDocument, pathOf, publishPlan } from './published-freeze.ts';
import { republished } from './published-live.ts';

const ID = /^e_[a-z0-9]{8}$/;

export { gist, picturesOf } from './published-pictures.ts';
export { freezeDocument, PATH, pathOf, publishedState, publishPlan, wouldPublish } from './published-freeze.ts';

/**
 * Whether this actor may publish here: a human always, an agent where no rule refuses it (core's agent_publish, lifted
 * by the owner). A token that may only propose never does: publishing is not held, and it asks with publish_ask.
 */
async function mayPublish(ctx: KernelContext, actor: Actor) {
  if (actor.may && actor.may !== 'change') throw new Error('This token may only propose: ask for the document to be published (ask, action publish_ask).');
  await ctx.call('root.may', { act: 'publish', human: actor.kind === 'human' });
}

/** Publish a document as it stands: it becomes public, and what anyone reads of it is this, until it is published again. */
export async function publish(ctx: KernelContext, actor: Actor, id: string, said?: Said) {
  await mayPublish(ctx, actor);
  const authority = authorityOf(actor.kind === 'human', actorId(actor), said);
  const doc = ID.test(id) ? await itemOf(ctx, id) : null;
  if (!doc || !(await publishable(ctx)).types.includes(doc.type)) throw new Error(`"${id}" is not a document that can be public.`);
  if (doc.archived_at) throw new Error(`"${doc.title}" is archived.`);
  pathOf(doc.props.path);
  if (doc.visibility !== 'public') await ctx.call('root.publish', { act: 'visibility', id, actor: actorId(actor), visibility: 'public', authority });
  // Drawn as the map's styles stand now (the styles pack's page.look), kept with it until it is published again.
  const frozen = await freezeDocument(ctx, id);
  const given = { ...frozen, style_at: (await ctx.reads({ log_head: true })) as number, look: await ctx.call('page.look', { ...frozen, id }) };
  const by = actor.person ?? actorId(actor);
  // What a reader is given is its public view: publishing a document shares it as it stands.
  await ctx.call('root.publish', { act: 'publish', id, actor: actorId(actor), by, given, detail: { sections: given.sections.length, lenses: Object.keys(given.lenses).length, authority } });
  // A page open on it with ?live draws it anew.
  republished(ctx.workspace, id);
  return { published: id, sections: given.sections.length, lenses: Object.keys(given.lenses).length, ...(given.path && { path: given.path }) };
}

/** Take a document down: it is shared again, and its address answers nothing. Only a human may (core's agent_unpublish). */
export async function unpublish(ctx: KernelContext, actor: Actor, id: string) {
  await ctx.call('root.may', { act: 'unpublish', human: actor.kind === 'human' });
  const doc = await itemOf(ctx, id);
  if (!doc) throw new Error(`No item "${id}".`);
  await ctx.call('root.publish', { act: 'unpublish', id, actor: actorId(actor) });
  if (doc.visibility === 'public') await ctx.call('root.publish', { act: 'visibility', id, actor: actorId(actor), visibility: 'shared' });
  return { unpublished: id };
}

/** A published document as anyone reads it, or null. Read through one narrow function: nothing of the map as it is now. */
export const publishedDocument = async (ctx: KernelContext, id: string) => (ID.test(id) ? ((await ctx.reads({ published_doc: id })) as Record<string, unknown> | null) : null);

/**
 * Publish every document an item holds, then publish them again, so each links to the others at the addresses they
 * now have. One that cannot be published (its path is taken) is said, and the rest go ahead.
 */
export async function publishAll(ctx: KernelContext, actor: Actor, within: string, said?: Said) {
  await mayPublish(ctx, actor);
  const { documents } = await publishPlan(ctx, within);
  if (!documents.length) throw new Error('It holds no document that can be published.');
  const refused = new Map<string, string>();
  for (const pass of [1, 2])
    for (const doc of documents.filter((d) => !refused.has(d.id)))
      await publish(ctx, actor, doc.id, said).catch((err: Error) => pass === 1 && refused.set(doc.id, err.message));
  return {
    published: documents.filter((d) => !refused.has(d.id)).map((d) => ({ id: d.id, title: d.title })),
    ...(refused.size && { refused: documents.filter((d) => refused.has(d.id)).map((d) => ({ id: d.id, title: d.title, error: refused.get(d.id) })) }),
  };
}
