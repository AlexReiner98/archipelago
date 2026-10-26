// Where a person put things on a canvas (decision e_n2825x2w): the places stream, one place per canvas and item, written
// a batch at a time with places_put and read a canvas at a time with places; compacted to the newest per canvas and item;
// never an item or a link; and the style that kept places before moved into it and retired.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agent, fresh, human, make } from './map.ts';
import { compact, opEntries, readOps, seal } from '../src/streams.ts';
import { kept, type OpEntry } from '../src/retention.ts';
import { movePlaces, placeField, placesOn, putPlaces } from '../src/canvas-places.ts';
import { callTool } from '../src/tools.ts';
import { verify } from '../src/log.ts';

const DAY = 86_400_000;

test('a batch of moves is written at once and read back by canvas, newest per item', async () => {
  const l = await fresh();
  const { p, a, b } = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'P' },
    { op: 'create', ref: 'a', type: 'work.task', title: 'A' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'B' },
  ]);
  const counted = async () => Number((await l.db.query<{ n: number }>(`select (select count(*) from entity) + (select count(*) from relation) as n`)).rows[0].n);
  const before = await counted();
  assert.deepEqual(await putPlaces(l, human, { canvas: p, moves: { [a]: [10.4, 20.6], [b]: [30, 40] } }), { canvas: p, put: 2, forgotten: 0 });
  assert.deepEqual(await putPlaces(l, human, { moves: { [a]: [1, 2] } }), { canvas: 'default', put: 1, forgotten: 0 }, 'no canvas named: the whole map');
  await putPlaces(l, human, { canvas: p, moves: { [a]: [50, 60] } });
  assert.deepEqual(await placesOn(l, p), { [a]: [50, 60], [b]: [30, 40] }, 'the newest of each, rounded');
  assert.deepEqual(await placesOn(l, undefined), { [a]: [1, 2] }, 'each canvas its own');
  assert.equal(await counted(), before, 'never an item or a link');

  const entries = await opEntries(l.db, 'places');
  assert.equal(entries.length, 4, 'each place an entry of its own, so a member reads those of what they may see');
  assert.ok(entries.every((e) => e.rule === 'places' && e.facts.length === 1));
  assert.notDeepEqual(entries[0].facts[0][3], [10, 21], 'sealed with the item’s key in the log');
  assert.deepEqual((await readOps(l.db, 'places'))[0].facts[0], ['+', a, placeField(p), [10, 21]]);

  assert.deepEqual(await putPlaces(l, human, { canvas: p, moves: { [b]: null } }), { canvas: p, put: 0, forgotten: 1 });
  assert.deepEqual(await placesOn(l, p), { [a]: [50, 60] }, 'a place forgotten is laid by the drawing again');
  assert.deepEqual(await putPlaces(l, human, { canvas: p, clear: true, moves: { [b]: [5, 5] } }), { canvas: p, put: 1, forgotten: 1 });
  assert.deepEqual(await placesOn(l, p), { [b]: [5, 5] }, 'laid out again, then what was moved since');
});

test('a move names a canvas and items the map has, each at [x, y]', async () => {
  const l = await fresh();
  const { a } = await make(l, [{ op: 'create', ref: 'a', type: 'work.task', title: 'A' }]);
  await assert.rejects(putPlaces(l, human, { canvas: 'nowhere', moves: { [a]: [1, 2] } }), /No canvas "nowhere"/);
  await assert.rejects(putPlaces(l, human, { canvas: 'e_00000000', moves: { [a]: [1, 2] } }), /No canvas/);
  await assert.rejects(putPlaces(l, human, { moves: { e_00000000: [1, 2] } }), /No item e_00000000/);
  await assert.rejects(putPlaces(l, human, { moves: { [a]: [1, Number.NaN] as [number, number] } }), /\[x, y\]/);
  assert.equal((await opEntries(l.db, 'places')).length, 0, 'nothing of a refused batch is written');
});

