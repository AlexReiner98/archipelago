// The links a run lives in its place by, read off the registry alone: a small pure helper, copied from the runs pack's
// places (packs/runs/kernel/places.ts) rather than imported, as a pack imports no other pack.

import type { KernelContext } from '#pelago/kernel';

type Reg = Pick<KernelContext, 'registry'>;

/** The link that ties a thing to this place: of the relations that are a kind of lives_in, the nearest one its type is made for. */
export function livesInFor(ctx: Reg, placeType: string): string {
  const lineage = ctx.registry.type(placeType)?.lineage ?? [placeType];
  const fits = ctx.registry
    .relationFamily('lives_in')
    .map((id) => ctx.registry.relations.get(id)!)
    .map((r) => ({ id: r.id, at: Math.min(...r.to.map((t) => (t === '*' ? lineage.length : lineage.indexOf(t))).filter((i) => i >= 0)) }))
    .filter((r) => Number.isFinite(r.at));
  return fits.sort((a, b) => a.at - b.at)[0]?.id ?? 'lives_in';
}

/** The relations a thing lives in a place by, read whichever flavour tied it. */
export const livesIn = (ctx: Reg) => ctx.registry.relationFamily('lives_in');

/** The place a run lives in, if it is tied to one: the first such link's end. */
export async function placeOf(ctx: KernelContext, run: string): Promise<string | undefined> {
  const [link] = (await ctx.reads({ links: { from: [run], types: livesIn(ctx), limit: 1 } })) as { to_id: string }[];
  return link?.to_id;
}

/** Every place a run lives in. */
export async function placesOf(ctx: KernelContext, run: string): Promise<string[]> {
  return ((await ctx.reads({ links: { from: [run], types: livesIn(ctx) } })) as { to_id: string }[]).map((r) => r.to_id);
}
