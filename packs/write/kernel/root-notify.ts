// The root service root.notify (docs/kernel-packs.md, "Root services"): a notification for the human, which is no fact
// about the world and so needs no approval. It is applied past the rules as the one who sends it, on the map that asks
// (as that map's viewer sees it), and when the system sends it about something private, it goes to that thing's owner
// only. The packs that hear notification.made are told (the loader's pack host), not waited for. Only the
// notifications pack calls it (packs/roots.json); everyone else notifies through that pack.

import type { RootCall } from '../../loader/kernel/root-calls.ts';
import { ownerOf } from '../../walls/kernel/notify-mail.ts';
import { bypassingRls } from '../../walls/kernel/outbox.ts';
import { actorId, type Actor } from './pelago-types.ts';

/** What a notification says, and who sends it. */
export interface NotifyAsk {
  actor: Pick<Actor, 'kind' | 'name'>;
  title: string;
  body?: string;
  level?: 'info' | 'warning' | 'urgent';
  about?: string;
}

const LEVELS = ['info', 'warning', 'urgent'];

/** Make the notification on the calling map, as its sender: answers its id. */
export async function notifyOf(call: RootCall, ask: NotifyAsk): Promise<{ notification: string }> {
  const l = call.map;
  if (!l) throw new Error('root.notify notifies on a map: call it from one');
  const { actor, title, body, level, about: aboutId } = ask ?? ({} as NotifyAsk);
  if (!actor || (actor.kind !== 'human' && actor.kind !== 'agent') || typeof actor.name !== 'string' || !actor.name) throw new Error('root.notify is sent by someone: an actor, human or agent, with a name');
  if (typeof title !== 'string' || (body !== undefined && typeof body !== 'string') || (level !== undefined && !LEVELS.includes(level)) || (aboutId !== undefined && typeof aboutId !== 'string')) throw new Error('root.notify takes a title, and a body, a level and an item it is about if any');
  const from = actorId(actor as Actor);
  const about = aboutId ? await l.entity(aboutId) : undefined;
  if (aboutId && !about) throw new Error(`No item "${aboutId}"`);
  const { created } = await l.apply(from, {
    ops: [
      // A notification from someone's agent is for that someone, whatever the workspace default.
      { op: 'create', ref: 'n', type: 'notification', title, body, visibility: 'private', props: { level: level ?? 'info', from } },
      ...(aboutId ? [{ op: 'link' as const, type: 'about', from: 'n', to: aboutId }] : []),
    ],
    reason: 'Notification',
  });
  // Sent by the system about something private (a quiet session, say): it goes to that thing's owner only.
  if (!l.viewer && about) await l.operational(created.n, { reach: { private_to: about.private_to } });
  // The packs that hear it are told, and may carry it further (the walls' mail gate): not waited for.
  const forWhom = l.viewer || about?.private_to || (await ownerOf(await bypassingRls(l))) || null;
  const { hostFor } = await import('../../loader/kernel/packtools.ts');
  hostFor(l.registry).tell(l, 'kernel', { action: 'notification.made', target: created.n, detail: { for: forWhom, title, body: body ?? '', level: level ?? 'info', about: aboutId ?? null } });
  return { notification: created.n };
}
