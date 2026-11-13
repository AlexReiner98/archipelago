// The menu pack, tested without a database: the handler's ops for a view kept or deleted (menu.save_view,
// menu.drop_view), and the band part's marks and what it sends for what it is handed.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { dropView, saveView } from './handler.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import band from './parts/band/index.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { changedFrom, saveInput, upOf } from './parts/band/views.js';

const lens = { id: 'e_lens0001', type: 'lens', title: 'My tasks', status: 'kept', props: { filter: { find: ['type task'] }, style: { shape: 'grid', columns: ['title'] } } };
const query = { filter: { find: ['type task'] }, walk: { over: [], steps: 0 } };
const pictures = [
  { lens: 'e_lens0001', title: 'My tasks', life: 'kept', filter: { find: ['type task'] }, walk: { over: [], steps: 0 }, shape: 'grid' },
  { lens: 'e_lens0002', title: 'An agent’s view', life: 'working', filter: { find: ['type issue'] }, walk: { over: [], steps: 0 } },
  { lens: 'core.open_work', title: 'Open work', life: 'kept', preset: true, filter: { find: ['open'] }, walk: { over: [], steps: 0 } },
];
const handed = (address: unknown, piece = {}) => ({ address, piece, views: { saved_views: { pictures } } });

test('a view saved into one kept keeps its own settings, and is kept on the person’s word', () => {
  const made = saveView({ id: lens.id, title: 'My tasks', filter: { find: ['type task', 'open'] }, style: { shape: 'list', canvas: 'e_x' } }, lens);
  assert.deepEqual(made.ops, [{ op: 'update', id: lens.id, status: 'kept', props: { filter: { find: ['type task', 'open'] }, walk: { over: [], steps: 0 }, limit: null, time: null, sessions: null, style: { columns: ['title'], shape: 'list' } } }]);
  const fresh = saveView({ title: 'New one', filter: { find: [] }, preset: 'core.open_work' }, null);
  assert.equal(fresh.ops[0].op, 'create');
  assert.equal(fresh.ops[0].type, 'lens');
  assert.equal(fresh.ops[0].ref, 'view');
  assert.equal(fresh.ops[0].props.preset, 'core.open_work');
});

test('a view needs a name of a few words, a query, and saving into one needs a kept view', () => {
  assert.throws(() => saveView({ title: ' ', filter: {} }, null), /needs a name/);
  assert.throws(() => saveView({ title: 'x'.repeat(61), filter: {} }, null), /60 characters/);
  assert.throws(() => saveView({ title: 'x' }, null), /filter/);
  assert.throws(() => saveView({ id: 'e_task0001', title: 'x', filter: {} }, { id: 'e_task0001', type: 'task' }), /not a kept view/);
});

test('a view deleted is retired, once', () => {
  assert.deepEqual(dropView(lens).ops, [{ op: 'update', id: lens.id, status: 'retired' }]);
  assert.deepEqual(dropView({ ...lens, status: 'retired' }).ops, []);
  assert.throws(() => dropView({ id: 'e_task0001', type: 'task' }), /not a kept view/);
});

test('the view up is the one the address names, else a pack’s whose query is up; moved when its query or shape is', () => {
  assert.equal(upOf(handed({ query, layout: { canvas: 'e_lens0001' } }))?.lens, 'e_lens0001');
  assert.equal(upOf(handed({ query: { filter: { find: ['open'] } }, layout: {} }))?.lens, 'core.open_work');
  assert.equal(upOf(handed({ query: { filter: { find: ['other'] } }, layout: {} })), null);
  const up = pictures[0];
  assert.equal(changedFrom(up, { query, layout: { shape: 'grid' } }), false);
  assert.equal(changedFrom(up, { query, layout: { shape: 'list' } }), true);
  assert.equal(changedFrom(up, { query: { filter: { find: ['type task', 'open'] } }, layout: {} }), true);
  const sent = saveInput(handed({ query: { ...query, limit: 50 }, layout: { shape: 'grid', style: 'e_style001', canvas: 'e_lens0001' } }), 'My tasks', up);
  assert.deepEqual(sent, { id: 'e_lens0001', title: 'My tasks', filter: query.filter, walk: query.walk, limit: 50, style: { shape: 'grid', style: 'e_style001' } });
});

