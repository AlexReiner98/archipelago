// Test files that passed on this same code are not run again (scripts/test.ts). A file's key is a hash of everything
// it may read (reads in test/sets.ts, wide: a browser test reads every pack's code), of what every test reads
// (shared, the fixtures, the setup), of the engine and of node's version. A pass is kept under that key in the
// machine's temp folder, so a run in one worktree skips what another just passed on the same code. Only runs of a set
// (npm test, test:changed, test:full) skip: a file named on the command line always runs, and --no-cache runs all.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reaches, reads, ROOT, shared } from './sets.ts';

/** The record's name in the temp folder, kept by the temp sweep (test/sweep.ts). */
export const PASSES = 'pelago-passes.json';
/** How many keys a file keeps: enough for the worktrees and branches open at once. */
const KEEP = 20;

const hashes = new Map<string, string>();
const hashOf = (file: string) => {
  if (!hashes.has(file)) {
    let h = 'gone';
    try {
      h = createHash('sha1').update(readFileSync(join(ROOT, file))).digest('hex');
    } catch {} // named in a test, never there
    hashes.set(file, h);
  }
  return hashes.get(file)!;
};

/** Every file of the checkout a test could read: what git tracks or would, but not what it ignores. */
const checkout = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && !f.startsWith('.claude/'));

/** The key of each of these test files on this checkout, for this engine. */
export function keys(tests: string[], engine: string): Map<string, string> {
  const files = checkout();
  const common = files.filter((f) => shared(f) || f.startsWith('test/fixtures/')).concat([...reaches('test/each.ts'), ...reaches('test/global.ts'), 'scripts/test.ts']);
  const base = createHash('sha1').update([engine, process.version, process.env.PELAGO_START_PACKS ?? '', ...common.sort().map((f) => `${f} ${hashOf(f)}`)].join('\n')).digest('hex');
  const candidates = files.filter((f) => /^(src|ui|packs|docs|test|scripts)\//.test(f));
  return new Map(tests.map((t) => [t, createHash('sha1').update([base, ...candidates.filter((f) => reads(t, f, true)).map((f) => `${f} ${hashOf(f)}`)].join('\n')).digest('hex')]));
}

type Record = { [test: string]: string[] };
const load = (temp: string): Record => {
  try {
    return JSON.parse(readFileSync(join(temp, PASSES), 'utf8'));
  } catch {
    return {};
  }
};

/** The files whose key has passed before. */
export const passed = (temp: string, key: Map<string, string>) => {
  const record = load(temp);
  return [...key].filter(([t, k]) => record[t]?.includes(k)).map(([t]) => t);
};

/** Keep a pass for each of these files under its key, the newest first. Only one run writes at a time (test/lock.ts). */
export function remember(temp: string, key: Map<string, string>, ok: string[]) {
  const record = load(temp);
  for (const t of ok) if (key.has(t)) record[t] = [key.get(t)!, ...(record[t] ?? []).filter((k) => k !== key.get(t))].slice(0, KEEP);
  writeFileSync(join(temp, PASSES), JSON.stringify(record));
}
