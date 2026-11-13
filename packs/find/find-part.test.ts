// The find pack's part (task e_rfjwstnu), run without a page: what typed words could be, and where taking one moves the
// page. Input in, marks and moves out; the host's reads stand in as a function.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a part's module, plain JavaScript
import find from './parts/find/index.js';
// @ts-ignore: a part's module, plain JavaScript
import { choicesFor, ledBy } from './parts/find/choices.js';
// @ts-ignore: a part's module, plain JavaScript
import { added, schemaOf, withWords } from './parts/find/lens.js';
import { checkMarks } from '../walls/page/part-check.js';

const words = {
  types: { task: { title: 'Task', of: 'work', open: ['todo'], closed: ['done'] }, work: { title: 'Work', open: [], closed: [] }, lens: { title: 'View', of: 'system', open: [], closed: [] }, system: { title: 'System', open: [], closed: [] }, actor: { title: 'Person', open: [], closed: [] } },
  links: { depends_on: 'depends on', part_of: 'part of' },
};
const hits = [{ id: 'e_aaaaaaaa', title: 'Roof', type: 'task' }];
const read = async (name: string, params: { type?: string }) => (name === 'search' ? (params.type === 'actor' ? [] : hits) : name === 'flat' ? { matched: 7, items: [] } : null);
const lens = { filter: { find: ['text old', 'type task'] } };
const KINDS = ['box', 'text', 'list', 'input', 'button'];

test('Find offers the words first, then each item found as In, Item and Related, its types and links', async () => {
  const all = await choicesFor('Find', 'roof', { most: 3, wide: 12, lens, schema: schemaOf(words), read, views: [{ lens: 'e_bbbbbbbb', title: 'Roof plan' }] });
  assert.deepEqual(all.map((c: { kind: string }) => c.kind), ['Words', 'View', 'In', 'Item', 'Related']);
  assert.deepEqual(all[2].term, { find: 'in e_aaaaaaaa' });
  assert.equal(all[1].view, 'e_bbbbbbbb');
});

test("a kind's word leads: only that kind is offered, and in Find the words still last", async () => {
  assert.deepEqual(ledBy('Find', 'within roof'), { kind: 'In', rest: 'roof' });
  const all = await choicesFor('Find', 'type ta', { most: 3, wide: 12, lens, schema: schemaOf(words), read });
  assert.deepEqual(all.map((c: { kind: string; label: string }) => `${c.kind} ${c.label}`), ['Type Task', 'Words “type ta”']);
});

test('Only offers its plain words and statuses; Walk each way along a link; Limit a number', async () => {
  const c = { most: 3, wide: 12, lens, schema: schemaOf(words), read };
  assert.ok((await choicesFor('Only', 'do', c)).some((x: { term?: { only?: string } }) => x.term?.only === 'done'));
  assert.deepEqual((await choicesFor('Walk', 'depends', c)).map((x: { walk: string }) => x.walk), ['depends_on>', 'depends_on<', 'depends_on']);
  assert.deepEqual((await choicesFor('Limit', '40', c)).map((x: { limit: number }) => x.limit), [40]);
});

test('the lens is changed as the bar changes it: words replaced or added, a term added, Not done lifted by Only done', () => {
  assert.deepEqual(withWords(lens.filter, ['roof']).find, ['text roof', 'type task']);
  assert.deepEqual(added({ filter: { not: ['done'] }, view: 'e_x' }, { only: 'done' }), { filter: { not: [], only: ['done'] } });
});

test('typing draws marks the host accepts, and Enter moves the page to the words, find staying open', async () => {
  const moved: unknown[] = [], state: Record<string, unknown> = {}, drawn: unknown[] = [];
  const tools = { read, go: (a: unknown) => moved.push(a), state: (n: string, v: unknown) => (state[n] = v), marks: (m: unknown) => drawn.push(m) };
  const part = find({ words, address: { query: lens, drawn: { count: 0 } }, style: { numbers: {} } }, tools);
  checkMarks(part.marks, { kinds: KINDS });
  checkMarks(part.on({ key: 'q', name: 'edit', value: 'roof' }), { kinds: KINDS });
  assert.equal(state.find_open, '1');
  checkMarks(part.on({ key: 'q', name: 'submit', value: 'roof' }), { kinds: KINDS });
  assert.deepEqual(moved, [{ query: { filter: { find: ['text roof', 'type task'] } } }]);
  assert.equal(state.find_open, '1');
  assert.equal(part.on({ key: 'q', name: 'key', value: 'Escape', empty: true }) !== undefined, true);
  assert.equal(state.find_open, null);
});

test("a part's word and a space puts find in that part; Backspace in an empty field goes back", () => {
  const tools = { read, go: () => {}, state: () => {}, marks: () => {} };
  const part = find({ words, address: { query: lens } }, tools);
  const m = JSON.stringify(part.on({ key: 'q', name: 'edit', value: 'only ' }));
  assert.match(m, /"Only"/);
  assert.match(JSON.stringify(part.on({ key: 'q', name: 'key', value: 'Backspace', empty: true })), /"Find"/);
});
