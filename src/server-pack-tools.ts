// Moved to packs/connect/kernel/server-pack-tools.ts (docs/kernel-packs.md, "Where each module goes"): the tool, which
// took the map, is wired here, building the pack's context when it is called.
export * from '../packs/connect/kernel/server-pack-tools.ts';
import * as moved from '../packs/connect/kernel/server-pack-tools.ts';
import type { Tool } from './tools.ts';

export const SERVER_PACK_TOOLS: Record<string, Tool> = {
  server_packs: {
    ...moved.SERVER_PACKS_TOOL,
    input: {},
    run: async (l, actor) => moved.serverPacks((await import('./kernel-context.ts')).kernelContext(l, 'connect'), { admin: actor.admin }),
  },
};
