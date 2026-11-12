// Moved to packs/publish/kernel/public-route.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the publish pack's context of it,
// made when it is called (kernelContext).
// A route has no map until its workspace is found: one the server does not hold is handed a context of none
// (serverContext), which reaches only the root services.

import type { Archipelago } from './pelago.ts';
import type { Workspaces } from './workspaces.ts';
import * as moved from '../packs/publish/kernel/public-route.ts';

export * from '../packs/publish/kernel/public-route.ts';

/** The publish pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'publish');

/** Answer a GET under /p/ for a product, as the workspace it names is held here, or not. */
export const servePublic = async (res: moved.Reply, match: Parameters<typeof moved.servePublic>[2], at: { workspaces: Workspaces }) => {
  const pelago = (await at.workspaces.has(match.workspace)) ? (await at.workspaces.get(match.workspace)).pelago : null;
  const context = pelago ? await ctx(pelago) : (await import('./kernel-context.ts')).serverContext('publish', at.workspaces);
  return moved.servePublic(context, res, match);
};
