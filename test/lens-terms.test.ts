// The flat lens's newer terms (the query trial, 28 Oct 2026, feature e_tpz9yd7f): Find in an item, at any depth.
// Each is read the same by the server, the page's address and an agent.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flatLens } from '../src/lens-flat.ts';
import { viewAddress } from '../src/view-address.ts';
import { fresh, make } from './map.ts';

const titles = (answer: { items: { title: string }[] }) => answer.items.map((i) => i.title).sort();

async function project() {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Rework' },
    { op: 'create', ref: 'f', type: 'feature', title: 'The bar' },
    { op: 'create', ref: 'a', type: 'task', title: 'Find in' },
    { op: 'create', ref: 'q', type: 'decision', title: 'Which words?' },
    { op: 'create', ref: 'x', type: 'task', title: 'Done already', status: 'done' },
    { op: 'create', ref: 'o', type: 'task', title: 'Elsewhere' },
    { op: 'link', type: 'part_of', from: 'f', to: 'p' },
    { op: 'link', type: 'part_of', from: 'a', to: 'f' },
    { op: 'link', type: 'part_of', from: 'q', to: 'f' },
    { op: 'link', type: 'part_of', from: 'x', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'o' },
  ]);
  return { l, made };
}

test('Find in an item: all that is part of it at any depth, of any type, not the item itself', async () => {
  const { l, made } = await project();
  const answer = await flatLens(l, { filter: { in: [made.p] } });
  assert.deepEqual(titles(answer), ['Done already', 'Find in', 'The bar', 'Which words?']);
  assert.ok(answer.items.every((i) => 'found' in i && i.found?.includes('in')), 'each says it was found in the item');
  assert.deepEqual(titles(await flatLens(l, { filter: { in: [made.p], exclude: ['closed'] } })), ['Find in', 'The bar', 'Which words?'], 'Not applies');
  assert.deepEqual(titles(await flatLens(l, { filter: { in: [made.p], only: ['task'] } })), ['Done already', 'Find in'], 'Only narrows it');
  assert.deepEqual(titles(await flatLens(l, { filter: { in: [made.f] }, walk: { over: ['depends_on'], steps: 1 } })), ['Elsewhere', 'Find in', 'Which words?'], 'and the walk goes on from it');
  const capped = await flatLens(l, { filter: { in: [made.p] }, limit: 2 });
  assert.deepEqual([capped.items.length, capped.cut], [2, true], 'bounded by the limit');
  assert.deepEqual(titles(await flatLens(l, { filter: { in: ['e_nothing0'] } })), [], 'in nothing, nothing');
  await assert.rejects(flatLens(l, { filter: { in: 'e_x' } }), /filter.in/);
  assert.equal(await viewAddress(l, { lens: { filter: { in: [made.p] } } }), `v?in=${made.p}`, 'the address carries it');
  await assert.rejects(viewAddress(l, { lens: { filter: { in: ['e_nothing0'] } } }), /No item/);
});
