// Publishing a document another workspace shares with this one (src/workspace-share.ts): only where the admin who
// shares it said it may be published, and only while the share stands. What is frozen is what the share shows,
// given by the sender's map, its views drawn there as the sender would publish them: nothing private, nothing of the
// sender's that the document does not bring in. Revoking the share takes it down here (unpublishShare).

import { forReader, SHARED, type Given } from './documents.ts';
import { otherMap } from './outbox.ts';
import type { Archipelago, Entity } from './pelago.ts';
import { picturesOf } from './published-pictures.ts';

const ID = /\be_[a-z0-9]{8}\b/g;

/** What a reader of this workspace's site is given of a shared document now, as the workspace that shares it gives it. */
export async function freezeShared(l: Archipelago, item: Entity) {
  const workspace = String(item.props.from_workspace ?? '');
  const share = String(item.props.share ?? '');
  const from = item.status === 'accepted' ? await otherMap(workspace) : undefined;
  if (!from) throw new Error(item.status === 'offered' ? `"${item.title}" is offered by "${workspace}": accept it before publishing it.` : `"${item.title}" is no longer shared with this workspace.`);
  const anyone = from.forAnyone().db;
  const { rows } = await anyone.query<{ doc: Given | null; publishable: boolean }>(`select pelago_workspace_document($1, $2) as doc, pelago_workspace_publishable($1, $2) as publishable`, [share, l.workspace]);
  const given = rows[0]?.doc;
  if (!given) throw new Error(`"${item.title}" is no longer shared with this workspace: "${workspace}" revoked it.`);
  if (!rows[0].publishable) throw new Error(`"${workspace}" shares "${item.title}" to be read here, not published: its admin can share it again to be published.`);
  // The other documents it shares that are published here, which this one may name by its own ids: named here by theirs.
  const { rows: others } = await l.db.query<{ id: string; title: string; path: string | null; source: string }>(
    `select p.entity_id as id, e.title, p.path, p.given ->> 'source' as source from published p join entity e on e.id = p.entity_id
     where p.entity_id <> $1 and e.type = $2 and e.visibility = 'public' and e.archived_at is null and p.given ->> 'from' = $3`,
    [item.id, SHARED, workspace],
  );
  const here = new Map(others.filter((o) => o.source).map((o) => [o.source, o]));
  const named = (text: string) => text.replace(ID, (id) => here.get(id)?.id ?? id);
  const doc = { ...given, body: named(given.body), items: given.items.map((s) => ({ ...s, body: named(s.body), picture: false })) };
  const reader = forReader(from, doc, undefined, new Map(others.map((o) => [o.id, o.title])));
  const sections = reader.parts.flatMap((part) => ('section' in part ? [part.section] : []));
  const { lenses, types } = await picturesOf(from, sections, true);
  const paths = Object.fromEntries(others.filter((o) => o.path && reader.links?.[o.id]).map((o) => [o.id, o.path]));
  return { ...reader, source: given.id, from: workspace, sections: sections.map((s) => s.id), lenses, types, ...(Object.keys(paths).length && { paths }) };
}

/** Take a shared document down here, once the workspace that shares it has stopped sharing it. */
export async function unpublishShare(l: Archipelago, id: string) {
  const gone = await l.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ entity_id: string }>(`delete from published where entity_id = $1 returning entity_id`, [id]);
    if (rows.length) await l.log(tx, { actor: 'system', action: 'document.unpublish', target: id, reason: 'The workspace that shared it stopped sharing it' });
    return rows.length > 0;
  });
  if (!gone) return;
  await l.apply('system', { ops: [{ op: 'update', id, visibility: 'shared' }], reason: 'No longer published: the workspace that shared it stopped sharing it' });
}
