// The seconds each test file takes, per engine, written to test/weights.json for shard() to deal CI's shards by and
// for scripts/test.ts to start the heaviest first (test/sets.ts). Run it when sets.test.ts says a shard is over its
// budget, or when files have come and gone:
//   node scripts/test-weights.ts ci [runs]       the middle of the last 5 passing runs of the tests on main (or those runs), with gh
//   node scripts/test-weights.ts local [files]   each file alone, four at a time, on this machine's engine; with no
//                                                files, those weights.json does not have yet
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankImageFile } from '../packs/database/kernel/db.ts';
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
  // A file's time swings with what runs beside it on the runner (main's run of 4 Nov 2026 took 53-103 s on shards
  // one run before had made even), so each weight is the middle of its times over the last RUNS passing runs.
  const RUNS = 5;
  const runs = rest.length ? rest : gh('run', 'list', '--workflow', 'Tests', '--branch', 'main', '--status', 'success', '--limit', String(RUNS * 2), '--json', 'databaseId', '--jq', '.[].databaseId').split('\n').filter(Boolean);
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return Math.round(((s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2) * 10) / 10;
  };
  const seen: Record<string, Record<string, number[]>> = {};
  const stepsSeen: Record<string, number[]> = {};
  const used: string[] = [];
  const tests = new Set(allTests());
  for (const run of runs) {
    if (used.length === RUNS) break;
    // Each shard's artifact holds { file: seconds } (test/times.ts); the steps on shard 1 are timed from the run's jobs.
    const into = mkdtempSync(join(tmpdir(), 'pelago-weights-'));
    try {
      gh('run', 'download', run, '--pattern', 'times-*', '--dir', into);
    } catch {} // none kept: skipped below
    const files: Record<string, Record<string, number>> = {};
    for (const dir of readdirSync(into)) {
      const engine = ENGINES.find((e) => dir.startsWith(`times-${e}-`));
      const path = join(into, dir, 'times.json');
      if (!engine || !existsSync(path)) continue;
      for (const [f, s] of Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>)) (files[f] ??= {})[engine] = s;
    }
    rmSync(into, { recursive: true, force: true });
    // A run before test/times.ts timed each file whole kept some under a helper's name (test/approvals.ts): not used.
    if (!Object.keys(files).length || Object.keys(files).some((f) => !tests.has(f) && f.startsWith('test/') && !f.endsWith('.test.ts'))) continue;
    for (const [f, w] of Object.entries(files)) for (const [e, s] of Object.entries(w)) ((seen[f] ??= {})[e] ??= []).push(s);
    const jobs: { name: string; steps: { name: string; started_at: string; completed_at: string }[] }[] = JSON.parse(gh('api', `repos/{owner}/{repo}/actions/runs/${run}/jobs?per_page=100`, '--jq', '.jobs'));
    for (const e of ENGINES) {
      const first = jobs.find((j) => j.name.startsWith(`${e} (1/`));
      (stepsSeen[e] ??= []).push((first?.steps ?? []).filter((s) => FIRST_STEPS.includes(s.name)).reduce((sum, s) => sum + (Date.parse(s.completed_at) - Date.parse(s.started_at)) / 1000, 0));
    }
    used.push(run);
  }
  if (!used.length) throw new Error(`None of runs ${runs.join(', ')} kept whole-file times`);
  const files: Weights['files'] = Object.fromEntries(Object.entries(seen).map(([f, w]) => [f, Object.fromEntries(Object.entries(w).map(([e, xs]) => [e, median(xs)]))]));
  const steps = Object.fromEntries(ENGINES.map((e) => [e, median(stepsSeen[e] ?? [0])]));
  console.log(`The middle of runs ${used.join(', ')}:`);
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
