// The root service root.due (docs/kernel-packs.md, "Root services"): the clock's one event, item.due, recorded on the
// map's activity stream as the kernel's and told to the sandboxed packs that hear it (PackHost.tell). Only the pack
// packs/roots.json names for it calls it (the clocks pack); it records no other kind of event, as no other actor.

import { hostFor } from './packtools.ts';
import type { RootCall } from './root-calls.ts';

/** What came due, as the clock tells it: the item, why, and what the hearers are given. */
export interface DueEvent { target: string; reason: string; detail: Record<string, unknown> }

/** root.due: record that an item came due and tell the packs that hear item.due. Answers the event's seq. */
export async function dueOf(call: RootCall, input: DueEvent): Promise<{ seq: number | null }> {
  const l = call.map;
  if (!l) throw new Error('root.due records on a map: call it from one');
  if (typeof input?.target !== 'string' || typeof input.reason !== 'string' || typeof input.detail !== 'object' || input.detail === null) throw new Error('root.due takes { target, reason, detail }');
  const told = { action: 'item.due', target: input.target, reason: input.reason, detail: input.detail };
  const seq = await l.log(l.db, { actor: 'agent:pelago', ...told });
  hostFor(l.registry).tell(l, 'kernel', { ...told, seq });
  return { seq: seq ?? null };
}
