// The kernel_shelf pack's action, in-process: it answers with ops, as a sandboxed handler does, and the kernel makes
// them so on the caller's authority (packs/loader/kernel/internal-act.ts).

import type { KernelContext } from '#pelago/kernel';

export const put = async (_ctx: KernelContext, input: { title?: string }) => ({
  ops: [{ op: 'create', ref: 'it', type: 'task', title: input.title ?? 'Put' }],
  reason: 'Put on the shelf',
  answer: { item: '{it}' },
});
