// The automation triggers run without a database: a definition checked, and a watched query's edge met pass by pass.
// The whole of it against a real map is test/due-on.test.ts and test/weekly-trigger.test.ts, through the shim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAutomation, checkOn, checkUpdated, checkWritten, edgeOf, meet, weekdays, type Memory } from './automation-rules.ts';

const types = { isA: (t: string, of: string) => t === of || (t === 'reminder' && of === 'automation') };
const on = { query: { filter: { find: ['type signup'] } }, edge: 'each' };

test('a definition is checked only where the type is an automation', () => {
  assert.deepEqual(weekdays(['mon', 5]), [1, 5]);
  assert.deepEqual(checkAutomation({ trigger: 'daily', at: '08:00', action: 'notify' }), []);
  assert.match(checkWritten(types, 'reminder', { action: 'notify' }).join(), /trigger daily or weekly/);
  assert.deepEqual(checkWritten(types, 'task', {}), []);
  assert.match(checkUpdated(types, 'automation', { on: { edge: 'each' } }).join(), /filter.find/);
  assert.deepEqual(checkUpdated(types, 'automation', { title: 'x' }), []);
  assert.deepEqual(checkOn(on), []);
});

test('an edge learns what matches first, then fires on what starts to match', () => {
  const said = JSON.stringify(on);
  const a = { id: 'a', props: { region: 'eu', value: 3 } }, b = { id: 'b', props: { region: 'us', value: 12 } };
  const one = meet(edgeOf(on as never), [a], undefined, said, 1);
  assert.deepEqual(one.met, [], 'the first pass only learns');
  const two = meet(edgeOf(on as never), [a, b], one.keep, said, 2);
  assert.deepEqual(two.met, [{ edge: 'each', matched: ['b'] }]);

  const per = edgeOf({ ...on, edge: 'first_per:region' } as never);
  const was: Memory = meet(per, [a], undefined, said, 1).keep;
  assert.deepEqual(meet(per, [a, b], was, said, 2).met, [{ edge: 'first_per:region', matched: ['b'], value: 'us' }]);

  const crosses = edgeOf({ ...on, edge: 'crosses:10', field: 'value' } as never);
  const under = meet(crosses, [a], undefined, said, 1).keep;
  assert.deepEqual(meet(crosses, [a, b], under, said, 2).met, [{ edge: 'crosses:10', matched: ['b'], value: 12 }]);

  const first = edgeOf({ ...on, edge: 'first' } as never);
  const none = meet(first, [], undefined, said, 1).keep;
  assert.deepEqual(meet(first, [a], none, said, 2).met, [{ edge: 'first', matched: ['a'] }]);
});
