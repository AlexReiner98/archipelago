// Moved to the backup pack (docs/kernel-packs.md, "Where each module goes"): what took the map or the server's
// workspaces is adapted here, building the pack's context when it is called.
export * from '../packs/backup/kernel/backup-run.ts';
import * as moved from '../packs/backup/kernel/backup-run.ts';
import type { Archipelago } from './pelago.ts';
import type { Workspaces } from './workspaces.ts';

/** A backup merged into a map: give it the whole map. */
export const merge = async (l: Archipelago, ...rest: Parameters<typeof moved.merge> extends [unknown, ...infer R] ? R : never) =>
  moved.merge((await import('./kernel-context.ts')).kernelContext(l, 'backup'), ...rest);

/** Every workspace backed up: a server duty, its context the server's workspaces. */
export const backupAll = async (workspaces: Workspaces, ...rest: Parameters<typeof moved.backupAll> extends [unknown, ...infer R] ? R : never) =>
  moved.backupAll((await import('./kernel-context.ts')).serverContext('backup', workspaces), ...rest);

/** The backup server duty, run while this server leads: started once its context is made, and stopped by what this answers. */
export const backupDuty = (workspaces: Workspaces, plan: moved.BackupPlan): (() => void) => {
  let stop: (() => void) | undefined;
  let stopped = false;
  void import('./kernel-context.ts').then((k) => {
    if (!stopped) stop = moved.backupDuty(k.serverContext('backup', workspaces), plan);
  });
  return () => {
    stopped = true;
    stop?.();
  };
};
