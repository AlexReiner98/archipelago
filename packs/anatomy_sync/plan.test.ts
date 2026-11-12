// A run on a change, and the plan it sends: only what the change touched is redone, a deleted file's item is archived,
// a moved file's item keeps its id and gets its new path, and nothing a run does not speak for is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, fullRun, runOf } from './extract.ts';
import { keyOf, type Source } from './model.ts';
import { plan, sameNote, type Island } from './plan.ts';

const file = (path: string, text: unknown): Source => ({ path, text: typeof text === 'string' ? text : JSON.stringify(text), blob: `b-${path}-${String(text).length}`, repo: 'open_core' });
const BASE = [
  file('packs/roots.json', { roots: [{ id: 'core' }, { id: 'loader' }], calls: {} }),
  file('packs/core/pack.json', { id: 'core', title: 'Core' }),
  file('packs/loader/pack.json', { id: 'loader', title: 'Loader', kernel: { trust: 'root' } }),
  file('packs/loader/kernel/a.ts', '// A.\nimport { b } from \'./b.ts\';\n'),
  file('packs/loader/kernel/b.ts', '// B.\nexport const b = 1;\n'),
  file('packs/loader/kernel/c.ts', '// C.\nexport const c = 1;\n'),
  file('test/a.test.ts', '// Tests a.\nimport \'../packs/loader/kernel/a.ts\';\n'),
];

/** The island as a full run would leave it: every wanted item and link, ids made up from keys. */
function islandOf(files: Source[]): Island {
  const { items, links } = extract(files);
  const byKey = new Map(items.map((w, i) => [w.key, { id: `e${i}`, type: w.type, title: w.title, body: w.body, props: { ...w.props } }]));
  const id = (k: string) => byKey.get(k)!.id;
  return { island: 'isl', byKey, keyById: new Map([...byKey].map(([k, h]) => [h.id, k])), links: links.map((l, i) => ({ id: `r${i}`, type: l.type, from: id(l.from), to: id(l.to) })) };
}

test('a full run on an island already in step sends nothing', () => {
  const island = islandOf(BASE);
  const { ops } = plan(extract(BASE), island, fullRun());
  assert.deepEqual(ops, []);
});

test('a module changed redoes that module alone and its imports', () => {
  const island = islandOf(BASE);
  const after = BASE.map((f) => (f.path === 'packs/loader/kernel/a.ts' ? file(f.path, '// A, now with c.\nimport { c } from \'./c.ts\';\n') : f));
  const run = runOf([{ path: 'packs/loader/kernel/a.ts', status: 'M' }]);
  assert.deepEqual(run.extractors.map((e) => [e.extractor.id, [...(e.only ?? [])]]), [['modules', ['packs/loader/kernel/a.ts']]]);
  const { ops, counts } = plan(extract(after, run, new Set(island.byKey.keys())), island, run);
  assert.deepEqual(counts, { make: 0, rename: 0, change: 1, archive: 0, tie: 1, untie: 1 }, 'its note and hash, a tie to c, the tie to b taken back');
  assert.ok(ops.every((o) => o.op !== 'archive'), 'nothing else of the island is touched');
});

test('a deleted module is archived, and a moved one keeps its item', () => {
  const island = islandOf(BASE);
  const b = island.byKey.get('module:packs/loader/kernel/b.ts')!.id, c = island.byKey.get('module:packs/loader/kernel/c.ts')!.id;
  const after = BASE.filter((f) => !f.path.endsWith('/b.ts') && !f.path.endsWith('/c.ts')).concat(file('packs/loader/kernel/see.ts', '// C.\nexport const c = 1;\n'));
  const run = runOf([{ path: 'packs/loader/kernel/b.ts', status: 'D' }, { path: 'packs/loader/kernel/see.ts', status: 'R', from: 'packs/loader/kernel/c.ts' }]);
  const { ops, counts } = plan(extract(after, run, new Set(island.byKey.keys())), island, run);
  assert.deepEqual(ops.find((o) => o.op === 'archive'), { op: 'archive', id: b });
  assert.deepEqual(ops.find((o) => o.op === 'update' && o.id === c), { op: 'update', id: c, props: { path: 'packs/loader/kernel/see.ts' } }, 'the same item, its new path');
  assert.equal(counts.make, 0, 'nothing made: the moved module is the same item');
});

test('roots.json changed redoes every module and the manifests', () => {
  const run = runOf([{ path: 'packs/roots.json', status: 'M' }]);
  assert.deepEqual(run.extractors.map((e) => [e.extractor.id, e.only]), [['manifests', undefined], ['modules', undefined]]);
  assert.ok(run.mayArchive('module:x.ts') && run.mayArchive('pack:x') && !run.mayArchive('test:x'));
});

test('a key is read back for every kind a run makes, and a cut note counts as the same', () => {
  assert.equal(keyOf('anatomy.sync', {}), 'sync');
  assert.ok(sameNote('One. Two and more.', 'One. Two…') && !sameNote('One. Two.', 'One. Three…'));
});
