// A lens that starts from an item reads only what is around it, and answers as a read of the whole map would.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockGraph } from '../src/blocking.ts';
import { lens } from '../src/lens.ts';
import { aroundOf } from '../src/lens-scan.ts';
import { scanAround } from '../src/region.ts';
import { fresh, make } from './map.ts';

test('a lens from an item reads what is around it, and nothing else', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Product' },
    { op: 'create', ref: 'a', type: 'work.task', title: 'Build it' },
    { op: 'create', ref: 'x', type: 'work.task', title: 'Elsewhere, needed first' },
    { op: 'create', ref: 'x1', type: 'work.task', title: 'A part of that' },
    { op: 'create', ref: 'u', type: 'work.task', title: 'Unrelated' },
    { op: 'create', ref: 'o', type: 'work.project', title: 'Other' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'x' },
    { op: 'link', type: 'part_of', from: 'x', to: 'o' },
    { op: 'link', type: 'part_of', from: 'x1', to: 'x' },
    { op: 'link', type: 'part_of', from: 'u', to: 'o' },
  ]);
  const { entities } = await scanAround(l, aroundOf(l, made.p, {}, []));
  const read = new Set(entities.map((e) => e.id));
  // Inside it, what it is tied to, and what is inside that (for the counts); not what is beside that.
  for (const id of [made.p, made.a, made.x, made.x1]) assert.ok(read.has(id), `reads ${id}`);
  assert.ok(!read.has(made.u), 'what sits beside what it is tied to is not read');

  const answer = await lens(l, { from: made.p });
  assert.deepEqual(answer.items.map((i) => i.id).sort(), [made.p, made.a, made.x].sort(), 'what it depends on is brought in');
  assert.equal(answer.items.find((i) => i.id === made.x)!.within.items, 1, 'what is inside what was brought in is counted, though not sent');
  assert.equal(answer.items.find((i) => i.id === made.a)!.state.blocked, true);
  assert.deepEqual(answer.links.map((k) => [k.kind, k.from, k.to]), [['depends_on', made.a, made.x]]);
  assert.equal(answer.rest.closed + answer.rest.system, 0, 'what is left out is counted among what was read');

  // What blocks what, read for some items, says what the whole graph says of them.
  const [whole, some] = [await blockGraph(l), await blockGraph(l, [made.a])];
  assert.equal(some.isBlocked(made.a), whole.isBlocked(made.a));
  assert.deepEqual(some.roots(made.a), whole.roots(made.a));
});

test('a lens that goes near reads what it walks to', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'a', type: 'work.task', title: 'A' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'B' },
    { op: 'create', ref: 'c', type: 'work.task', title: 'C' },
    { op: 'create', ref: 'd', type: 'work.task', title: 'D' },
    { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    { op: 'link', type: 'depends_on', from: 'b', to: 'c' },
    { op: 'link', type: 'depends_on', from: 'c', to: 'd' },
  ]);
  const answer = await lens(l, { from: made.a, near: 2, over: ['depends_on'], fold: [] });
  assert.deepEqual(answer.items.map((i) => i.title).sort(), ['A', 'B', 'C'], 'two steps either way, and no further');
});
