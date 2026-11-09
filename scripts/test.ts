// The tests, as a set (test/sets.ts):
//   npm test                       the fast set: every file but those test/sets.ts names as slow
//   npm run test:full              every file, as CI runs them before main deploys (CI is the gate)
//   npm run test:changed [base]    the files what changed since base (where this branch left main) can reach
//   npm test -- test/a.test.ts …   just those files; an argument starting -- goes to node (--test-name-pattern=…)
//   node scripts/test.ts shard 3/8   one shard of the full run, as CI runs them side by side
//   node scripts/test.ts unprivileged   the files CI runs again as a Postgres role that is not a superuser
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { blankImageFile } from '../src/db.ts';
import { affected, allTests, fastTests, heaviestFirst, ROOT, shard, UNPRIVILEGED } from '../test/sets.ts';
import { sweepTemp } from '../test/sweep.ts';

const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
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
// Node starts the files in the order given, so the longest go first rather than holding the run up at its end.
files = heaviestFirst(files, process.env.PELAGO_TEST_DATABASE_URL ? 'postgres' : 'pglite');

// CI writes the seconds each file's tests took (test/times.ts), for scripts/test-weights.ts ci.
const times = process.env.PELAGO_TEST_TIMES ? ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=./test/times.ts', `--test-reporter-destination=${process.env.PELAGO_TEST_TIMES}`] : [];
if (process.env.PELAGO_TEST_TIMES) mkdirSync(dirname(join(ROOT, process.env.PELAGO_TEST_TIMES)), { recursive: true });

// A new workspace starts with the kernel's packs alone; the tests' workspaces start with every pack, as the map they
// were written against did (test/manifest.test.ts checks the kernel alone).
process.env.PELAGO_START_PACKS ??= 'all';

// The blank database image is kept in the machine's temp folder, made once for many runs (src/db.ts).
if (!process.env.PELAGO_TEST_DATABASE_URL) process.env.PELAGO_TEST_IMAGE ??= await blankImageFile();

// Everything the tests put in a temp folder (each file's own folders, Chrome's profiles) goes in one folder for this
// run, removed when it ends: left behind, they came to some 300 GB in two weeks. What is left there all the same is
// the next run's to sweep (test/sweep.ts).
sweepTemp(tmpdir());
const scratch = mkdtempSync(join(tmpdir(), 'pelago-run-'));
process.on('SIGINT', () => {}); // Ctrl-C ends the tests; this process stays to remove their folder
const run = spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-global-setup=./test/global.ts', '--import', './test/each.ts', ...times, ...flags, ...files], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, TMPDIR: scratch, TEMP: scratch, TMP: scratch },
});
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