test('an agent puts and reads places through revise and query, at once', async () => {
  const l = await fresh();
  const { a } = await make(l, [{ op: 'create', ref: 'a', type: 'work.task', title: 'A' }]);
  const put = (await callTool(l, agent, 'revise', { action: 'places_put', params: { moves: { [a]: [7, 8] } } })) as { put: number };
  assert.equal(put.put, 1);
  assert.deepEqual(await callTool(l, agent, 'query', { name: 'places' }), { [a]: [7, 8] });
  assert.deepEqual(await callTool(l, human, 'places', {}), { [a]: [7, 8] }, 'the page reads them by the same name');
});

test('keep latest for places: the newest place of each item on each canvas stays, the rest goes', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const at = (d: number) => new Date(now.getTime() - d * DAY).toISOString();
  const entries: OpEntry[] = [
    { pos: 1, at: at(40), rule: 'places', facts: [['+', 'e_a', 'place:default', [1, 1]]] },
    { pos: 2, at: at(30), rule: 'places', facts: [['+', 'e_a', 'place:e_p', [2, 2]]] },
    { pos: 3, at: at(20), rule: 'places', facts: [['+', 'e_a', 'place:default', [3, 3]]] },
    { pos: 4, at: at(10), rule: 'places', facts: [['+', 'e_b', 'place:default', [4, 4]]] },
  ];
  const rules = [{ id: 'places', stream: 'places', keep: { latest: true } }];
  assert.deepEqual([...kept(entries, rules, now)].sort(), [2, 3, 4], 'one place per canvas and item, however old');
});

test('compaction leaves the newest place of each item on each canvas, and the chain verifies', async () => {
  const l = await fresh();
  const { a, b } = await make(l, [
    { op: 'create', ref: 'a', type: 'work.task', title: 'A' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'B' },
  ]);
  for (const [x, y] of [[1, 1], [2, 2], [3, 3]]) await putPlaces(l, human, { moves: { [a]: [x, y], [b]: [y * 10, x * 10] } });
  // Sealed and compacted as tomorrow: the day they were written is closed.
  const tomorrow = new Date(Date.now() + DAY);
  await seal(l.db, 'default', tomorrow);
  const { dropped } = await compact(l.db, 'default', l.registry.rules, tomorrow);
  assert.equal(dropped, 4, 'the two older places of each go');
  assert.deepEqual(await placesOn(l, undefined), { [a]: [3, 3], [b]: [30, 30] }, 'where each stands now is untouched');
  assert.deepEqual((await verify(l.db)).problems, []);
});

test("a style's places move into the stream, and the style is retired", async () => {
  const l = await fresh();
  const { p, a, b, blob, other } = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'P' },
    { op: 'create', ref: 'a', type: 'work.task', title: 'A' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'B' },
    { op: 'create', ref: 'blob', type: 'style', title: 'Canvas places', status: 'current' },
    { op: 'create', ref: 'other', type: 'style', title: 'Looks', status: 'current', props: { lit: 'you' } },
  ]);
  // As the page kept them before the stream: a field on the style, by canvas (an item, a view's own, or "map").
  const places = { map: { [a]: [1, 2] }, [p]: { [a]: [3, 4], [b]: [5.6, 7] }, holding: { [b]: [9, 9] }, [`${p}x`]: { [a]: [0, 0] } };
  await l.db.query(`update entity set props = props || jsonb_build_object('places', $2::jsonb) where id = $1`, [blob, JSON.stringify(places)]);

  assert.equal(await movePlaces(l), 3, 'the places of the map and of an item; a view’s own key is not a canvas now');
  assert.deepEqual(await placesOn(l, undefined), { [a]: [1, 2] });
  assert.deepEqual(await placesOn(l, p), { [a]: [3, 4], [b]: [6, 7] });
  const was = await l.entity(blob);
  assert.equal(was!.status, 'retired', 'the style that kept them is retired');
  assert.equal(was!.props.places, undefined, 'and keeps them no longer');
  assert.equal((await l.entity(other))!.status, 'current', 'another style is left as it was');
  assert.equal(await movePlaces(l), 0, 'run once: nothing is moved again');
  assert.deepEqual((await verify(l.db)).problems, []);
});
