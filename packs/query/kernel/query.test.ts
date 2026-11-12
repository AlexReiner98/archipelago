// The query pack run without a database: its modules read no map, so input in, answer out. Against a real map:
// test/layouts-sent.test.ts, through the shims in src/ (an altitude is the loader's: test/altitude.test.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSteps, stepIds, stepsShown, stepsWrong } from './query-steps.ts';
import { countBy, summed } from './summary.ts';
import { flat, flatCheck } from './answers.ts';
import type { KernelContext } from '#pelago/kernel';

test('what changed is summed: few enough given whole, else counted with the newest', () => {
  assert.deepEqual(summed([1, 2], String), { newest: [1, 2] });
  const many = ['a', 'b', 'a', 'c', 'a', 'b', 'a'];
  assert.deepEqual(summed(many, (x) => x, 3), { counts: { a: 4, b: 2, c: 1 }, newest: ['a', 'b', 'a'], more: 4 });
  assert.deepEqual(Object.keys(countBy(many, (x) => x)), ['a', 'b', 'c'], 'the most first');
});

test("a lens's steps are checked, name their items, and show a reader only what the picture does", () => {
  const steps = readSteps([{ add: ['a', 'b'], titles: { c: 'Then' }, lit: [['a', 'b']] }, { remove: ['b'], card: { title: 'End' } }]);
  assert.deepEqual(stepIds(steps).sort(), ['a', 'b', 'c']);
  assert.match(stepsWrong([{ add: 'a' }])!, /add and remove are lists of ids/);
  assert.equal(stepsWrong(steps), undefined);
  assert.deepEqual(stepsShown(steps, new Set(['a'])), [{ add: ['a'], titles: {}, lit: [] }, { card: { title: 'End' }, remove: [] }]);
});

test('the flat lens by name is the view flat read as the asker; a check reads one item and says what is wrong', async () => {
  const asked: unknown[] = [];
  const ctx = { reads: async (q: { params: Record<string, unknown> }) => { asked.push(q); if (q.params.bad) throw new Error('no such term'); return { items: [] }; } } as unknown as KernelContext;
  assert.deepEqual(await flat(ctx, { filter: { find: ['id e_x'] } }), { items: [] });
  assert.deepEqual(await flatCheck(ctx, { filter: { find: ['id e_x'] }, limit: 50 }), {});
  assert.deepEqual(asked, [{ view: 'flat', params: { filter: { find: ['id e_x'] } } }, { view: 'flat', params: { filter: { find: ['id e_x'] }, limit: 1 } }]);
  assert.deepEqual(await flatCheck(ctx, { bad: true }), { problem: 'no such term' });
  assert.match((await flatCheck(ctx, { limit: 9000 })).problem!, /from 1 to 2000/);
});
