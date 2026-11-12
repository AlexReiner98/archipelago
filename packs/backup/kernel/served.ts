// The backups the surface's server runs while it leads (surface.backup, packs/surface/kernel/above.ts): handed a server
// duty's context of the server's workspaces, which reaches them through the root services alone.

import type { KernelContext } from '#pelago/kernel';
import { backupAll, backupDuty, type BackupPlan, type UploadTarget } from './backup-run.ts';

export const served = (ctx: KernelContext) => ({
  duty: (plan: BackupPlan) => backupDuty(ctx, plan),
  all: (dir: string, keep: number, upload?: UploadTarget) => backupAll(ctx, dir, keep, upload),
});
