// What the connections part reads and sends (packs/connect/parts/connections), in the server's process as an internal
// pack's view and actions are (pack.json kernel.provides). The read lists what this server offers to connect a
// workspace to; the two actions are an admin's (connect.start, connect.end), so the part sends them only on an admin's
// own press, its grant checked before they run (packs/loader/kernel/press-grants.ts, decision e_ssrawn4v). Each answers
// with no ops: what it does is the server's (root.connections), outside the map's log of changes.

import type { KernelContext } from '#pelago/kernel';

/** One server pack, as the part draws it. */
export interface Offered { pack: string; title: string; ready: boolean; name: string | null; can_setup: boolean; connected: { id: string; account: string | null } | null }

/**
 * answer.connections: what this server offers to connect, each with whether it is ready and connected here. Whether
 * one can be readied here (`can_setup`) is said as the server sees it; only an admin is offered it (the part reads
 * `admin`), and only an admin's press sends it.
 */
export async function connectionsListed(ctx: KernelContext): Promise<{ packs: Offered[] }> {
  return { packs: await ctx.call<unknown, Offered[]>('root.connections', { list: { admin: true } }) };
}

type Caller = { kind: string; name: string };

/** act.revise.start: where to go to connect a pack here, or to ready it for the whole server (setup). */
export async function startAct(ctx: KernelContext, input: { pack?: unknown; setup?: unknown }) {
  const pack = typeof input?.pack === 'string' ? input.pack : undefined;
  const { url } = await ctx.call<unknown, { url: string }>('root.connections', { start: { pack, purpose: input?.setup === true ? 'setup' : 'connect' } });
  return { ops: [], reason: `Start connecting ${pack ?? ''}`, answer: { url, ...(await connectionsListed(ctx)) } };
}

/** act.revise.end: stop a pack's connection here, recorded as the one who ended it. */
export async function endAct(ctx: KernelContext, input: { pack?: unknown }, caller?: Caller) {
  const pack = typeof input?.pack === 'string' ? input.pack : undefined;
  await ctx.call('root.connections', { end: { pack, actor: caller?.name ?? 'human' } });
  return { ops: [], reason: `Disconnected ${pack ?? ''}`, answer: { ended: true, ...(await connectionsListed(ctx)) } };
}
