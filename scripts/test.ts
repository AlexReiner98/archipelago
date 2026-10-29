// The tests, as a set (test/sets.ts):
//   npm test                       the fast set: every file but those test/sets.ts names as slow
//   npm run test:full              every file: before a commit to main, and in CI
//   npm run test:changed [base]    the files what changed since base (where this branch left main) can reach
//   npm test -- test/a.test.ts …   just those files; an argument starting -- goes to node (--test-name-pattern=…)
//   node scripts/test.ts shard browser 1/2   one shard of the full run, as CI runs them side by side
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankImageFile } from '../src/db.ts';
import { affected, allTests, fastTests, ROOT, shard } from '../test/sets.ts';

const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const git = (...a: string[]) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout?.trim() ?? '';

function changedSince(base?: string) {
  const from = base ?? (git('merge-base', 'HEAD', 'origin/main') || git('merge-base', 'HEAD', 'main') || 'HEAD');
  return [...new Set([...git('diff', '--name-only', from).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))];
}

let files: string[];
if (args[0] === 'full') files = allTests();
else if (args[0] === 'shard') files = shard(args[1], args[2]);
else if (args[0] === 'changed') {
  const changed = changedSince(args[1]);
  const picked = affected(changed);
  console.log(`${changed.length} files changed; ${picked.why}`);
  files = picked.files;
} else files = args.length ? args : fastTests();

// A new workspace starts with the kernel's packs alone; the tests' workspaces start with every pack, as the map they
// were written against did (test/manifest.test.ts checks the kernel alone).
process.env.PELAGO_START_PACKS ??= 'all';

// The blank database image is kept in the machine's temp folder, made once for many runs (src/db.ts).
if (!process.env.PELAGO_TEST_DATABASE_URL) process.env.PELAGO_TEST_IMAGE ??= await blankImageFile();

// Everything the tests put in a temp folder (each file's own folders, Chrome's profiles) goes in one folder for this
// run, removed when it ends: left behind, they came to some 200 GB in two weeks. A run killed before it could remove
// its folder leaves it to the next run, which removes those over a day old (a younger one may be another run's).
const DAY = 86_400_000;
for (const old of readdirSync(tmpdir())) {
  const at = join(tmpdir(), old);
  try {
    if (old.startsWith('pelago-run-') && Date.now() - statSync(at).mtimeMs > DAY) rmSync(at, { recursive: true, force: true });
  } catch {}
}
const scratch = mkdtempSync(join(tmpdir(), 'pelago-run-'));
process.on('SIGINT', () => {}); // Ctrl-C ends the tests; this process stays to remove their folder
const run = spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-global-setup=./test/global.ts', '--import', './test/each.ts', ...flags, ...files], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, TMPDIR: scratch, TEMP: scratch, TMP: scratch },
});
try {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
} catch (err) {
  console.warn(`Could not remove ${scratch}: ${(err as Error).message}`);
}
process.exit(run.status ?? 1);
