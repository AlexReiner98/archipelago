// One test run on the machine at a time (scripts/test.ts). Every worktree's run shares the machine's temp folder, and
// two full runs side by side each start a worker per core and a Chrome per browser test: each then takes many times
// as long (9 Nov 2026: two test:changed runs at once, 26 test processes and 294 Chromes on 12 cores). A run takes this
// lock first; a second waits for it and says whose run it waits on. A lock whose run has died is taken over.
import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/** The lock's name in the temp folder, kept by the temp sweep (test/sweep.ts). */
export const LOCK = 'pelago-tests.lock';

export type Holder = { pid: number; cwd: string; what: string; started: number };

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // there, and someone else's
  }
};

/** Who holds the lock in `temp`, if a living run does; a lock left by a dead run is removed. */
export function holder(temp: string): Holder | null {
  const at = join(temp, LOCK);
  let held: Holder;
  try {
    held = JSON.parse(readFileSync(at, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    rmSync(at, { force: true }); // half written by a run that died while writing it
    return null;
  }
  if (held.pid === process.pid || alive(held.pid)) return held;
  rmSync(at, { force: true });
  return null;
}

/** Take the lock in `temp` if it is free, at once: true when this process now holds it. */
export function tryLock(temp: string, me: Omit<Holder, 'pid' | 'started'>): boolean {
  if (holder(temp)) return false;
  let fd: number;
  try {
    fd = openSync(join(temp, LOCK), 'wx');
  } catch {
    return false; // another run took it between the look and the open
  }
  writeSync(fd, JSON.stringify({ ...me, pid: process.pid, started: Date.now() }));
  closeSync(fd);
  return true;
}

/** Give the lock back, if this process holds it. */
export function unlock(temp: string) {
  try {
    if (JSON.parse(readFileSync(join(temp, LOCK), 'utf8')).pid === process.pid) rmSync(join(temp, LOCK), { force: true });
  } catch {} // not held, or gone already
}

const minutes = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/** Wait until the lock in `temp` is this process's, saying once (and when it changes) whose run it waits on. */
export async function lock(temp: string, me: Omit<Holder, 'pid' | 'started'>, every = 2000, say = console.log) {
  let told = 0;
  while (!tryLock(temp, me)) {
    const held = holder(temp);
    if (held && held.pid !== told) {
      say(`Waiting for the tests running in ${held.cwd} (${held.what}, pid ${held.pid}, for ${minutes(Date.now() - held.started)}).`);
      told = held.pid;
    }
    await new Promise((r) => setTimeout(r, every));
  }
}
