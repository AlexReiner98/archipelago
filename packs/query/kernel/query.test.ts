// The query pack run without a database: its modules read no map, so input in, answer out. Against a real map:
// test/altitude.test.ts and test/layouts-sent.test.ts, through the shims in src/.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { altitudeOf } from './altitude.ts';
import { readSteps, stepIds, stepsShown, stepsWrong } from './query-steps.ts';
import { countBy, summed } from './summary.ts';

test('an altitude is one of the four levels, and any other stops the server', () => {
  assert.equal(altitudeOf('task', 'step'), 'step');
  assert.throws(() => altitudeOf('task', 'leaf'), /must be one of workspace, project, stream, step/);
});

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
