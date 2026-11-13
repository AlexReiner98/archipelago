// A public view (decision e_nwdn7ce6): a view or an item made public by a person, frozen as they saw it when they
// shared it, at /p/<workspace>/<id> for anyone and search engines, and at its address word on its site's domain. It
// replaces links with a secret, guests' frozen links and, in time, publishing. Kept and read by
// packs/database/kernel/public-view-store.ts.
//
// Making a view public and taking it down: the rows and the event that says it are written by the root that keeps
// them (root.publish, the database's). What it would hold, its plan and where it stands are ./public-view-freeze.ts,
// re-exported here for those that read them.

import type { KernelContext } from '#pelago/kernel';
import { actorId, type Actor } from './map.ts';
import { publicPath } from './published-data.ts';
import { republished } from './published-live.ts';
import { pageMarks } from './page-marks.ts';
import { freeze, shownIn } from './public-view-freeze.ts';

export { freeze, sharedState, sharedViews, sharePlan } from './public-view-freeze.ts';

/**
 * Make `id` public as it stands, in place of any public view of it before: frozen now, kept at its address. A person's
 * alone (the tool is human only): an agent asks with share_ask.
 */
export async function share(ctx: KernelContext, actor: Actor, id: string) {
  if (actor.kind !== 'human') throw new Error('Only a person makes a view public: ask them (ask, action share_ask).');
  const frozen = await freeze(ctx, id);
  const look = await ctx.call<unknown, Record<string, unknown>>('page.look', { ...frozen, id });
  // Kept with the marks its reader's part draws it with (./page-marks.ts).
  const given = { ...frozen, style_at: (await ctx.reads({ log_head: true })) as number, look, ...(await pageMarks(ctx, 'page.doc', { ...frozen, ...look }, { published: true })) };
  const by = actor.person ?? actorId(actor);
  await ctx.call('root.publish', { act: 'share', id, actor: actorId(actor), by, given, detail: { shows: shownIn(frozen).length } });
  republished(ctx.workspace, id);
  return { shared: id, address: publicPath(ctx.workspace, id), shows: shownIn(frozen).length, ...(given.path && { path: given.path }) };
}

/** Take a public view down: its address answers nothing. The item itself is left as it is. */
export async function unshare(ctx: KernelContext, actor: Actor, id: string) {
  const gone = await ctx.call<unknown, boolean>('root.publish', { act: 'unshare', id, actor: actorId(actor) });
  if (!gone) throw new Error(`"${id}" has no public view.`);
  republished(ctx.workspace, id);
  return { unshared: id };
}
