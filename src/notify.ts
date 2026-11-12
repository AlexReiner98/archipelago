// Moved to packs/notifications/kernel/notify.ts (docs/kernel-packs.md, "Where each module goes"). What took the map is
// adapted here: the notifications pack's context of that map is built when it is called, and the write root makes the
// notification on that same map (root.notify), as the sender, as the kernel did.
export * from '../packs/notifications/kernel/notify.ts';
import * as moved from '../packs/notifications/kernel/notify.ts';
import type { Archipelago } from './pelago.ts';

const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'notifications');
export const notify = async (l: Archipelago, actor: moved.Sender, input: moved.Notice) => moved.notify(await ctx(l), actor, input);
