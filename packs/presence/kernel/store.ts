// The workspace's transient store, as this pack reaches it: the root service root.transient (packs/surface), which
// keeps and reads it as the whole workspace. Copied in each pack that keeps there; it is three lines.

import type { KernelContext } from '#pelago/kernel';

type Row = { key: string; value: unknown };

export const keep = (ctx: KernelContext, key: string, value: unknown, ms: number): Promise<void> => ctx.call('root.transient', { keep: { key, value, ms } });
export const kept = <T>(ctx: KernelContext, key: string): Promise<T | undefined> => ctx.call('root.transient', { kept: key });
/** What is kept under some keys and under some prefixes, but for some keys, at once. */
export const scan = (ctx: KernelContext, keys: string[], prefixes: string[], except: string[]): Promise<Row[]> => ctx.call('root.transient', { scan: { keys, prefixes, except } });
