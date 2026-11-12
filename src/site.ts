// Moved to packs/publish/kernel/site.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the pack's context of it, made
// when it is called (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import type { Workspaces } from './workspaces.ts';
import * as moved from '../packs/publish/kernel/site.ts';

export * from '../packs/publish/kernel/site.ts';

/** The publish pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'publish');

/** The site of a workspace the server holds, named as the server lists it. */
export const siteNav = async (workspaces: Workspaces, workspace: string, href: (page: { id: string; path: string | null }) => string | null) => {
  const { pelago } = await workspaces.get(workspace);
  const name = (await workspaces.list()).find((ws) => ws.id === workspace)?.name ?? workspace;
  return moved.siteNav(await ctx(pelago), name, href);
};