/** The keys of a mark and all in it. */
const keys = (m: unknown): string[] => (Array.isArray(m) ? [...(m[1]?.key ? [m[1].key] : []), ...m.slice(1).flatMap(keys)] : []);
const texts = (m: unknown): string[] => (Array.isArray(m) ? (m[0] === 'text' ? [String(m[m.length - 1])] : m.slice(1).flatMap(texts)) : []);

test('the band offers Save as the view up stands, and nothing on Home', () => {
  const tools = { marks() {}, act: async () => ({}), go() {} };
  assert.deepEqual(keys(band(handed(null), tools).marks), [], 'Home keeps nothing');
  const kept = band(handed({ query, layout: { canvas: 'e_lens0001', shape: 'grid' } }), tools).marks;
  assert.ok(texts(kept).includes('Saved'), 'a kept view unmoved is said saved');
  assert.deepEqual(keys(kept), ['more', 'new', 'drop']);
  const moved = band(handed({ query: { filter: { find: ['type task', 'open'] } }, layout: { canvas: 'e_lens0001' } }), tools).marks;
  assert.ok(JSON.stringify(moved).includes('Save •'));
  const working = band(handed({ query: { filter: { find: ['type issue'] } }, layout: { canvas: 'e_lens0002' } }), tools).marks;
  assert.ok(JSON.stringify(working).includes('"Keep"'));
  const none = band(handed({ query: { filter: { find: ['nothing'] } }, layout: {} }), tools).marks;
  assert.deepEqual(keys(none), ['save']);
});

test('Save with nothing up asks a name in the band, sends it, and goes to the view kept', async () => {
  const sent: unknown[] = [], went: unknown[] = [];
  const tools = { marks() {}, act: async (action: string, params: unknown) => (sent.push([action, params]), { status: 'applied', created: { view: 'e_new00001' } }), go: (a: unknown) => went.push(a) };
  const address = { query: { filter: { find: ['nothing'] } }, layout: { shape: 'list' } };
  const part = band(handed(address), tools);
  assert.deepEqual(keys(await part.on({ name: 'press', key: 'save' })), ['name', 'name:save', 'name:cancel']);
  await part.on({ name: 'edit', key: 'name', value: 'Nothing much' });
  await part.on({ name: 'press', key: 'name:save' });
  assert.deepEqual(sent, [['menu.save_view', { title: 'Nothing much', filter: { find: ['nothing'] }, walk: { over: [], steps: 0 }, style: { shape: 'list' } }]]);
  assert.deepEqual(went, [{ query: address.query, layout: { shape: 'list', canvas: 'e_new00001' } }]);
});

test('a name a kept view has is saved into it; Delete is confirmed in the band and leaves what is up unsaved', async () => {
  const sent: unknown[] = [], went: unknown[] = [];
  const tools = { marks() {}, act: async (action: string, params: unknown) => (sent.push([action, params]), { status: 'applied', created: {} }), go: (a: unknown) => went.push(a) };
  const address = { query, layout: { canvas: 'e_lens0001', shape: 'grid' } };
  const part = band(handed(address), tools);
  await part.on({ name: 'press', key: 'new' });
  await part.on({ name: 'submit', key: 'name', value: 'my TASKS' });
  assert.equal((sent[0] as [string, { id: string }])[1].id, 'e_lens0001');
  const asked = await part.on({ name: 'press', key: 'drop' });
  assert.deepEqual(keys(asked), ['drop:yes', 'drop:no']);
  await part.on({ name: 'press', key: 'drop:yes' });
  assert.deepEqual(sent[1], ['menu.drop_view', { id: 'e_lens0001' }]);
  assert.deepEqual(went[1], { query, layout: { shape: 'grid', canvas: null } });
});

test('a refusal is said in the band, and nothing moves', async () => {
  const went: unknown[] = [];
  const tools = { marks() {}, act: async () => ({ error: 'This session may only read the map.' }), go: (a: unknown) => went.push(a) };
  const part = band(handed({ query, layout: { canvas: 'e_lens0002' } }), tools);
  const after = await part.on({ name: 'press', key: 'save' });
  assert.ok(texts(after).includes('This session may only read the map.'));
  assert.deepEqual(went, []);
});
