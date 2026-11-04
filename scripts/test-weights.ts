// The seconds each test file takes, per engine, written to test/weights.json for shard() to deal CI's shards by and
// for scripts/test.ts to start the heaviest first (test/sets.ts). Run it when sets.test.ts says a shard is over its
// budget, or when files have come and gone:
//   node scripts/test-weights.ts ci [run]        from the latest passing run of the tests on main (or that run), with gh
//   node scripts/test-weights.ts local [files]   each file alone, four at a time, on this machine's engine; with no
//                                                files, those weights.json does not have yet
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankImageFile } from '../src/db.ts';
import { allTests, ENGINES, FIRST_STEPS, readWeights, ROOT, type Weights } from '../test/sets.ts';

const [mode, ...rest] = process.argv.slice(2);
const weights = readWeights();
const gh = (...a: string[]) => {
  const out = spawnSync('gh', a, { cwd: ROOT, encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`gh ${a.join(' ')}: ${out.stderr.trim()}`);
  return out.stdout.trim();
};

function write(next: Weights) {
  const tests = new Set(allTests());
  const files = Object.entries(next.files).filter(([f]) => tests.has(f)).sort(([a], [b]) => (a < b ? -1 : 1));
  const lines = files.map(([f, w]) => `  ${JSON.stringify(f)}: { ${ENGINES.filter((e) => e in w).map((e) => `"${e}": ${w[e]}`).join(', ')} }`);
  writeFileSync(join(ROOT, 'test/weights.json'), `{\n "files": {\n${lines.join(',\n')}\n },\n "steps": ${JSON.stringify(next.steps)}\n}\n`);
  const missing = [...tests].filter((f) => !(f in next.files));
  console.log(`${files.length} files weighed${missing.length ? `; none for ${missing.join(', ')}` : ''}`);
}

if (mode === 'ci') {
  const run = rest[0] ?? gh('run', 'list', '--workflow', 'Tests', '--branch', 'main', '--status', 'success', '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId');
  if (!run) throw new Error('No passing run of the tests on main');
  // Each shard's artifact holds { file: seconds } (test/times.ts); the steps on shard 1 are timed from the run's jobs.
  const into = mkdtempSync(join(tmpdir(), 'pelago-weights-'));
  try {
    gh('run', 'download', run, '--pattern', 'times-*', '--dir', into);
  } catch {} // none kept: said below
  const files: Weights['files'] = {};
  for (const dir of readdirSync(into)) {
    const engine = ENGINES.find((e) => dir.startsWith(`times-${e}-`));
    const path = join(into, dir, 'times.json');
    if (!engine || !existsSync(path)) continue;
    for (const [f, s] of Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>)) (files[f] ??= {})[engine] = s;
  }
  rmSync(into, { recursive: true, force: true });
  if (!Object.keys(files).length) throw new Error(`Run ${run} kept no times: it ran before the shards wrote them`);
  const jobs: { name: string; steps: { name: string; started_at: string; completed_at: string }[] }[] = JSON.parse(gh('api', `repos/{owner}/{repo}/actions/runs/${run}/jobs?per_page=100`, '--jq', '.jobs'));
  const steps = Object.fromEntries(
    ENGINES.map((e) => {
      const first = jobs.find((j) => j.name.startsWith(`${e} (1/`));
      const seconds = (first?.steps ?? []).filter((s) => FIRST_STEPS.includes(s.name)).reduce((sum, s) => sum + (Date.parse(s.completed_at) - Date.parse(s.started_at)) / 1000, 0);
      return [e, seconds];
    }),
  );
  console.log(`From run ${run}:`);
  write({ files, steps });
} else if (mode === 'local') {
  const engine = process.env.PELAGO_TEST_DATABASE_URL ? 'postgres' : 'pglite';
  const files = rest.length ? rest : allTests().filter((f) => !(f in weights.files));
  if (!process.env.PELAGO_TEST_DATABASE_URL) process.env.PELAGO_TEST_IMAGE = await blankImageFile();
  let next = 0;
  const weigh = async (): Promise<void> => {
    const f = files[next++];
    if (!f) return;
    const start = Date.now();
    await new Promise((done) => spawn(process.execPath, ['--test', '--test-force-exit', '--test-global-setup=./test/global.ts', '--import', './test/each.ts', f], { cwd: ROOT, stdio: 'ignore' }).on('exit', done));
    (weights.files[f] ??= {})[engine] = Math.round((Date.now() - start) / 100) / 10;
    return weigh();
  };
  await Promise.all([weigh(), weigh(), weigh(), weigh()]);
  write(weights);
} else {
  console.log('Say ci [run] or local [files]');
  process.exit(1);
}
