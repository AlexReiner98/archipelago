// The root service root.connections (docs/kernel-packs.md, "Root services"): what a workspace may connect of the
// server packs (./server-connect.ts), for the connect pack's connections tool. The server packs and the control
// database are the server's, so the surface answers: which are offered and whether each is ready and connected here,
// where to go to connect or ready one, and ending one, its event logged on the calling map as the one who ended it.
// Who may start, ready or end one (a workspace admin) is the tool's to check before it asks.

import type { RootCall } from '../../loader/kernel/root-calls.ts';
import { begin, dropConnections } from './server-connect.ts';
import type { ServerPacks } from './server-host.ts';

/** The server's packs, set by the server when it starts. */
let serverPacks: ServerPacks | undefined;
export function configureConnections(packs: ServerPacks | undefined): void {
  serverPacks = packs;
}

/** What the connections tool asks: the list (with whether this admin may ready one), ending a pack's connection here, or where to start one. */
export type ConnectionsAsk =
  | { list: { admin?: boolean } }
  | { end: { pack?: string; actor: string } }
  | { start: { pack?: string; purpose: 'connect' | 'setup' } };

export async function connectionsOf(call: RootCall, ask: ConnectionsAsk): Promise<unknown> {
  const l = call.map;
  if (!l) throw new Error('root.connections answers for a workspace: call it from its map');
  const packs = serverPacks;
  const offered = (packs?.packs ?? []).filter((p) => p.file.reach.server.connect);
  if ('list' in ask)
    return Promise.all(
      offered.map(async ({ file }) => {
        const connected = (await packs!.connectionOf(file.id, l.workspace)) ?? null;
        const status = ((await packs!.call(file.id, 'entry', file.reach.server.connect!.status, { workspace: l.workspace, connection: connected?.id ?? null }).catch((err) => ({ ready: false, why: (err as Error).message }))) ?? {}) as { ready?: boolean; name?: string; why?: string };
        const ready = Boolean(status.ready);
        return { pack: file.id, title: file.title, ready, name: status.name ?? null, can_setup: !ready && Boolean(file.reach.server.connect!.setup) && Boolean(ask.list?.admin) && l.workspace === 'default', connected: connected && { id: connected.id, account: connected.account } };
      }),
    );
  const named = 'end' in ask ? ask.end?.pack : 'start' in ask ? ask.start?.pack : undefined;
  if (!('end' in ask) && !('start' in ask)) throw new Error('root.connections lists, ends or starts');
  const control = packs && (await packs.control());
  const pack = offered.find((p) => p.file.id === named)?.file;
  if (!pack || !packs || !control) throw new Error(`Nothing here connects by the name "${named ?? ''}".`);
  if ('end' in ask) {
    for (const c of await dropConnections(control, pack.id, { workspace: l.workspace }))
      await l.log(l.db, { actor: ask.end.actor, action: 'connection.ended', reason: `Disconnected ${pack.title}${c.account ? ` (${c.account})` : ''}`, detail: { pack: pack.id, connection: c.id } });
    return { ended: true };
  }
  const purpose = ask.start.purpose === 'setup' ? 'setup' : 'connect';
  if (purpose === 'setup' && (!pack.reach.server.connect!.setup || l.workspace !== 'default')) throw new Error(`${pack.title} is readied for the whole server from the default workspace, by its admin.`);
  const state = await begin(control, pack.id, purpose, l.workspace);
  const answer = (await packs.call(pack.id, 'entry', pack.reach.server.connect!.start, { purpose, state, workspace: l.workspace })) as { url?: string } | null;
  if (!answer?.url) throw new Error(`${pack.title} gave nowhere to go.`);
  return { url: answer.url };
}
