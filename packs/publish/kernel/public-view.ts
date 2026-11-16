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
import { takeBaked, withBaked } from './published-baked.ts';

export { freeze, sharedState, sharedViews, sharePlan } from './public-view-freeze.ts';

/**
 * Make `id` public as it stands, in place of any public view of it before: frozen now, kept at its address. A person
 * always; an agent where the rules let it publish (root.may, core's agent_publish: with holds off, at once), its answer
 * saying the stakes.
 */
export async function share(ctx: KernelContext, actor: Actor, id: string) {
  const stakes = await mayPublic(ctx, actor, 'publish');
  // With each layout kept on the map that the page baked just before (./published-baked.ts), as its SVG.
  const frozen = withBaked(await freeze(ctx, id), takeBaked(ctx.workspace, id));
  const look = await ctx.call<unknown, Record<string, unknown>>('page.look', { ...frozen, id });
  // Kept with the marks its reader's part draws it with (./page-marks.ts).
  const given = { ...frozen, style_at: (await ctx.reads({ log_head: true })) as number, look, ...(await pageMarks(ctx, 'page.doc', { ...frozen, ...look }, { published: true })) };
  const by = actor.person ?? actorId(actor);
  await ctx.call('root.publish', { act: 'share', id, actor: actorId(actor), by, given, detail: { shows: shownIn(frozen).length } });
  republished(ctx.workspace, id);
  const address = publicPath(ctx.workspace, id);
  return { shared: id, address, shows: shownIn(frozen).length, ...(given.path && { path: given.path }), ...(stakes.length && { stakes: [`Public now at ${address}: anyone on the internet can read it, and search engines may keep a copy.`, ...stakes, 'share_revoke takes it down; a copy already read or indexed stays out of reach.'] }) };
}

/** What the rules say of this actor publishing or taking down (root.may): refused, or the stakes of the rules that let it through. */
async function mayPublic(ctx: KernelContext, actor: Actor, act: 'publish' | 'unpublish'): Promise<string[]> {
  if (actor.may && actor.may !== 'change') throw new Error('This token may only propose: ask for it to be made public (ask, action share_ask).');
  const said = await ctx.call<unknown, unknown>('root.may', { act, human: actor.kind === 'human' });
  return Array.isArray(said) ? (said as string[]) : [];
}

/** Take a public view down: its address answers nothing. The item itself is left as it is. */
export async function unshare(ctx: KernelContext, actor: Actor, id: string) {
  const stakes = await mayPublic(ctx, actor, 'unpublish');
  const gone = await ctx.call<unknown, boolean>('root.publish', { act: 'unshare', id, actor: actorId(actor) });
  if (!gone) throw new Error(`"${id}" has no public view.`);
  republished(ctx.workspace, id);
  return { unshared: id, ...(stakes.length && { stakes }) };
}
