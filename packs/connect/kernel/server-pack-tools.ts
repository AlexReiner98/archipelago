// What the owner is shown of the server's packs: each with what it may ask for, and those left out, with why. The
// server's folders are the loader's: read through the root service root.server_packs (packs/roots.json lets this pack
// call it). The tool itself is wired at the old path (src/server-pack-tools.ts), which hands this its context.

import type { KernelContext } from '#pelago/kernel';

/** What the server_packs tool says of itself: the adapter at the old path gives it its input and run. */
export const SERVER_PACKS_TOOL = {
  description: 'The server packs this server runs, each with the acts it may ask for, its public pages and entries and its webhooks, and those left out with why. For an admin of the default workspace.',
  humanOnly: true,
} as const;

/** The server packs and those left out, for an admin of the default workspace only. */
export async function serverPacks(ctx: KernelContext, who: { admin?: boolean }): Promise<unknown> {
  if (ctx.workspace !== 'default' || !who.admin) throw new Error('Only an admin of the default workspace sees the server packs.');
  return ctx.call('root.server_packs', {});
}
