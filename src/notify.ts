import { actorId, type Actor, type Lattice } from './lattice.ts';

/** Send the human a notification. Not a fact about the world, so it needs no approval. */
export async function notify(l: Lattice, actor: Actor, input: { title: string; body?: string; level?: 'info' | 'warning' | 'urgent'; about?: string }) {
  if (input.about && !(await l.entity(input.about))) throw new Error(`No entity "${input.about}"`);
  const { created } = await l.apply(actorId(actor), {
    ops: [
      { op: 'create', ref: 'n', type: 'sys.notification', title: input.title, body: input.body, props: { level: input.level ?? 'info', from: actorId(actor) } },
      ...(input.about ? [{ op: 'link' as const, type: 'about', from: 'n', to: input.about }] : []),
    ],
    reason: 'Notification',
  });
  return { notification: created.n };
}
