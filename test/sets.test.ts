// The sets of test files (test/sets.ts): the fast set loses nothing the full run has but what SLOW names, the
// structure test is always in it, and a change runs at least what imports it.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { affected, allTests, ENGINES, fastTests, FIRST_STEPS, predict, readWeights, ROOT, shard, SLOW } from './sets.ts';

test('the fast set is every test file but the slow ones, the structure test always among them', () => {
  const all = allTests();
  assert.ok(all.length > 100 && all.includes('packs/core/flow.test.ts'), 'the full run finds the packs’ tests too');
  assert.deepEqual(Object.keys(SLOW).filter((f) => !existsSync(join(ROOT, f))), [], 'every slow file is there');
  assert.deepEqual([...fastTests(), ...Object.keys(SLOW)].sort(), all);
  for (const f of ['test/structure.test.ts', 'test/sets.test.ts']) assert.ok(fastTests().includes(f), f);
});

test('a change runs the tests that import it or name it, the structure test, and more where it cannot tell', () => {
  const rules = affected(['src/rules.ts']).files;
  for (const f of ['test/rules.test.ts', 'test/approvals.test.ts', 'test/approvals-mixed.test.ts', 'test/structure.test.ts']) assert.ok(rules.includes(f), f);

  assert.deepEqual(affected(['test/kinds.test.ts']).files, ['test/kinds.test.ts', 'test/sets.test.ts', 'test/structure.test.ts'], 'a test alone, with the structure test (and this one, which names it)');

  const page = affected(['ui/canvas.js']).files;
  assert.ok(fastTests().every((f) => page.includes(f)) && page.includes('test/layouts.test.ts'), 'a page: the fast set and the browser tests');

  const manifest = affected(['packs/core/pack.json']).files;
  assert.ok(fastTests().every((f) => manifest.includes(f)), 'a pack’s manifest is read by every map: the fast set');
});

const workflow = readFileSync(join(ROOT, '.github/workflows/tests.yml'), 'utf8');
const matrices = [...workflow.matchAll(/^\s+shard: \[(.+)\]$/gm)].map((m) => m[1].split(',').map((s) => s.trim()));

test('CI runs every file in exactly one shard, on each engine, and shard 1 alone runs the steps counted on it', () => {
  assert.equal(matrices.length, 2, 'one matrix for pglite, one for postgres');
  for (const shards of matrices) {
    const n = shards.length;
    assert.deepEqual(shards, Array.from({ length: n }, (_, i) => `${i + 1}/${n}`), 'the shards are 1/N to N/N');
    assert.deepEqual(shards.flatMap((s) => shard(s)).sort(), allTests(), `${n} shards: every file once`);
  }
  const guarded = [...workflow.matchAll(/^\s+- name: (.+)\n\s+if: (.+?)(?: #.*)?$/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(guarded.filter(([, cond]) => cond.includes('matrix.shard')).map(([name, cond]) => [name, cond]), FIRST_STEPS.map((name) => [name, "startsWith(matrix.shard, '1/')"]), 'a step that runs on one shard only is one FIRST_STEPS counts on shard 1');
});

/** Seconds of tests the heaviest shard may be expected to take on either engine (66 on 3 Nov 2026, with 8 shards). */
const BUDGET = 75;

test('the heaviest shard keeps under its budget, so CI waits on no one shard', () => {
  const weights = readWeights();
  const n = matrices[0].length;
  for (const engine of ENGINES)
    for (let k = 1; k <= n; k++) {
      const seconds = predict(shard(`${k}/${n}`, weights), engine, k === 1 ? weights.steps[engine] : 0);
      assert.ok(seconds <= BUDGET, `shard ${k}/${n} on ${engine} is expected to take ${Math.round(seconds)} s, over the budget of ${BUDGET}: add a shard to both matrices in .github/workflows/tests.yml, or refresh the weights (node scripts/test-weights.ts ci) if they are old`);
    }
});
