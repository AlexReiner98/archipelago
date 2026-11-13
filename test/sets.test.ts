// The sets of test files (test/sets.ts): the fast set loses nothing the full run has but what SLOW names, the
// structure test is always in it, and a change runs at least what imports it.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { affected, allTests, ENGINES, fastTests, FIRST_STEPS, LONG, PER_FILE, predict, reads, readWeights, ROOT, shard, SLOW, UNPRIVILEGED, weigher } from './sets.ts';

test('the fast set is every test file but the slow ones, the structure test always among them', () => {
  const all = allTests();
  assert.ok(all.length > 100 && all.includes('packs/canvas/map-story.test.ts'), 'the full run finds the packs’ tests too');
  assert.deepEqual(Object.keys(SLOW).filter((f) => !existsSync(join(ROOT, f))), [], 'every slow file is there');
  assert.deepEqual([...fastTests(), ...Object.keys(SLOW)].sort(), all);
  for (const f of ['test/structure.test.ts', 'test/sets.test.ts']) assert.ok(fastTests().includes(f), f);
});

test('the fast set holds no file past LONG seconds, and SLOW names none for its length that has come under it', () => {
  const files = readWeights().files;
  const seconds = (f: string) => Math.max(...ENGINES.map((e) => files[f]?.[e] ?? 0));
  const over = fastTests().filter((f) => f !== 'test/structure.test.ts' && seconds(f) > LONG);
  assert.deepEqual(over, [], `over ${LONG} s in CI: put each in SLOW as 'long' (test/sets.ts)`);
  const under = Object.keys(SLOW).filter((f) => SLOW[f] === 'long' && f in files && seconds(f) <= LONG);
  assert.deepEqual(under, [], `no longer over ${LONG} s: take each out of SLOW`);
});

test('a change runs the tests that import it or name it, the structure test, and more where it cannot tell', () => {
  const rules = affected(['packs/rules/kernel/rules.ts']).files;
  for (const f of ['test/rules.test.ts', 'test/approvals.test.ts', 'test/approvals-mixed-1.test.ts', 'test/structure.test.ts']) assert.ok(rules.includes(f), f);

  assert.deepEqual(affected(['test/kinds.test.ts']).files, ['test/kinds.test.ts', 'test/sets.test.ts', 'test/structure.test.ts'], 'a test alone, with the structure test (and this one, which names it)');

  const page = affected(['ui/canvases.js']).files;
  assert.ok(page.includes('test/layouts.test.ts'), 'a page of the app: the browser tests');
  assert.ok(!page.includes('test/rules.test.ts'), 'but not a test that never reads a page');
  const host = affected(['packs/walls/page/marks.js']).files;
  assert.ok(host.includes('test/layouts.test.ts') && host.includes('test/page-css.test.ts'), "a page of the host (a root's page/): the browser tests, and the tests that read it as text");

  const flow = affected(['packs/canvas/layouts/flow/islands.js']).files;
  for (const f of ['packs/canvas/map-story.test.ts', 'test/layouts.test.ts']) assert.ok(flow.includes(f), `a layout's code: ${f}, which imports it or draws that layout`);
  assert.ok(!flow.includes('test/rules.test.ts') && !flow.includes('test/canvas-pan.test.ts'), 'but not the kernel’s tests, nor a browser test that names no such layout');
  assert.ok(reads('test/canvas-pan.test.ts', 'packs/canvas/layouts/flow/islands.js', true), 'a reused pass counts every pack’s code a browser test could draw');

  const manifest = affected(['packs/core/pack.json']).files;
  assert.ok(fastTests().every((f) => manifest.includes(f)), 'a pack’s manifest is read by every map: the fast set');
});

const workflow = readFileSync(join(ROOT, '.github/workflows/tests.yml'), 'utf8').replaceAll('\r\n', '\n'); // a Windows checkout has CRLF
const matrices = [...workflow.matchAll(/^\s+shard: \[(.+)\](?: #.*)?$/gm)].map((m) => m[1].split(',').map((s) => s.trim()));

test('CI runs every file in exactly one shard, on each engine, and shard 1 alone runs the steps counted on it', () => {
  assert.equal(matrices.length, 2, 'one matrix for pglite, one for postgres');
  assert.deepEqual(matrices[1], matrices[0], 'both engines run the same shards: a shard added to one is added to the other');
  for (const shards of matrices) {
    const n = shards.length;
    assert.deepEqual(shards, Array.from({ length: n }, (_, i) => `${i + 1}/${n}`), 'the shards are 1/N to N/N');
    assert.deepEqual(shards.flatMap((s) => shard(s)).sort(), allTests(), `${n} shards: every file once`);
  }
  const guarded = [...workflow.matchAll(/^\s+- name: (.+)\n\s+if: (.+?)(?: #.*)?$/gm)].map((m) => [m[1], m[2]]);
  assert.ok(workflow.includes('node scripts/test.ts unprivileged'), 'the step as a role that is not a superuser runs its files through scripts/test.ts, as the shards do');
  assert.deepEqual(UNPRIVILEGED.filter((f) => !allTests().includes(f)), [], 'every file it runs is a test of the full run');
  assert.deepEqual(guarded.filter(([, cond]) => cond.includes('matrix.shard')).map(([name, cond]) => [name, cond]), FIRST_STEPS.map((name) => [name, "startsWith(matrix.shard, '1/')"]), 'a step that runs on one shard only is one FIRST_STEPS counts on shard 1');
});

/**
 * Seconds of a runner the heaviest shard may be expected to take on either engine (88 on 4 Nov 2026, with 8 shards),
 * but for a shard its heaviest file alone holds up: more shards do not shorten that one, so it is held to FILE_BUDGET.
 */
const BUDGET = 95;
/** Seconds one file may take, as measured: past it, split the file, as no number of shards waits less than it. */
const FILE_BUDGET = 60;

test('the heaviest shard keeps under its budget, so CI waits on no one shard', () => {
  const weights = readWeights();
  const weight = weigher(weights);
  const n = matrices[0].length;
  assert.equal(matrices[1].length, n, 'the budget holds for both engines’ shards');
  for (const engine of ENGINES)
    for (let k = 1; k <= n; k++) {
      const files = shard(`${k}/${n}`, weights);
      const seconds = predict(files, engine, k === 1 ? weights.steps[engine] : 0, weight);
      const alone = Math.max(...files.map((f) => weight(f, engine))) + PER_FILE;
      if (seconds > alone + 1) assert.ok(seconds <= BUDGET, `shard ${k}/${n} on ${engine} is expected to take ${Math.round(seconds)} s, over the budget of ${BUDGET}: add a shard to both matrices in .github/workflows/tests.yml, or refresh the weights (node scripts/test-weights.ts ci) if they are old`);
    }
  const long = Object.entries(weights.files).flatMap(([f, w]) => ENGINES.filter((e) => (w[e] ?? 0) > FILE_BUDGET).map((e) => `${f} (${w[e]} s on ${e})`));
  assert.deepEqual(long, [], `a file over ${FILE_BUDGET} s holds its shard up however many there are: split its tests into files of their own`);
});
