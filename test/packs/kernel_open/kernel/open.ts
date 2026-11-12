// A service pack's open fillings and timer: each says what it saw, on a list the test reads.
import type { KernelContext } from '#pelago/kernel';

const seen: string[] = ((globalThis as { kernelOpenSeen?: string[] }).kernelOpenSeen ??= []);

/** open.begin: the registry is there, with the starter types. */
export function begin(ctx: KernelContext) {
  seen.push(`begin ${ctx.workspace} ${ctx.registry.types.has('task')}`);
}

/** open.ready: the last phase. */
export function ready(ctx: KernelContext) {
  seen.push(`ready ${ctx.workspace}`);
}

/** A timer, run while the server leads. */
export function tick(ctx: KernelContext) {
  seen.push(`tick ${ctx.workspace}`);
}
