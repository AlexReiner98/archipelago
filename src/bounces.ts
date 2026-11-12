// Moved to packs/mailer/kernel/bounces.ts (docs/kernel-packs.md, "Where each module goes"). What kept and read the
// addresses in a database is adapted here: it is handed the map whose store keeps them (the default workspace's), and
// the pack's context of that map reaches the store through root.transient.
export * from '../packs/mailer/kernel/bounces.ts';
import * as moved from '../packs/mailer/kernel/bounces.ts';
import type { Archipelago } from './pelago.ts';

const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'mailer');
export const noteBounced = async (l: Archipelago, emails: string[]) => moved.noteBounced(await ctx(l), emails);
export const hasBounced = async (l: Archipelago, email: string) => moved.hasBounced(await ctx(l), email);
