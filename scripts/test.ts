// The tests, as a set (test/sets.ts):
//   npm test                       the fast set: every file but those test/sets.ts names as slow
//   npm run test:full              every file, as CI runs them before main deploys (CI is the gate)
//   npm run test:changed [base]    the files what changed since base (where this branch left main) can reach
//   npm test -- test/a.test.ts …   just those files; an argument starting -- goes to node (--test-name-pattern=…)
//   node scripts/test.ts shard 3/8   one shard of the full run, as CI runs them side by side
//   node scripts/test.ts unprivileged   the files CI runs again as a Postgres role that is not a superuser
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { blankImageFile } from '../packs/database/kernel/db.ts';
import { lock, unlock } from '../test/lock.ts';
import { keys, passed, remember } from '../test/passes.ts';
import { affected, allTests, fastTests, heaviestFirst, ROOT, shard, SLOW, UNPRIVILEGED } from '../test/sets.ts';
import { sweepTemp } from '../test/sweep.ts';

const flags = process.argv.slice(2).filter((a) => a.startsWith('--') && a !== '--no-cache');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const git = (...a: string[]) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout?.trim() ?? '';

function changedSince(base?: string) {
  const from = base ?? (git('merge-base', 'HEAD', 'origin/main') || git('merge-base', 'HEAD', 'main') || 'HEAD');
  return [...new Set([...git('diff', '--name-only', from).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))];
}

let files: string[];
if (args[0] === 'full') files = allTests();
else if (args[0] === 'shard') files = shard(args[1]);
else if (args[0] === 'unprivileged') files = UNPRIVILEGED;
else if (args[0] === 'changed') {
  const changed = changedSince(args[1]);
  const picked = affected(changed);
  console.log(`${changed.length} files changed; ${picked.why}`);
  files = picked.files;
} else files = args.length ? args : fastTests();
const engine = process.env.PELAGO_TEST_DATABASE_URL ? 'postgres' : 'pglite';
// Node starts the files in the order given, so the longest go first rather than holding the run up at its end.
files = heaviestFirst(files, engine);

// CI writes the seconds each file's tests took (test/times.ts), for scripts/test-weights.ts ci.
const reporters: string[] = [];
if (process.env.PELAGO_TEST_TIMES) reporters.push('--test-reporter=./test/times.ts', `--test-reporter-destination=${process.env.PELAGO_TEST_TIMES}`);
if (process.env.PELAGO_TEST_TIMES) mkdirSync(dirname(join(ROOT, process.env.PELAGO_TEST_TIMES)), { recursive: true });

// A new workspace starts with the kernel's packs alone; the tests' workspaces start with every pack, as the map they
// were written against did (test/manifest.test.ts checks the kernel alone).
process.env.PELAGO_START_PACKS ??= 'all';

// The blank database image is kept in the machine's temp folder, made once for many runs (packs/database/kernel/db.ts).
if (!process.env.PELAGO_TEST_DATABASE_URL) process.env.PELAGO_TEST_IMAGE ??= await blankImageFile();

// One heavy run on the machine at a time, whichever worktree it is in (test/lock.ts). CI's runners run one each.
// A few files named by hand, none slow (no browser, no whole-map move), run beside it: several sessions check
// their own pack at once, and only what loads the machine waits (the owner, 13 Nov 2026).
const what = ['npm', 'test', ...process.argv.slice(2)].join(' ');
const light = args.length > 0 && args.length <= 5 && args.every((f) => f.startsWith('test/') && !SLOW[f]);
const locked = !process.env.CI && !light;
if (locked) await lock(tmpdir(), { cwd: ROOT, what });
process.on('exit', () => { if (locked) unlock(tmpdir()); });

// A run of a set skips the files that passed on this same code (test/passes.ts), here or in another worktree; a file
// named on the command line always runs, and so does a run that picks tests by name or asks --no-cache.
const set = !args.length || ['full', 'changed'].includes(args[0]);
const cached = set && !process.env.CI && !process.argv.includes('--no-cache') && !flags.some((f) => /^--test-(name-pattern|skip-pattern|only)/.test(f));
const key = cached ? keys(files, engine) : new Map<string, string>();
if (cached) {
  const skip = new Set(passed(tmpdir(), key));
  if (skip.size) console.log(`${skip.size} of ${files.length} files passed on this same code before: not run again (--no-cache runs them).`);
  files = files.filter((f) => !skip.has(f));
  if (!files.length) process.exit(0);
}

// A test that hangs ends after ten minutes rather than holding the machine for hours; a file sets its own if it needs.
const timeout = flags.some((f) => f.startsWith('--test-timeout')) ? [] : ['--test-timeout=600000'];

// Everything the tests put in a temp folder (each file's own folders, Chrome's profiles) goes in one folder for this
// run, removed when it ends: left behind, they came to some 300 GB in two weeks. What is left there all the same is
// the next run's to sweep (test/sweep.ts).
sweepTemp(tmpdir());
const scratch = mkdtempSync(join(tmpdir(), 'pelago-run-'));
process.on('SIGINT', () => {}); // Ctrl-C ends the tests; this process stays to remove their folder
const passFile = join(scratch, 'passes.json');
if (cached) reporters.push('--test-reporter=./test/pass-reporter.ts', `--test-reporter-destination=${passFile}`);
// Another reporter replaces node's own, so it is asked for again.
if (reporters.length) reporters.unshift('--test-reporter=spec', '--test-reporter-destination=stdout');
const run = spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-global-setup=./test/global.ts', '--import', './test/each.ts', ...timeout, ...reporters, ...flags, ...files], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, TMPDIR: scratch, TEMP: scratch, TMP: scratch },
});
if (cached) {
  try {
    const ok = JSON.parse(readFileSync(passFile, 'utf8')) as Record<string, boolean>;
    remember(tmpdir(), key, Object.keys(ok).filter((f) => ok[f]));
  } catch {} // the run was ended before node wrote it
}
// One by one: a file a Chrome still holds keeps only what it is in, for the next run's sweep.
const left = [...readdirSync(scratch), ''].filter((name) => {
  try {
    rmSync(join(scratch, name), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    return false;
  } catch {
    return Boolean(name);
  }
});
if (left.length) console.warn(`Could not remove from ${scratch}: ${left.join(', ')}`);
process.exit(run.status ?? 1);
