// The runtime's services to the parts on its frame (tasks e_926g89jb, e_gaa2ubge, e_dswpuaft, e_rreguzes): the lens
// algebra a part names a change by instead of keeping it (packs/walls/page/lens-terms.js), and what the frame's slots
// are handed (packs/walls/page/part-slots.js), kept alike with the contract in packs/loader/kernel/slots.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error a page module, plain JavaScript
import { added, filterSaid, idsNamed, moved, namer, without } from '../packs/walls/page/lens-terms.js';
// @ts-expect-error a page module, plain JavaScript
import { ANSWER_SLOTS, DECISION_SLOTS, QUERY_SLOTS, SHOWN_WHILE, answerBrief, withSaid } from '../packs/walls/page/part-slots.js';
import { DECISION_SLOTS as DECIDES, FRAME_SLOTS, SHOWN_WHILE as SHOWN } from '../packs/loader/kernel/slots.ts';

const words = { types: { task: { title: 'Task' } }, links: { part_of: 'is part of' } };
const lens = { filter: { find: ['type task', 'part_of e_aaaaaaaa'] }, limit: 40 };

test('a term added or taken out makes the lens a part names, the algebra kept by the runtime', () => {
  assert.deepEqual(moved(lens, { add: { only: 'blocked' } }), { filter: { ...lens.filter, only: ['blocked'] }, limit: 40 });
  assert.deepEqual(moved(lens, { add: { not: 'done' } })?.filter.not, ['kind system', 'done'], "Not keeps the system's own out as it adds");
  assert.deepEqual(moved(lens, { take: { part: 'find', value: 'type task' } }), { filter: { find: ['part_of e_aaaaaaaa'] }, limit: 40 });
  assert.equal(moved(lens, { take: { part: 'find', value: 'type task' } })?.filter.only, undefined);
  // Only what is done finds nothing while Not leaves the done out: adding it takes that away.
  assert.deepEqual(added({ filter: { not: ['done'] } }, { only: 'done' }).filter, { not: [], only: ['done'] });
  // A term added to a lens that names a view makes it a filter of the map again.
  assert.equal('view' in added({ view: 'e_bbbbbbbb', filter: {} }, { find: 'type task' }), false);
  assert.deepEqual(without({ filter: { only: ['blocked'] } }, 'only', 'blocked').filter, {});
  // A part's words are checked: a part that is not one of the three, a term that is not words, or nothing at all.
  for (const wrong of [{}, { add: {} }, { add: { find: 3 } }, { add: { walk: 'x' } }, { add: { find: 'a\nb' } }, { take: { part: 'walk', value: 'x' } }, { take: { part: 'find' } }]) assert.equal(moved(lens, wrong), null, JSON.stringify(wrong));
});

test('every lens handed to a part says itself in a few words', () => {
  const names = { e_aaaaaaaa: 'Server' };
  assert.deepEqual(idsNamed({ find: ['type task', 'part_of e_aaaaaaaa'], only: ['id e_aaaaaaaa', 'owner me'] }), ['e_aaaaaaaa']);
  assert.equal(filterSaid(lens.filter, namer(words, names).termSaid), 'Task · is part of Server');
  assert.equal(filterSaid({ find: ['text roof', 'type a', 'type b'], only: ['blocked'] }, namer(words).termSaid), '“roof” · 2 types · only blocked');
  assert.equal(namer(words).termSaid('related e_cccccccc'), 'related to an item', 'an item not named is said as one');
  assert.deepEqual(withSaid(lens, words, names), { ...lens, said: 'Task · is part of Server' });
  assert.equal(withSaid(null, words, names), null);
});

test('the bar is handed the answer in brief: what found each item, its links, and whether it was cut', () => {
  const answer = { items: [{ id: 'e_1', type: 'task', title: 'A', status: 'todo', terms: ['type task'], body: 'long' }, { id: 'e_2', type: 'task', title: 'B', step: 1 }], links: [{ id: 'r_1', type: 'part_of', from: 'e_2', to: 'e_1', props: { x: 1 } }], cut: true };
  assert.deepEqual(answerBrief(answer, { limit: 40, failed: undefined }), {
    items: [{ id: 'e_1', type: 'task', status: 'todo', terms: ['type task'] }, { id: 'e_2', type: 'task', step: 1 }],
    links: [{ id: 'r_1', type: 'part_of', from: 'e_2', to: 'e_1' }],
    cut: true,
    limit: 40,
  });
  assert.deepEqual(answerBrief(null, { failed: 'no such type' }), { items: [], links: [], failed: 'no such type' });
  assert.equal(answerBrief({ items: Array.from({ length: 600 }, (_, i) => ({ id: `e_${i}`, type: 't' })) }).items.length, 500);
});

test("the page's slot lists are the contract's", () => {
  const handed = (key: string) => Object.entries(FRAME_SLOTS).filter(([, given]) => (given as readonly string[]).includes(key)).map(([slot]) => slot).sort();
  assert.deepEqual([...QUERY_SLOTS].sort(), handed('query'), 'the slots handed the canvas query');
  assert.deepEqual([...ANSWER_SLOTS].sort(), handed('answer'));
  assert.deepEqual(DECISION_SLOTS, DECIDES);
  assert.deepEqual(SHOWN_WHILE, SHOWN);
  for (const slot of [...DECISION_SLOTS, ...Object.keys(SHOWN_WHILE)]) assert.ok(slot in FRAME_SLOTS, `${slot} is a frame slot`);
});
