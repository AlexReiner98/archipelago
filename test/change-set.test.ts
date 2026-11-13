// The tail says who made each entry, on whose word and why, opened: what the trace overlay tells a change by (the
// catch_up pack's parts; what a change set says of the rows is test/catch-up-parts.test.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { factsAfter, headPos } from '../packs/log/kernel/tail.ts';
import { fresh, human, make } from './map.ts';

test('the tail says who made each entry, on whose word, and why, opened', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Traced' }]);
  const start = await headPos(l.db);
  await l.change(human, { reason: 'Started on it', authority: { of: 'human' }, ops: [{ op: 'update', id: made.t, status: 'doing' }] } as any);
  const read = await factsAfter(l.db, { after: start, ids: [made.t] });
  assert.equal(read.entries.length, 1);
  const by = read.entries[0].by!;
  assert.equal(by.reason, 'Started on it', 'the reason, opened');
  assert.equal(by.of, 'human');
  assert.equal(by.actor, 'human:test', 'the actor, as the log holds it');
});
