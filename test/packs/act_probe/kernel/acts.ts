// A service pack's fillings of the surface's slots: each export is named for the action or read it fills.
import type { KernelContext } from '#pelago/kernel';

type Caller = { kind: string; name: string };

/** surface.act probe_act: what it was given, who asked, and which pack answered. */
export function probe_act(ctx: KernelContext, input: { said: string }, who: Caller) {
  return { said: input.said, who: who.name, by: ctx.pack.id };
}

/** surface.read probe_read: a read through the pack's context. */
export async function probe_read(ctx: KernelContext, input: { id: string }) {
  return ctx.reads({ get: input.id });
}
