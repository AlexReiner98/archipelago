// The tests, as a set (test/sets.ts):
//   npm test                       the fast set: every file but those test/sets.ts names as slow
//   npm run test:full              every file: before a commit to main, and in CI
//   npm run test:changed [base]    the files what changed since base (where this branch left main) can reach
//   npm test -- test/a.test.ts …   just those files; an argument starting -- goes to node (--test-name-pattern=…)
//   node scripts/test.ts shard browser 1/2   one shard of the full run, as CI runs them side by side
import { spawnSync } from 'node:child_process';
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

const run = spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-global-setup=./test/global.ts', '--import', './test/each.ts', ...flags, ...files], { cwd: ROOT, stdio: 'inherit' });
process.exit(run.status ?? 1);
