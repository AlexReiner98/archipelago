// A document shared with another workspace on this server, rather than with whoever holds a link. Each side keeps
// control of its own part. The sender's admin chooses the document and the workspace, and can revoke it. The receiving
// workspace has to accept offers from the sender at all (accepts_from, as for notifications); it holds the share as an
// item of its own (shared_document), which someone there accepts before it can be read, can keep private or
// share with everyone there, and can end. Nothing is copied: each read goes to the sender's map through one function
// that gives that document and what it brings in to that workspace, while the share stands, and nothing else.

import { forReader, readDocument, revokeShare, SHARED, type Given } from './documents.ts';
import { newId, type Q } from './db.ts';
import { notify } from './notify.ts';
import { acceptedSenders, otherMap } from './outbox.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import { picturesOf } from './published-pictures.ts';
import { unpublishShare } from './published-share.ts';

// ---- the sending side ----------------------------------------------------

/**
 * Share a document with another workspace: it arrives there as an offer, and nothing is read until it is accepted.
 * With publish, the admin also lets that workspace publish it, as this map gives it (src/published-share.ts).
 */
export async function shareWithWorkspace(l: Archipelago, actor: Actor, input: { id: string; workspace: string; publish?: boolean }) {
  if (actor.kind !== 'human' || !actor.admin) throw new Error('Only an admin can share a document with another workspace.');
  if (input.workspace === l.workspace) throw new Error('That is this workspace: whoever may see the document here can read it already.');
  const doc = await l.entity(input.id);
  if (!doc || doc.type === SHARED || !l.registry.drawnWith('document').includes(doc.type)) throw new Error(`"${input.id}" is not a document of this workspace: only one can be shared.`);
  if (doc.archived_at) throw new Error(`"${doc.title}" is archived.`);
  const target = await otherMap(input.workspace);
  // One answer for "no such workspace" and "it does not accept you": nothing to probe.
  if (!target || !(await acceptedSenders(target)).includes(l.workspace))
    throw new Error(`Workspace "${input.workspace}" does not accept shares from "${l.workspace}". Its admin has to add "${l.workspace}" to the workspaces it accepts.`);
  const share = newId('s');
  const from = `workspace:${l.workspace}/${actor.name}`;
  const { created } = await target.apply(from, {
    ops: [{ op: 'create', ref: 'd', type: SHARED, title: doc.title.slice(0, 60), status: 'offered', visibility: 'shared', body: `From the workspace "${l.workspace}". Set it to accepted to read it here; it is read from there each time.${input.publish ? ' It may be published here.' : ''}`, props: { from_workspace: l.workspace, share } }],
    reason: `Shared by the workspace "${l.workspace}"`,
  });
  try {
    await l.db.transaction(async (tx: Q) => {
      await tx.query(`insert into share (id, workspace, hint, entity_id, made_by, to_workspace, to_item, publishable) values ($1, $2, $3, $4, $5, $6, $7, $8)`, [share, l.workspace, input.workspace, doc.id, actor.person ?? actorId(actor), input.workspace, created.d, input.publish === true]);
      await l.log(tx, { actor: actorId(actor), action: 'share.workspace', target: doc.id, reason: `Shared with the workspace "${input.workspace}"`, detail: { share, to: input.workspace, publish: input.publish === true } });
    });
  } catch (err) {
    await target.apply('system', { ops: [{ op: 'archive', id: created.d }], reason: 'The share could not be recorded where it was made' }).catch(() => null);
    throw err;
  }
  await notify(target, { kind: 'agent', name: from }, { title: `"${doc.title}" was shared with this workspace`, about: created.d, body: `From the workspace "${l.workspace}". Accept it to read it here.` });
  return { share, workspace: input.workspace, publish: input.publish === true, note: `Offered to "${input.workspace}": it can be read there once someone there accepts it${input.publish ? ', and published there' : ''}, until it is revoked.` };
}

/**
 * Stop a link or a share with a workspace. A workspace's copy of the share is marked ended, so it is not left offered,
 * and taken down where it was published: what it may publish ends with the share.
 */
export async function endShare(l: Archipelago, actor: Actor, share: string) {
  const done = await revokeShare(l, actor, share);
  if (done.to_workspace && done.to_item) {
    const target = await otherMap(done.to_workspace);
    await target?.apply('system', { ops: [{ op: 'update', id: done.to_item, status: 'ended' }], reason: `The workspace "${l.workspace}" stopped sharing it` }).catch(() => null);
    if (target) await unpublishShare(target, done.to_item).catch(() => null);
  }
  return { revoked: done.revoked, document: done.document };
}

// ---- the receiving side --------------------------------------------------

/** The map that shares an item, and its share, while the item is accepted here. */
async function sharer(item: { status: string; props: Record<string, unknown> }) {
  if (item.status !== 'accepted') return undefined;
  const from = await otherMap(String(item.props.from_workspace ?? ''));
  return from && { from, share: String(item.props.share ?? '') };
}

/** A document read whole: one of this map's own, or one shared with it, read from the map that shares it. */
export async function readAny(l: Archipelago, id: string) {
  const item = await l.entity(id);
  if (item?.type !== SHARED) return readDocument(l, id);
  const at = await sharer(item);
  if (!at) throw new Error(item.status === 'offered' ? `"${item.title}" is offered by "${item.props.from_workspace}": accept it to read it here.` : `"${item.title}" is no longer shared with this workspace.`);
  const { rows } = await at.from.forAnyone().db.query<{ doc: Given | null }>(`select pelago_workspace_document($1, $2) as doc`, [at.share, l.workspace]);
  if (!rows[0]?.doc) throw new Error(`"${item.title}" is no longer shared with this workspace: "${item.props.from_workspace}" revoked it.`);
  return { ...forReader(at.from, rows[0].doc, item.id), id: item.id, from: item.props.from_workspace };
}

/**
 * The views a shared document brings in, drawn on the map that shares it as publishing here would keep them
 * (src/published-share.ts), so it is reviewed as it will publish. Only where it may be published: a share to be read
 * gives its sections, not pictures of the sender's map.
 */
export async function sharedPictures(l: Archipelago, id: string, sections: { id: string; type: string }[]) {
  const item = await l.entity(id);
  const at = item?.type === SHARED ? await sharer(item) : undefined;
  if (!at) return {};
  const { rows } = await at.from.forAnyone().db.query<{ publishable: boolean }>(`select pelago_workspace_publishable($1, $2) as publishable`, [at.share, l.workspace]);
  return rows[0]?.publishable ? picturesOf(at.from, sections, true) : {};
}

/** The figure of one section of a shared document, or null. */
export async function sharedFigure(l: Archipelago, input: { via: string; id: string }) {
  const item = await l.entity(input.via);
  const at = item?.type === SHARED ? await sharer(item) : undefined;
  if (!at || !/^e_[a-z0-9]{8}$/.test(input.id)) return null;
  const { rows } = await at.from.forAnyone().db.query<{ content_type: string; data: string }>(
    `select content_type, encode(bytes, 'base64') as data from pelago_workspace_picture($1, $2, $3)`,
    [at.share, l.workspace, input.id],
  );
  return rows[0] ? { result: input.id, content_type: rows[0].content_type, data: rows[0].data.replaceAll('\n', '') } : null;
}
