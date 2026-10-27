// What a picker offers first (ui/picker-rank.js, task e_css8swr9): what the canvas uses, then what is used around it,
// then the rest; never what is retired or dormant.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error a page module, plain JavaScript
import { around, ranked, uses } from '../ui/picker-rank.js';

const defs = [{ id: 'link' }, { id: 'part_of' }, { id: 'depends_on' }, { id: 'blocks', retired: true }, { id: 'old', dormant: true }, { id: 'waits_on' }, { id: 'about' }];

test('a picker leads with what is used here, then around, then the rest in the registry order', () => {
  const here = uses([], [{ id: 'r1', type: 'depends_on' }, { id: 'r2', type: 'part_of' }, { id: 'r3', type: 'part_of' }]).links;
  const near = new Map([['waits_on', 1], ['part_of', 9]]);
  const got = ranked(defs, here, near);
  assert.deepEqual(got.map((d: { id: string }) => d.id), ['part_of', 'depends_on', 'waits_on', 'link', 'about']);
  assert.deepEqual(got.map((d: { near?: string }) => d.near), ['here', 'here', 'around', undefined, undefined]);
});

test('retired and dormant definitions are never offered, used or not', () => {
  const ids = ranked(defs, new Map([['blocks', 3]]), new Map([['old', 2]])).map((d: { id: string }) => d.id);
  assert.ok(!ids.includes('blocks') && !ids.includes('old'));
  assert.deepEqual(ranked(defs).map((d: { id: string }) => d.id), ['link', 'part_of', 'depends_on', 'waits_on', 'about']);
});

test('around counts only what the canvas does not draw', () => {
  const drawn = { items: [{ id: 'e_a', type: 'task' }], links: [{ id: 'r1', type: 'part_of' }] };
  const wider = { items: [{ id: 'e_a', type: 'task' }, { id: 'e_b', type: 'question' }, { id: 'e_c', type: 'question' }], links: [{ id: 'r1', type: 'part_of' }, { id: 'r2', type: 'waits_on' }] };
  const got = around(drawn, wider);
  assert.deepEqual([...got.types], [['question', 2]]);
  assert.deepEqual([...got.links], [['waits_on', 1]]);
});
