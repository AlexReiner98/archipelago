// Notifications between workspaces. Each workspace is its own database, so a
// message has to be handed across by the server. Two rules keep that safe: a
// workspace receives only from workspaces its admin has chosen to accept, and
// only a human can send, because this is one organisation speaking to another.

import { actorId, type Actor, type Archipelago } from './pelago.ts';
import { notify } from './notify.ts';

/** Hands back another workspace's map, or undefined if there is no such workspace. */
type Lookup = (workspace: string) => Promise<Archipelago | undefined>;

let lookup: Lookup | undefined;

export function configureOutbox(next: Lookup): void {
  lookup = next;
}

/** The whole of a map, not one person's view of it, for the few things an admin does to all of it. */
export async function wholeMap(l: Archipelago): Promise<Archipelago> {
  if (l.viewer === undefined) return l;
  const whole = await lookup?.(l.workspace);
  if (!whole) throw new Error('This server cannot reach the whole workspace.');
  return whole;
}

export async function acceptedSenders(l: Archipelago): Promise<string[]> {
  return (await l.setting<string[]>('accepts_from')) ?? [];
}

export async function notifyWorkspace(l: Archipelago, actor: Actor, input: { workspace: string; title: string; body?: string; level?: 'info' | 'warning' | 'urgent' }) {
  if (actor.kind !== 'human') throw new Error('Only a human can send a notification to another workspace.');
  if (input.workspace === l.workspace) throw new Error('That is this workspace. Use notify.');
  const target = await lookup?.(input.workspace);
  // One answer for "no such workspace" and "it does not accept you": nothing to probe.
  const refused = new Error(`Workspace "${input.workspace}" does not accept notifications from "${l.workspace}". Its admin has to add "${l.workspace}" to the workspaces it accepts.`);
  if (!target || !(await acceptedSenders(target)).includes(l.workspace)) throw refused;
  // Delivered by the system into the other map, shared with everyone there.
  const sender = `${l.workspace}/${actor.name}`;
  const delivered = await notify(target, { kind: 'agent', name: `workspace:${sender}` }, { title: input.title, body: input.body, level: input.level });
  await target.db.query(`update entity set visibility = 'shared', private_to = null where id = $1`, [delivered.notification]);
  await l.log(l.db, { actor: actorId(actor), action: 'workspace.notify', reason: input.title, detail: { to: input.workspace, level: input.level ?? 'info' } });
  return { delivered_to: input.workspace };
}
