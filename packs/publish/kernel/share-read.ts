// What the publish pack's part on an item's menu reads (packs/publish/parts/share): the item's public view, when a
// person shared it, by its address, and whether the item is a document anyone may read whole, and so print. Read as
// the person looking, under row-level security, through the reads every publish read goes through.

import type { KernelContext } from '#pelago/kernel';
import { itemOf, publishable } from './map.ts';
import { sharedViews } from './public-view-freeze.ts';

/** answer.shared: the item's public view (its address, when it was shared) and whether it is a document. */
export async function sharedOf(ctx: KernelContext, input: { id: string }) {
  const [view] = await sharedViews(ctx, input.id);
  const item = await itemOf(ctx, input.id);
  const document = Boolean(item && (await publishable(ctx)).types.includes(item.type));
  return { ...(view && { address: view.address, shared_at: view.shared_at }), document };
}
