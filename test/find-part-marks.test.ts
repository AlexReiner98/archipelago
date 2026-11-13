// The find pack's part answers only with marks the host draws, as the manifest names them (task e_rfjwstnu). Run here,
// where a page module may be imported: a pack's own tests import nothing of the kernel.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
// @ts-ignore: a part's module, plain JavaScript
import find from '../packs/find/parts/find/index.js';
// @ts-ignore: a page module, plain JavaScript
import { checkMarks } from '../packs/walls/page/part-check.js';

const kinds = JSON.parse(readFileSync(new URL('../packs/find/pack.json', import.meta.url), 'utf8')).parts[0].marks;
const words = { types: { task: { title: 'Task', open: ['todo'], closed: ['done'] } }, links: { depends_on: 'depends on' } };

test("find's marks pass the host's check at rest, typed, in another part and after Enter", async () => {
  const drawn: unknown[] = [];
  const read = async (name: string) => (name === 'search' ? [{ id: 'e_aaaaaaaa', title: 'Roof', type: 'task' }] : { matched: 2, items: [] });
  const part = find({ words, address: { query: { filter: {} } } }, { read, go: () => {}, state: () => {}, marks: (m: unknown) => drawn.push(m) });
  const answers = [part.marks, part.on({ key: 'q', name: 'edit', value: 'roof' }), part.on({ key: 'q', name: 'edit', value: 'only ' }), part.on({ key: 'q', name: 'submit', value: '' })];
  await new Promise((r) => setTimeout(r, 400));
  for (const m of [...answers, ...drawn]) assert.doesNotThrow(() => checkMarks(m, { kinds }));
  assert.ok(drawn.length > 0, 'the choices are drawn once read');
});
