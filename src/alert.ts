// Moved to packs/alerts/kernel/alert.ts (docs/kernel-packs.md, "Where each module goes"). What took the map is adapted
// here: the alerts pack's context of that map is built when it is called. What has no map (a mail to the owner, a crash)
// is handed a server duty's context (serverContext), which calls root services alone: the mail goes through the walls.
export * from '../packs/alerts/kernel/alert.ts';
import * as moved from '../packs/alerts/kernel/alert.ts';
import type { Archipelago } from './pelago.ts';
import type { RootCall } from './root-calls.ts';

const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'alerts');
/** A crash walks no workspace: the server duty's context is handed none. */
const none = async (): Promise<never> => { throw new Error('the alerts pack walks no workspace'); };
const NO_WORKSPACES: NonNullable<RootCall['workspaces']> = { get: none, isOpen: () => false, hold: () => () => undefined, closeIfUnused: none, list: async () => [] } as never;
const duty = async () => (await import('./kernel-context.ts')).serverContext('alerts', NO_WORKSPACES);

export const alertOwner = async (l: Archipelago, alert: moved.Alert) => moved.alertOwner(await ctx(l), alert);
export const mailOwner = async (subject: string, text: string) => moved.mailOwner(await duty(), subject, text);
export const alertOnCrash = (where: string) => moved.alertOnCrash(duty, where);
