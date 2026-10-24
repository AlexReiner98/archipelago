// What the owner is shown of the server's packs: each with what it may ask for, and those left out, with why.

import type { Tool } from './tools.ts';
import { loadServerPacks } from './server-packs.ts';

export const SERVER_PACK_TOOLS: Record<string, Tool> = {
  server_packs: {
    description: 'The server packs this server runs, each with the acts it may ask for, its public pages and entries and its webhooks, and those left out with why. For an admin of the default workspace.',
    humanOnly: true,
    input: {},
    run: async (l, actor) => {
      if (l.workspace !== 'default' || !actor.admin) throw new Error('Only an admin of the default workspace sees the server packs.');
      const { packs, refused } = loadServerPacks();
      return {
        packs: packs.map(({ file }) => ({ id: file.id, title: file.title, version: file.version, acts: file.reach.server.acts ?? [], pages: (file.reach.server.pages ?? []).map((p) => p.id), entries: (file.reach.server.entries ?? []).map((e) => e.id), webhooks: (file.reach.webhooks ?? []).map((w) => w.id) })),
        refused,
      };
    },
  },
};
