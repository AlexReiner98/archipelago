// surface.tools: the tools this pack declares to the surface (packs/surface/kernel/tools.ts), each its input a JSON
// shape and run on this pack's context of the map it is called on: a system's requests for a token (./token-ask.ts),
// the server's packs (./server-pack-tools.ts) and the connections a workspace may make (./connection-tools.ts).

import type { KernelContext } from '#pelago/kernel';
import { CONNECTION_TOOLS } from './connection-tools.ts';
import { SERVER_PACKS_TOOL, serverPacks } from './server-pack-tools.ts';
import { ASK_TOOLS } from './token-ask.ts';

export const tools = () => ({
  ...ASK_TOOLS,
  server_packs: { ...SERVER_PACKS_TOOL, input: {}, run: async (ctx: KernelContext, actor: { admin?: boolean }) => serverPacks(ctx, { admin: actor.admin }) },
  ...CONNECTION_TOOLS,
});
