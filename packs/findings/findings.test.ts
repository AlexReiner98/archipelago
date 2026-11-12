// The findings pack's code, tested without a database: its action's handler (a finding in, the op that marks it
// published out) and the rows of its part (a finding in, the words it reads as out). The part's marks are checked in test/findings-part.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { standBy } from './handler.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { age, valueOf } from './parts/findings/rows.js';

const finding = { id: 'e_aaaaaaaa', type: 'finding', is: ['record'], title: 'Peak load is 42 kW', props: { island: 'e_island01' } };

test('standing by a finding marks it published', () => {
  assert.deepEqual(standBy(finding).ops, [{ op: 'update', id: 'e_aaaaaaaa', props: { published: true } }]);
  assert.deepEqual(standBy({ ...finding, props: { ...finding.props, published: true } }).ops, [], 'already published: nothing to change');
  assert.throws(() => standBy({ ...finding, type: 'task', is: ['work'] }), /not a finding/);
  assert.throws(() => standBy(null), /not a finding/);
});

test('a finding reads as its value with its unit and its age', () => {
  assert.equal(valueOf({ value: 42, unit: 'kW' }), '42 kW');
  assert.equal(valueOf({}), '—');
  const day = Date.parse('2026-11-12T12:00:00');
  assert.equal(age('2026-11-12', day), 'today');
  assert.equal(age('2026-11-11', day), 'yesterday');
  assert.equal(age('2026-11-07', day), '5 d');
  assert.equal(age(undefined, day), '—');
});
