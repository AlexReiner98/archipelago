// The workspace's transient store, as this pack reaches it: the root service root.transient (packs/surface), which
// keeps and reads it as the whole workspace. Copied in each pack that keeps there; it is three lines.

import type { KernelContext } from '#pelago/kernel';

export const keep = (ctx: KernelContext, key: string, value: unknown, ms: number, data?: Buffer): Promise<void> => ctx.call('root.transient', { keep: { key, value, ms, ...(data && { data }) } });
export const kept = <T>(ctx: KernelContext, key: string): Promise<T | undefined> => ctx.call('root.transient', { kept: key });
/** What is kept under a key, with its bytes. */
export const keptWith = <T>(ctx: KernelContext, key: string): Promise<{ value: T; data?: Buffer } | undefined> => ctx.call('root.transient', { kept: key, data: true });
