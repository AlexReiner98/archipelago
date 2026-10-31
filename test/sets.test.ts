// The sets of test files (test/sets.ts): the fast set loses nothing the full run has but what SLOW names, the
// structure test is always in it, and a change runs at least what imports it.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { affected, allTests, fastTests, ROOT, shard, shardNames, SLOW } from './sets.ts';

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

test('CI runs every file in exactly one shard, on each engine', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/tests.yml'), 'utf8');
  const matrices = [...workflow.matchAll(/^\s+shard: \[(.+)\]$/gm)].map((m) => m[1].split(',').map((s) => s.trim()));
  assert.equal(matrices.length, 2, 'one matrix for pglite, one for postgres');
  for (const shards of matrices) {
    const files = shards.flatMap((s) => shard(...(s.split(' ') as [string, string?])));
    assert.deepEqual([...files].sort(), allTests(), `${shards.join(', ')}: every file once`);
    assert.deepEqual([...new Set(shards.map((s) => s.split(' ')[0]))].sort(), shardNames().sort(), 'every shard named');
  }
  assert.ok(shard('rest').includes('test/structure.test.ts'));
});
