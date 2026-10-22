// What the server does on a clock for every workspace at once: backups, and the server packs' schedules (a workspace's
// own packs run theirs in src/hooks.ts). Only the leader does them (src/leader.ts): they start when this process takes
// the lead and stop when it loses it.

import { backupAll, newestBackup } from './backup.ts';
import type { Config } from './config.ts';
import type { Leader } from './leader.ts';
import type { ServerPacks } from './server-host.ts';
import type { Workspaces } from './workspaces.ts';

/** Run the server's duties while `leader` leads. Returns what stops them. */
export function serverDuties(leader: Leader, workspaces: Workspaces, serverPacks: ServerPacks, backup: Config['backup']): () => void {
  // Asked every few minutes whether a backup is due, going by the newest file,
  // so restarting the server neither skips a backup nor piles them up.
  const backupIfDue = async () => {
    if (!backup) return;
    const { dir, everyHours, keep, upload } = backup;
    const newest = newestBackup(dir);
    if (newest && Date.now() - newest.getTime() < everyHours * 3600_000) return;
    for (const r of await backupAll(workspaces, dir, keep, upload)) {
      if (r.error) console.error(`backup of ${r.workspace} FAILED: ${r.error}`);
      else if (r.copied === false) console.error(`backed up ${r.workspace}: ${r.rows} rows, but the copy off the server FAILED: ${r.copy_error}`);
      else console.log(`backed up ${r.workspace}: ${r.rows} rows${r.copied ? ', copied off the server' : ''}`);
    }
  };
  const backupSafely = () => void backupIfDue().catch((err) => console.error('backup failed:', err));

  let timers: NodeJS.Timeout[] = [];
  let stopSchedules = () => {};
  const stop = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
    stopSchedules();
  };
  const start = () => {
    stop();
    backupSafely();
    timers = [setInterval(backupSafely, 5 * 60_000)];
    for (const t of timers) t.unref();
    stopSchedules = serverPacks.runSchedules();
  };
  leader.onChange((leading) => {
    console.log(leading ? 'leading: this server runs the clocks' : 'no longer leading: another server runs the clocks');
    if (leading) start();
    else stop();
  });
  if (leader.leading) start();
  return stop;
}
