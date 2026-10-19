// What the server does on a clock for every workspace at once: re-checks, reading pushes left unread, backups. Only
// the leader does them (src/leader.ts): they start when this process takes the lead and stop when it loses it.

import { backupAll, newestBackup } from './backup.ts';
import type { Config } from './config.ts';
import type { GithubApp } from './github-app.ts';
import type { Leader } from './leader.ts';
import { readable, readUnread, recheck } from './reader.ts';
import type { Workspaces } from './workspaces.ts';

/** Run the server's duties while `leader` leads. Returns what stops them. */
export function serverDuties(leader: Leader, workspaces: Workspaces, githubApp: GithubApp, backup: Config['backup']): () => void {
  // Every hour each workspace that connected GitHub is asked, for each repository the app can read, whether a
  // re-check is due (each project says how often); the agent on this server does the ones that are. An hour when
  // nothing is due costs no run. Asked that often because a server that is deployed daily never sees a whole day.
  const recheckAll = async () => {
    // The same hour, and so at every start: what the app is called on GitHub now.
    await githubApp.refresh().catch((err) => console.error(`The GitHub App could not be asked its name: ${(err as Error).message}`));
    for (const { id } of await workspaces.list()) {
      const installation = await githubApp.installationOf(id);
      if (!installation) continue;
      const release = workspaces.hold(id);
      try {
        const { pelago } = await workspaces.get(id);
        for (const repo of await readable(pelago, githubApp, installation.id)) {
          const about = (await githubApp.asInstallation(installation.id, `/repos/${repo.name}`)) as { default_branch?: string };
          const r = await recheck(pelago, githubApp, repo, about.default_branch ?? 'main');
          if (r.ran) console.log(`reader: re-check of ${repo.name}: ${r.ok ? 'done' : 'failed'}, ${r.tokens} tokens`);
        }
      } catch (err) {
        console.error(`reader: re-check in ${id} failed: ${(err as Error).message}`);
      } finally {
        release();
      }
    }
  };
  // A push whose reading was cut off when the last server stopped is read by this one, soon after it is up.
  const readLeftUnread = async () => {
    for (const { id } of await workspaces.list()) {
      const installation = await githubApp.installationOf(id);
      if (!installation) continue;
      const release = workspaces.hold(id);
      try {
        const { pelago } = await workspaces.get(id);
        for (const r of await readUnread(pelago, githubApp, installation.id)) console.log(`reader: caught up on ${r.repo} ${r.branch} (${r.after.slice(0, 7)})`);
      } catch (err) {
        console.error(`reader: catching up in ${id} failed: ${(err as Error).message}`);
      } finally {
        release();
      }
    }
  };
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
  const stop = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
  };
  const start = () => {
    stop();
    backupSafely();
    timers = [setInterval(() => void recheckAll(), 3600_000), setTimeout(() => void recheckAll(), 120_000), setTimeout(() => void readLeftUnread(), 20_000), setInterval(backupSafely, 5 * 60_000)];
    for (const t of timers) t.unref();
  };
  leader.onChange((leading) => {
    console.log(leading ? 'leading: this server runs the clocks' : 'no longer leading: another server runs the clocks');
    if (leading) start();
    else stop();
  });
  if (leader.leading) start();
  return stop;
}
