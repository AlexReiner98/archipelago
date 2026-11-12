// How much each thing a pack declares is used on a workspace, counted as it happens: a view asked, an instruction
// said, a rule that held, refused or asked. Only how many, per thing per day, never by whom: held in the server's
// memory and written each minute to the kernel's uses stream as counts are, kept five weeks (core's rule uses), added
// to through root.uses (docs/kernel-packs.md, "Root services"). The Packs screen reads the last 30 days of it beside
// each declaration (pack-use.ts).

import type { KernelContext } from '#pelago/kernel';

/** The stream the uses are kept in. */
export const USES = 'uses';

/** What a use is of: a view asked, an instruction said, a rule that held, refused or asked an agent. */
export type UseKind = 'view' | 'told' | 'held' | 'refused' | 'asked';

/** A use's key in the stream: its kind and the declaration's id (a rule's as pack.rule). */
export const useKey = (kind: UseKind, id: string) => `${kind}:${id}`;

/**
 * Count one use of a declaration: on the context's workspace, or, for a caller that names only a workspace (the
 * kernel's, through the server's context: src/uses.ts), on that one.
 */
export async function used(ctx: KernelContext, kind: UseKind, id: string, n = 1, workspace = ctx.workspace): Promise<void> {
  if (id) await ctx.call('root.uses', { workspace, add: [{ key: useKey(kind, id.replace(/\s/g, '_')), n }] });
}
