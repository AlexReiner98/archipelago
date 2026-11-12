// What a workspace's admin sees and does of the server packs it may connect (packs/surface/kernel/server-connect.ts): whether each is
// ready to be connected and whether this workspace has, where to go to connect it, and disconnecting. Readying one
// for the whole server (setup) is the default workspace admin's, once.
//
// On the connect pack's context: the server's packs and its control database are the surface's, asked through
// root.connections (packs/roots.json lets this pack call it); the tool checks who may act before it asks. Its input is a
// JSON shape the surface builds its schema from; the adapter at packs/connect/kernel/connection-tools.ts hands its run the context.

import type { KernelContext } from '#pelago/kernel';

/** Who acts, as the kernel hands it (packs/write/kernel/pelago-types.ts, Actor): only what is read of it here. */
export interface Admin {
  kind: 'human' | 'agent';
  name: string;
  admin?: boolean;
}

/** A tool as this pack declares it: its input a JSON shape, what each field is for in `says`, run on the pack's context. */
export interface ConnectionTool {
  description: string;
  humanOnly?: boolean;
  input: Record<string, unknown>;
  says?: Record<string, string>;
  run(ctx: KernelContext, actor: Admin, input: any): Promise<unknown>;
}

type Input = { pack?: string; start?: boolean; setup?: boolean; end?: boolean };

export const CONNECTION_TOOLS: Record<string, ConnectionTool> = {
  connections: {
    description:
      'What this server offers to connect a workspace to (each a server pack), whether each is ready, and whether this workspace has connected it (and to which account outside). ' +
      'start: where to go to connect one (choose there what it is given); setup: where to go to ready one for the whole server, once (an admin of the default workspace only); end: stop it here. Admins only for these.',
    humanOnly: true,
    input: { 'pack?': 'string', 'start?': 'boolean', 'setup?': 'boolean', 'end?': 'boolean' },
    says: { pack: 'The server pack to start, set up or end; not needed to see them all.' },
    run: async (ctx, actor, input: Input) => {
      const list = () => ctx.call('root.connections', { list: { admin: Boolean(actor.admin) } });
      if (!input.start && !input.setup && !input.end) return { packs: await list() };
      if (!actor.admin) throw new Error('Only a workspace admin can connect what this server offers.');
      if (input.end) {
        await ctx.call('root.connections', { end: { pack: input.pack, actor: `${actor.kind}:${actor.name}` } });
        return { packs: await list() };
      }
      const { url } = await ctx.call<unknown, { url: string }>('root.connections', { start: { pack: input.pack, purpose: input.setup ? 'setup' : 'connect' } });
      return { packs: await list(), url };
    },
  },
};
