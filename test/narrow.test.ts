// The page answers a narrowing edit itself first (task e_hygj7ybc, packs/surface/page/narrow.js): worked out from the
// answer it holds as the server works it out, or nothing where only the server can say.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error a page module, plain JavaScript
import { drawnKey, hear, holds, narrowed, opened, unheard, workedOut } from '../packs/surface/page/narrow.js';

const item = (id: string, title: string, at: string, more: Record<string, unknown> = {}): Record<string, unknown> & { id: string } => ({ id, type: 'task', title, status: 'todo', open: true, owner: null, updated_at: at, ...more });
const link = (id: string, type: string, from: string, to: string) => ({ id, type, from, to });

// Two seeds found by their type, a third by id; one step along depends_on reaches a fourth from the first.
const answer = {
  viewer: 'e_me000000',
  items: [
    item('e_id000001', 'Named', '2026-11-01', { found: ['id'], terms: ['id e_id000001'] }),
    item('e_roof0001', 'Roof canvas', '2026-11-03', { found: ['type'], terms: ['type task'] }),
    item('e_wall0001', 'Wall', '2026-11-02', { found: ['type'], terms: ['type task'], open: false, status: 'done' }),
    item('e_tile0001', 'Tiles', '2026-11-01', { step: 1 }),
  ],
  links: [link('r_1', 'depends_on', 'e_roof0001', 'e_tile0001'), link('r_2', 'part_of', 'e_wall0001', 'e_roof0001')],
};
const was = { filter: { find: ['id e_id000001', 'type task'] }, walk: { over: ['depends_on'], steps: 1 } };
const said = { find: ['id e_id000001', 'type task'], only: [], not: ['kind system'], walk: { over: ['depends_on'], steps: 1 }, limit: 500 };
const ids = (a: { items: { id: string }[] } | null) => a?.items.map((i) => i.id);

test('the answer held is worked out again from its own query, in the server\'s order', () => {
  const out = workedOut(answer, { find: said.find, walk: said.walk, limit: 500 });
  assert.deepEqual(out, answer.items.map((i) => ('found' in i ? { id: i.id, found: i.found, terms: i.terms } : { id: i.id, step: i.step })));
});

test('Only a word every seed has in its title, or not, is decided from the titles alone where they say it', () => {
  const next = { ...was, filter: { ...was.filter, only: ['text roof'] } };
  // Two seeds have no "roof" in their titles: only the server can say whether their notes or another form of the word holds.
  assert.equal(narrowed(was, next, answer, said), null, 'what the page cannot decide waits for the server');
  // What find heard of the term decides it: the named item and the wall are left out, and the tiles stay a step from the roof.
  hear({ preview: { part: 'only', terms: ['text roof'], ids: answer.items.map((i) => i.id) } }, { preview: { 'text roof': ['e_id000001', 'e_wall0001'] } });
  const first = narrowed(was, next, answer, said);
  assert.deepEqual(ids(first), ['e_roof0001', 'e_tile0001']);
  assert.deepEqual(first.links.map((l: { id: string }) => l.id), ['r_1'], 'only the links among what is kept');
  unheard();
  assert.equal(narrowed(was, next, answer, said), null, 'what was heard goes once the map moves');
});

test('Not done takes the wall away; a seed taken away is not walked from', () => {
  const next = { ...was, filter: { ...was.filter, not: ['kind system', 'done'] } };
  const first = narrowed(was, next, answer, said, { typeKnown: (t: string) => t === 'task', systemType: () => false });
  assert.deepEqual(ids(first), ['e_id000001', 'e_roof0001', 'e_tile0001']);
  // Without knowing which types are the system's, a Not said for the first time cannot be decided of the named item.
  assert.equal(narrowed(was, next, answer, said), null);
});

test('a Find term taken out leaves what only it found, and what the walk reached only from that', () => {
  const next = { ...was, filter: { find: ['id e_id000001'] } };
  assert.deepEqual(ids(narrowed(was, next, answer, said)), ['e_id000001']);
});

test('what widens, or names what the page does not hold, waits for the server', () => {
  assert.equal(narrowed(was, { ...was, filter: { find: [...was.filter.find, 'text more'] } }, answer, said), null, 'a Find term added');
  assert.equal(narrowed(was, { ...was, walk: { over: ['depends_on'], steps: 2 } }, answer, said), null, 'a longer walk');
  assert.equal(narrowed(was, { ...was, filter: { ...was.filter, only: ['done'] } }, { ...answer, cut: true }, said), null, 'an answer the limit cut');
  // An answer the page cannot work out again from its own query is none it can narrow.
  const stale = { ...answer, items: answer.items.map((i) => (i.id === 'e_tile0001' ? { ...i, step: 2 } : i)) };
  assert.equal(narrowed(was, { ...was, filter: { ...was.filter, only: ['done'] } }, stale, said), null);
});

