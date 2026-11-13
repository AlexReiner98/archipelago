// The islands pack, tested without a database: the ops that make an island with its first item (islands.make), and
// the part's form in the band, what it sends and where the page goes after.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { makeIsland } from './handler.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import islandNew, { offered, withIsland } from './parts/new/index.js';

test('an island is made with its first item on it, as one change', () => {
  const made = makeIsland({ title: 'Garden', pack: 'software', first: { type: 'task', title: 'Dig the beds' } });
  assert.deepEqual(made.ops, [
    { op: 'create', ref: 'island', type: 'island', title: 'Garden', status: 'current', props: { pack: 'software' } },
    { op: 'create', ref: 'first', type: 'task', title: 'Dig the beds', props: { island: '{island}' } },
  ]);
  assert.throws(() => makeIsland({ title: '', pack: 'core', first: { type: 'task', title: 'x' } }), /needs a name/);
  assert.throws(() => makeIsland({ title: 'x', pack: 'Core!', first: { type: 'task', title: 'x' } }), /speaks a pack/);
  assert.throws(() => makeIsland({ title: 'x', pack: 'core', first: { title: 'x' } }), /needs a type/);
  assert.throws(() => makeIsland({ title: 'x', pack: 'core', first: { type: 'task', title: ' ' } }), /first item needs a name/);
});

const piece = { packs: ['core', 'software'], names: ['Core', 'Software'], types: ['core task', 'software repo', 'software issue'], type_names: ['Task', 'Repository', 'Issue'] };

test('it offers the island packs and the types each starts with, and keeps the island in sight', () => {
  assert.deepEqual(offered(piece).packs, [{ id: 'core', title: 'Core' }, { id: 'software', title: 'Software' }]);
  assert.deepEqual(offered(piece).types.filter((t: { pack: string }) => t.pack === 'software').map((t: { id: string }) => t.id), ['repo', 'issue']);
  const q = { filter: { find: ['type task'] } };
  assert.deepEqual(withIsland(q, 'e_isl00001'), { filter: { find: ['type task', 'island e_isl00001'] } });
  const named = withIsland(q, 'e_isl00001');
  assert.equal(withIsland(named, 'e_isl00001'), named, 'a query that names it is kept as it is');
});

const keys = (m: unknown): string[] => (Array.isArray(m) ? [...(m[1]?.key ? [m[1].key] : []), ...m.slice(1).flatMap(keys)] : []);

test('with no island packs it draws nothing; pressed, it asks in the band and makes the island', async () => {
  const tools = { marks() {}, act: async () => ({}), go() {} };
  assert.deepEqual(keys(islandNew({ piece: {} }, tools).marks), []);
  const sent: unknown[] = [], went: unknown[] = [];
  const doing = { marks() {}, act: async (a: string, p: unknown) => (sent.push([a, p]), { status: 'applied', created: { island: 'e_isl00001', first: 'e_task0001' } }), go: (a: unknown) => went.push(a) };
  const address = { query: { filter: { find: ['type task'] } }, layout: { shape: 'flow' } };
  const part = islandNew({ piece, address }, doing);
  assert.deepEqual(keys(part.marks), ['island']);
  assert.deepEqual(keys(await part.on({ name: 'press', key: 'island' })), ['name', 'pack', 'first', 'make', 'cancel']);
  assert.deepEqual(keys(await part.on({ name: 'pick', key: 'pack', value: 'software' })), ['name', 'pack', 'type', 'first', 'make', 'cancel']);
  await part.on({ name: 'pick', key: 'type', value: 'issue' });
  await part.on({ name: 'edit', key: 'name', value: 'Garden' });
  const short = await part.on({ name: 'press', key: 'make' });
  assert.match(JSON.stringify(short), /first item needs a name/);
  await part.on({ name: 'submit', key: 'first', value: 'Weeds' });
  assert.deepEqual(sent, [['islands.make', { title: 'Garden', pack: 'software', first: { type: 'issue', title: 'Weeds' } }]]);
  assert.deepEqual(went, [{ query: { filter: { find: ['type task', 'island e_isl00001'] } }, layout: { shape: 'flow' } }]);
});
