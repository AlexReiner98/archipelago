// A service pack's actions under a verb of its own, run in-process: each export is named for its action.
import type { KernelContext } from '#pelago/kernel';

type Caller = { kind: string; name: string };

/** surface.act ping (verb_probe.ping, under probe): what it was given, who asked, and which pack answered. */
export function ping(ctx: KernelContext, input: { said: string }, who: Caller) {
  return { said: input.said, who: who.name, by: ctx.pack.id };
}

/** surface.act hush (verb_probe.hush): for a person alone. */
export function hush() {
  return { hushed: true };
}
