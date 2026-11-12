// A public view (decision e_nwdn7ce6): a view or an item made public by a person, frozen as they saw it when they
// shared it, at /p/<workspace>/<id> for anyone and search engines, and at its address word on its site's domain. It
// replaces links with a secret, guests' frozen links and, in time, publishing. Kept and read by
// src/public-view-store.ts.
//
// This is the kernel's half (docs/kernel-packs.md, Publishing and baking): making a view public and taking it down.
// What it would hold, its plan and where it stands are the publish pack's (packs/publish/kernel/public-view-freeze.ts),
// re-exported here for those that read them.

import { headOf } from './log.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import { publicPath } from './published-data.ts';
import { republished } from './published-live.ts';
import { freeze, shownIn } from './public-view-freeze.ts';
import { keepPublicView } from './public-view-store.ts';
import { pageLook } from './styles.ts';

export { freeze, shareAsk, sharedState, sharedViews, sharePlan } from './public-view-freeze.ts';

/**
 * Make `id` public as it stands, in place of any public view of it before: frozen now, kept at its address. A person's
 * alone (the tool is human only): an agent asks with shareAsk.
 */
export async function share(l: Archipelago, actor: Actor, id: string) {
  if (actor.kind !== 'human') throw new Error('Only a person makes a view public: ask them (ask, action share_ask).');
  const frozen = await freeze(l, id);
  const given = { ...frozen, style_at: (await headOf(l.db)).pos, look: await pageLook(l, { ...frozen, id }) };
  if (given.path) {
    const { rows } = await l.db.query<{ title: string }>(`select given ->> 'title' as title from public_view where path = $1 and entity_id <> $2`, [given.path, id]);
    if (rows[0]) throw new Error(`"${rows[0].title}" is already public at /${given.path}: give this one another path.`);
  }
  const by = actor.person ?? actorId(actor);
  await l.db.transaction(async (tx) => {
    await keepPublicView(tx, l.workspace, id, given, by);
    await l.log(tx, { actor: actorId(actor), action: 'view.share', target: id, reason: 'Made public as it stands', detail: { shows: shownIn(frozen).length } });
  });
  republished(l.workspace, id);
  return { shared: id, address: publicPath(l.workspace, id), shows: shownIn(frozen).length, ...(given.path && { path: given.path }) };
}

/** Take a public view down: its address answers nothing. The item itself is left as it is. */
export async function unshare(l: Archipelago, actor: Actor, id: string) {
  const gone = await l.db.transaction(async (tx) => {
    const { rows } = await tx.query(`delete from public_view where entity_id = $1 returning entity_id`, [id]);
    if (rows.length) await l.log(tx, { actor: actorId(actor), action: 'view.unshare', target: id, reason: 'No longer public' });
    return rows.length > 0;
  });
  if (!gone) throw new Error(`"${id}" has no public view.`);
  republished(l.workspace, id);
  return { unshared: id };
}
