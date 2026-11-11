import { ownerOf } from './notify-mail.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';

/** Send the human a notification. Not a fact about the world, so it needs no approval. */
export async function notify(l: Archipelago, actor: Actor, input: { title: string; body?: string; level?: 'info' | 'warning' | 'urgent'; about?: string }) {
  const about = input.about ? await l.entity(input.about) : undefined;
  if (input.about && !about) throw new Error(`No item "${input.about}"`);
  const { created } = await l.apply(actorId(actor), {
    ops: [
      // A notification from someone's agent is for that someone, whatever the workspace default.
      { op: 'create', ref: 'n', type: 'notification', title: input.title, body: input.body, visibility: 'private', props: { level: input.level ?? 'info', from: actorId(actor) } },
      ...(input.about ? [{ op: 'link' as const, type: 'about', from: 'n', to: input.about }] : []),
    ],
    reason: 'Notification',
  });
  // Sent by the system about something private (a quiet session, say): it goes to that thing's owner only.
  if (!l.viewer && about) await l.operational(created.n, { reach: { private_to: about.private_to } });
  // The packs that hear it are told, and may carry it further (src/notify-mail.ts): not waited for.
  if (made) made(l, { action: 'notification.made', target: created.n, detail: { for: l.viewer || about?.private_to || (await ownerOf(l)) || null, title: input.title, body: input.body ?? '', level: input.level ?? 'info', about: input.about ?? null } });
  return { notification: created.n };
}

/** Who is told that a notification was made: the packs, set by src/packtools.ts, which this module cannot import. */
type Made = (l: Archipelago, e: { action: string; target: string; detail: Record<string, unknown> }) => void;
let made: Made | undefined;
export const onNotificationMade = (fn: Made | undefined) => void (made = fn);
