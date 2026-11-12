// The read of the reads API the usage pack answers (surface's slot surface.reads): an instruction counted as said.
// Handed the context of the map that asks; each use is counted through root.uses a moment later, never awaited, as
// the kernel counted it before (packs/usage/kernel/uses.ts).

import type { KernelContext } from '#pelago/kernel';
import { used } from './uses.ts';

/** `told: [id...]`: each instruction said (a preset's id, or a kept one's) counted once; answered true. */
export async function told(ctx: KernelContext, q: { told: unknown }): Promise<true> {
  if (!Array.isArray(q.told) || q.told.some((id) => typeof id !== 'string')) throw new Error('told is a list of ids');
  for (const id of q.told as string[]) void used(ctx, 'told', id).catch((err: Error) => ctx.said(`counting a use on ${ctx.workspace} failed: ${err.message}`));
  return true;
}
