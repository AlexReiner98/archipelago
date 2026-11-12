// root.publish (docs/kernel-packs.md, "Root services"): the writes of publishing, which only the root that keeps the
// published and public_view rows (./public-schema.ts) may make, each with the event that says it in one transaction,
// and an item's visibility changed as the person or agent publishing it. Called only by the publish pack
// (packs/roots.json); who may publish is asked of the rules first (root.may). Values in, values out.

import type { RootCall } from '../../../src/root-calls.ts';
import type { Archipelago } from '../../../src/pelago.ts';
import { keepPublicView } from './public-view-store.ts';

type Given = { path?: string | null; menu?: number | null; title?: unknown } & Record<string, unknown>;
type Input =
  | { act: 'visibility'; id: string; actor: string; visibility: 'public' | 'shared'; authority?: Record<string, unknown> }
  | { act: 'publish'; id: string; actor: string; by: string; given: Given; detail: Record<string, unknown> }
  | { act: 'unpublish'; id: string; actor: string }
  | { act: 'share'; id: string; actor: string; by: string; given: Given; detail: Record<string, unknown> }
  | { act: 'unshare'; id: string; actor: string };

const ID = /^e_[a-z0-9]{8}$/;

/** The title of what is already at a path, other than `id`: published or shared, or shared alone. */
async function taken(l: Archipelago, path: string, id: string, published: boolean) {
  const { rows } = await l.db.query<{ title: string }>(
    published
      ? `select given ->> 'title' as title from published where path = $1 and entity_id <> $2 union all select given ->> 'title' from public_view where path = $1 and entity_id <> $2`
      : `select given ->> 'title' as title from public_view where path = $1 and entity_id <> $2`,
    [path, id],
  );
  return rows[0]?.title;
}

/** root.publish: one of publishing's writes, as `act` says. */
export async function publishRows(call: RootCall, input: Input): Promise<unknown> {
  const l = call.map;
  if (!l) throw new Error('root.publish writes a map: a server duty has none');
  // What is kept is kept of an item; what is taken down is taken by whatever id was given, and none is found for a bad one.
  if (!['unpublish', 'unshare'].includes(input?.act) && !ID.test(String(input?.id))) throw new Error(`"${String(input?.id)}" is no item's id.`);
  const { id, actor } = input;
  switch (input.act) {
    case 'visibility': {
      if (input.visibility === 'public') await l.apply(actor, { ops: [{ op: 'update', id, visibility: 'public' }], reason: 'Published, for anyone to read' }, { authority: input.authority as never });
      else if (input.visibility === 'shared') await l.apply(actor, { ops: [{ op: 'update', id, visibility: 'shared' }], reason: 'No longer published' });
      else throw new Error('root.publish sets visibility public or shared');
      return true;
    }
    case 'publish': {
      const { given, by } = input;
      const path = given.path ?? null;
      const at = path && (await taken(l, path, id, true));
      if (at) throw new Error(`"${at}" is already published at /${path}: give this one another path.`);
      await l.db.transaction(async (tx) => {
        await tx.query(
          `insert into published (entity_id, workspace, given, published_by, path, menu) values ($1, $2, $3::jsonb, $4, $5, $6)
           on conflict (entity_id) do update set given = excluded.given, published_by = excluded.published_by, path = excluded.path, menu = excluded.menu, published_at = now()`,
          [id, l.workspace, JSON.stringify(given), by, path, given.menu ?? null],
        );
        // What a reader is given is its public view: publishing a document shares it as it stands.
        await keepPublicView(tx, l.workspace, id, given, by);
        await l.log(tx, { actor, action: 'document.publish', target: id, reason: 'Published as it stands', detail: input.detail });
      });
      return true;
    }
    case 'unpublish': {
      await l.db.transaction(async (tx) => {
        await tx.query(`delete from published where entity_id = $1`, [id]);
        await tx.query(`delete from public_view where entity_id = $1`, [id]);
        await l.log(tx, { actor, action: 'document.unpublish', target: id, reason: 'No longer published' });
      });
      return true;
    }
    case 'share': {
      const { given, by } = input;
      const path = given.path ?? null;
      const at = path && (await taken(l, path, id, false));
      if (at) throw new Error(`"${at}" is already public at /${path}: give this one another path.`);
      await l.db.transaction(async (tx) => {
        await keepPublicView(tx, l.workspace, id, given, by);
        await l.log(tx, { actor, action: 'view.share', target: id, reason: 'Made public as it stands', detail: input.detail });
      });
      return true;
    }
    case 'unshare':
      return l.db.transaction(async (tx) => {
        const { rows } = await tx.query(`delete from public_view where entity_id = $1 returning entity_id`, [id]);
        if (rows.length) await l.log(tx, { actor, action: 'view.unshare', target: id, reason: 'No longer public' });
        return rows.length > 0;
      });
    default:
      throw new Error(`root.publish does not ${String((input as { act?: unknown }).act)}`);
  }
}
