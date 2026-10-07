import { actorId, type Actor, type Lattice } from './lattice.ts';

/** Send the human a notification. Not a fact about the world, so it needs no approval. */
export async function notify(l: Lattice, actor: Actor, input: { title: string; body?: string; level?: 'info' | 'warning' | 'urgent'; about?: string }) {
  if (input.about && !(await l.entity(input.about))) throw new Error(`No entity "${input.about}"`);
  const { created } = await l.apply(actorId(actor), {
    ops: [
      // A notification from someone's agent is for that someone, whatever the workspace default.
      { op: 'create', ref: 'n', type: 'sys.notification', title: input.title, body: input.body, visibility: 'private', props: { level: input.level ?? 'info', from: actorId(actor) } },
      ...(input.about ? [{ op: 'link' as const, type: 'about', from: 'n', to: input.about }] : []),
    ],
    reason: 'Notification',
  });
  // Sent by the system about something private (a quiet session, say): it goes to that thing's owner only.
  if (!l.viewer && input.about) await l.db.query(`update entity set private_to = (select private_to from entity where id = $2) where id = $1`, [created.n, input.about]);
  return { notification: created.n };
}
