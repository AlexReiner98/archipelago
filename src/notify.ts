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
  return { notification: created.n };
}
