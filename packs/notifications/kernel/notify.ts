// A notification for the human: something they should know or act on that is not itself a change to the map, so it
// needs no approval. Made by the write root (root.notify, which only this pack may call): on the map that asks, as the
// one who sends it, past the rules, and told to the packs that hear notification.made. Another internal pack notifies
// by this pack's name, act.report.notify; the kernel through the adapter at packs/notifications/kernel/notify.ts.

import type { KernelContext } from '#pelago/kernel';

/** Who sends a notification, as the kernel hands it (packs/write/kernel/pelago-types.ts, Actor): only what the log names it by. */
export interface Sender {
  kind: 'human' | 'agent';
  name: string;
}

/** What a notification says. */
export interface Notice {
  title: string;
  body?: string;
  level?: 'info' | 'warning' | 'urgent';
  about?: string;
}

/** Send the human a notification, as `actor`. Not a fact about the world, so it needs no approval. */
export async function notify(ctx: KernelContext, actor: Sender, input: Notice): Promise<{ notification: string }> {
  const { title, body, level, about } = input;
  return ctx.call('root.notify', { actor: { kind: actor.kind, name: actor.name }, title, ...(body !== undefined && { body }), ...(level !== undefined && { level }), ...(about !== undefined && { about }) });
}

/** act.report.notify: a notification another internal pack sends, as the sender it names. */
export const notifyAct = (ctx: KernelContext, input: Notice & { actor: Sender }) => notify(ctx, input.actor, input);
