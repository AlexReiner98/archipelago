// The anatomy sync's extractors: files in, the island's keyed items and links out, read back by the same keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, reached } from './extract.ts';
import { checksOf } from './extract-checks.ts';
import { slowOf } from './extract-code.ts';
import { kindOf } from './extract-manifests.ts';
import { keyOf, type Source } from './model.ts';

const file = (path: string, text: unknown, repo: Source['repo'] = 'open_core'): Source => ({ path, text: typeof text === 'string' ? text : JSON.stringify(text), blob: `b-${path}`, repo });
const FILES = [
  file('packs/roots.json', { roots: [{ id: 'core' }, { id: 'loader' }], calls: {} }),
  file('packs/core/pack.json', { id: 'core', title: 'Core', types: [{ id: 'work', title: 'Work', capabilities: { owned: true } }], links: [{ id: 'part_of', root: true, from: ['*'], to: ['*'] }] }),
  file('packs/loader/pack.json', { id: 'loader', title: 'Loader', kernel: { trust: 'root', modules: 'kernel/', provides: { 'root.order': { in: { packs: ['string'] }, out: 'any', run: 'order.ts#order' } } } }),
  file('packs/loader/kernel/order.ts', '// Orders the packs.\nimport { id } from \'./ids.ts\';\nimport type { T } from \'./types.ts\';\nexport const order = 1;\n'),
  file('packs/loader/kernel/ids.ts', '// Ids.\nexport const id = 1;\n'),
  file('packs/loader/kernel/types.ts', 'export type T = 1;\n'),
  file('workspace-packs/calendar/pack.json', { id: 'calendar', title: 'Calendar', requires: ['has:owned'], types: [{ id: 'event', title: 'Event', extends: 'work' }] }, 'hosted'),
  file('ui/find.js', '// The find bar.\nimport { order } from \'../packs/loader/kernel/order.ts\';\n'),
  file('test/order.test.ts', '// Order.\nimport { order } from \'../packs/loader/kernel/order.ts\';\n'),
  file('test/sets.ts', "export const SLOW: Record<string, string> = {\n  'test/order.test.ts': 'browser',\n};\n"),
  file('test/structure.test.ts', "// 6. Kernel modules import one way.\nconst CYCLES: Record<string, number> = { 'a -> b': 1 };\ntest('kernel modules import one way', () => {});\nconst LONG: Record<string, number> = {};\ntest('no file over 500 lines', () => {});\n"),
];

test('packs, modules, imports, tests and checks come out keyed and tied as the files say', () => {
  const { items, links } = extract(FILES);
  const item = (k: string) => items.find((i) => i.key === k);
  const has = (type: string, from: string, to: string) => links.some((l) => l.type === type && l.from === from && l.to === to);
  assert.equal(item('pack:loader')!.props.kind, 'root');
  assert.equal(item('pack:loader')!.props.root_order, 2);
  assert.equal(item('pack:calendar')!.props.kind, 'island');
  assert.equal(item('module:packs/loader/kernel/order.ts')!.props.layer, 'root');
  assert.equal(item('module:packs/loader/kernel/order.ts')!.body, 'Orders the packs.', 'a module\'s note is its header comment');
  assert.equal(item('module:ui/find.js')!.props.layer, 'page');
  assert.ok(has('part_of', 'module:packs/loader/kernel/order.ts', 'pack:loader') && !links.some((l) => l.from === 'module:ui/find.js' && l.type === 'part_of'), 'the page has no pack yet');
  assert.ok(has('anatomy.imports', 'module:packs/loader/kernel/order.ts', 'module:packs/loader/kernel/ids.ts'));
  assert.deepEqual(links.find((l) => l.to === 'module:packs/loader/kernel/types.ts')!.props, { type_only: true });
  assert.ok(has('anatomy.imports', 'module:ui/find.js', 'module:packs/loader/kernel/order.ts'));
  assert.ok(has('anatomy.kept_in', 'name:service:root.order', 'module:packs/loader/kernel/order.ts'), 'a service is kept in the module that runs it');
  assert.equal(item('name:service:root.order')!.props.takes, JSON.stringify({ packs: ['string'] }));
  assert.ok(has('anatomy.tests', 'test:test/order.test.ts', 'module:packs/loader/kernel/order.ts'));
  assert.equal(item('test:test/order.test.ts')!.props.slow, true);
  assert.equal(item('check:kernel modules import one way')!.props.breaks, 1);
  assert.equal(item('check:no file over 500 lines')!.props.breaks, 0);
  assert.ok(has('anatomy.provides', 'pack:core', 'name:has:owned') && has('anatomy.extends', 'type:event', 'type:work'));
  assert.ok(items.every((i) => i.title.length <= 60), 'every title is a name');
  assert.ok(links.every((l) => items.some((i) => i.key === l.from) && items.some((i) => i.key === l.to)), 'no link to what nobody wants');
});

test('every item is found again by its type, its fields and its pack', () => {
  const { items, links } = extract(FILES);
  const packOf = new Map(links.filter((l) => l.type === 'part_of' && l.to.startsWith('pack:')).map((l) => [l.from, l.to.slice(5)]));
  for (const i of items) assert.equal(keyOf(i.type, i.props, packOf.get(i.key)), i.key);
});

test('a change reaches only the extractors that own its files', () => {
  assert.deepEqual(reached(['ui/find.js']).map((e) => e.id), ['modules']);
  assert.deepEqual(reached(['packs/loader/pack.json']).map((e) => e.id), ['manifests']);
  assert.deepEqual(reached(['packs/roots.json']).map((e) => e.id), ['manifests', 'modules']);
  assert.deepEqual(reached(['README.md']), []);
});

test('the slow set and the checks are read off their files', () => {
  assert.deepEqual([...slowOf("export const SLOW = {\n  'test/a.test.ts': 'browser',\n  'test/b.test.ts': 'long',\n};\n")], ['test/a.test.ts', 'test/b.test.ts']);
  assert.deepEqual(checksOf("// 1. One.\nconst A: Owed = {};\ntest('one', () => {});\n").map((c) => [c.check, c.breaks, c.heading]), [['one', 0, '1. One.']]);
  assert.equal(kindOf({ m: { id: 'billing', reach: { server: { gates: {} } } } }), 'server');
});