test('a Find term read to the end of the room the limit left may have found more: the page cannot narrow it', () => {
  // The roof is named and is a task; the type is read with room for two, and fills it: a third task may be there.
  const full = {
    items: [
      item('e_roof0001', 'Roof', '2026-11-03', { found: ['id', 'type'], terms: ['id e_roof0001', 'type task'] }),
      item('e_wall0001', 'Wall', '2026-11-02', { found: ['type'], terms: ['type task'] }),
    ],
    links: [],
  };
  const lens = { filter: { find: ['id e_roof0001', 'type task'] }, limit: 2 };
  const read = { find: ['id e_roof0001', 'type task'], only: [], not: ['kind system'], walk: { over: [], steps: 0 }, limit: 2 };
  const next = { ...lens, filter: { ...lens.filter, only: ['status todo'] } };
  assert.equal(narrowed(lens, next, full, read), null);
  assert.deepEqual(ids(narrowed({ ...lens, limit: 3 }, { ...next, limit: 3 }, full, { ...read, limit: 3 })), ['e_roof0001', 'e_wall0001'], 'with room to spare, it can');
});

test('a term is decided from the item where the item says it, and the search only as typed in a title', () => {
  const roof = answer.items[1];
  assert.equal(holds('only', 'text CANVAS', roof), true);
  assert.equal(holds('only', 'text tiles', roof), undefined, 'not in the title: perhaps in the note, or in another form');
  assert.equal(holds('only', 'text roof_', roof), undefined, 'an ilike wildcard');
  assert.equal(holds('only', 'done', answer.items[2]), true);
  assert.equal(holds('only', 'status todo', roof), true);
  assert.equal(holds('only', 'owner me', roof, { viewer: 'e_me000000' }), false);
  assert.equal(holds('only', 'blocked', roof), undefined);
});

test('two answers alike are said alike, whatever order their links and fields came in', () => {
  const a = { lens: { find: ['x'] }, matched: 3, items: [{ id: 'e_1', title: 'A', type: 't' }], links: [link('r_2', 'x', 'e_1', 'e_1'), link('r_1', 'x', 'e_1', 'e_1')] };
  const b = { lens: { find: ['y'] }, items: [{ type: 't', title: 'A', id: 'e_1' }], links: [link('r_1', 'x', 'e_1', 'e_1'), link('r_2', 'x', 'e_1', 'e_1')] };
  assert.equal(drawnKey(a), drawnKey(b));
  assert.notEqual(drawnKey(a), drawnKey({ ...b, items: [{ ...b.items[0], title: 'B' }] }));
  const aged = (age: number) => ({ ...b, items: [{ ...b.items[0], sessions: [{ run: 'e_run00001', age }] }, ...b.items.slice(1)] });
  assert.equal(drawnKey(aged(35)), drawnKey(aged(36)), 'a session a minute older draws alike');
});

test("a pack's parts opened on an island the answer holds are answered here, as the server makes them (e_m5x8pmwu)", () => {
  const build = { id: 'build', title: 'Build', state: 'active', parts: [{ id: 'build.lane', kind: 'type', state: 'active' }], provides: ['type:build.lane'], consumes: [], types: [], links: [], requires: [{ id: 'runs', title: 'Runs', state: 'waiting', parts: [] }], off_would_wait: 2 };
  const held = { ...answer, islands: [{ id: 'e_isle0001', title: 'An island', pack: build }, { id: 'e_isle0002', title: 'Another' }] };
  const out = opened(was, { ...was, filter: { find: [...was.filter.find, 'parts  build e_isle0001'] } }, held, said);
  assert.deepEqual(out.islands.map((i: { id: string }) => i.id), ['e_isle0001', 'parts:e_isle0001:build', 'e_isle0002'], 'after the island it is of');
  assert.deepEqual(out.islands[1], { id: 'parts:e_isle0001:build', title: 'Build: its parts', parts_of: { island: 'e_isle0001', pack: 'build' }, pack: { id: 'build', title: 'Build', state: 'active', parts: build.parts, provides: build.provides, consumes: [] } });
  assert.deepEqual(out.items, held.items, 'the same items');
  assert.deepEqual(out.lens.find, [...said.find, 'parts build e_isle0001']);
  assert.equal(opened(was, { ...was, filter: { find: [...was.filter.find, 'parts runs e_isle0001'] } }, held, said).islands[1].pack.id, 'runs', 'a pack it requires');
  for (const find of [['parts build e_isle0002'], ['parts build e_nothere0'], ['type decision'], []]) assert.equal(opened(was, { ...was, filter: { find: [...was.filter.find, ...find] } }, held, said), null, `not for ${find.join(', ') || 'no term added'}`);
  assert.equal(opened(was, { ...was, filter: { find: [...was.filter.find, 'parts build e_isle0001'], only: ['type task'] } }, held, said), null, 'nor with anything else changed');
});
