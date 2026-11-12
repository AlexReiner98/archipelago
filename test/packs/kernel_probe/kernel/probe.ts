// A service pack's module: it imports types alone, and is handed a KernelContext for each call.
import type { KernelContext } from '#pelago/kernel';

type Op = { op: string; ref?: string; type?: string; title?: string };

/** write.follow: for each task a change makes, one more task that says it was seen. Ops in, ops out. */
export function follow(_ctx: KernelContext, ops: Op[]): Op[] {
  return ops.filter((o) => o.op === 'create' && o.type === 'task').map((o, i) => ({ op: 'create', ref: `seen${i}`, type: 'task', title: `Seen: ${o.title}` }));
}

/** service:probe.echo: what it was given, and who answered. */
export function echo(ctx: KernelContext, input: { said: string }) {
  return { said: input.said, by: ctx.pack.id };
}

/** A timer: a change made on the pack's own authority, then read back through the context. */
export async function tick(ctx: KernelContext) {
  const done = (await ctx.change({ reason: 'The probe ticked', basis: 'its timer', ops: [{ op: 'create', ref: 't', type: 'task', title: 'Probe ticked' }] })) as { status: string; created?: Record<string, string> };
  const id = done.created?.t;
  return { status: done.status, id, read: id ? await ctx.reads({ get: id }) : undefined };
}
