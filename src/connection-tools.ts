// What a workspace's admin sees and does of the server packs it may connect (src/server-connect.ts): whether each is
// ready to be connected and whether this workspace has, where to go to connect it, and disconnecting. Readying one
// for the whole server (setup) is the default workspace admin's, once.

import { z } from 'zod';
import { actorId, type Actor } from './pelago.ts';
import { begin, dropConnections } from './server-connect.ts';
import type { ServerPacks } from './server-host.ts';
import type { Tool } from './tools.ts';

/** The server's packs, set by the server. */
let serverPacks: ServerPacks | undefined;
export function configureConnections(packs: ServerPacks | undefined): void {
  serverPacks = packs;
}

const needAdmin = (actor: Actor) => {
  if (!actor.admin) throw new Error('Only a workspace admin can connect what this server offers.');
};

export const CONNECTION_TOOLS: Record<string, Tool> = {
  connections: {
    description:
      'What this server offers to connect a workspace to (each a server pack: GitHub, say), whether each is ready, and whether this workspace has connected it (and to which account outside). ' +
      'start: where to go to connect one (choose there what it is given); setup: where to go to ready one for the whole server, once (an admin of the default workspace only); end: stop it here. Admins only for these.',
    humanOnly: true,
    input: {
      pack: z.string().optional().describe('The server pack to start, set up or end; not needed to see them all.'),
      start: z.boolean().optional(),
      setup: z.boolean().optional(),
      end: z.boolean().optional(),
    },
    run: async (l, actor, input) => {
      const packs = serverPacks;
      const offered = (packs?.packs ?? []).filter((p) => p.file.reach.server.connect);
      const control = packs && (await packs.control());
      const list = async () =>
        Promise.all(
          offered.map(async ({ file }) => {
            const connected = (await packs!.connectionOf(file.id, l.workspace)) ?? null;
            const status = ((await packs!.call(file.id, 'entry', file.reach.server.connect!.status, { workspace: l.workspace, connection: connected?.id ?? null }).catch((err) => ({ ready: false, why: (err as Error).message }))) ?? {}) as { ready?: boolean; name?: string; why?: string };
            const ready = Boolean(status.ready);
            return { pack: file.id, title: file.title, ready, name: status.name ?? null, can_setup: !ready && Boolean(file.reach.server.connect!.setup) && Boolean(actor.admin) && l.workspace === 'default', connected: connected && { id: connected.id, account: connected.account } };
          }),
        );
      if (!input.start && !input.setup && !input.end) return { packs: await list() };
      needAdmin(actor);
      const pack = offered.find((p) => p.file.id === input.pack)?.file;
      if (!pack || !packs || !control) throw new Error(`Nothing here connects by the name "${input.pack ?? ''}".`);
      if (input.end) {
        for (const c of await dropConnections(control, pack.id, { workspace: l.workspace }))
          await l.log(l.db, { actor: actorId(actor), action: 'connection.ended', reason: `Disconnected ${pack.title}${c.account ? ` (${c.account})` : ''}`, detail: { pack: pack.id, connection: c.id } });
        return { packs: await list() };
      }
      const purpose = input.setup ? 'setup' : 'connect';
      if (purpose === 'setup' && (!pack.reach.server.connect!.setup || l.workspace !== 'default')) throw new Error(`${pack.title} is readied for the whole server from the default workspace, by its admin.`);
      const state = await begin(control, pack.id, purpose, l.workspace);
      const answer = (await packs.call(pack.id, 'entry', pack.reach.server.connect!.start, { purpose, state, workspace: l.workspace })) as { url?: string } | null;
      if (!answer?.url) throw new Error(`${pack.title} gave nowhere to go.`);
      return { packs: await list(), url: answer.url };
    },
  },
};
