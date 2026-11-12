// The sessions pack's bookkeeping, without a database: each write is handed to the map's apply as it is, as its actor.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOOKKEEPING, bookkeep } from './bookkeeping.ts';

test('bookkeeping applies the change as it is made, as the actor it is for', async () => {
  const seen: [string, unknown][] = [];
  const map = { apply: async (actor: string, input: { ops: unknown[]; reason: string }) => (seen.push([actor, input]), { created: { run: 'e_1' } }) };
  const input = { ops: [{ op: 'update', id: 'e_1', status: 'running' }], reason: 'Session taken up again' };
  assert.deepEqual(await bookkeep(map, 'agent:a', input), { created: { run: 'e_1' } });
  assert.deepEqual(seen, [['agent:a', input]]);
});

test('the rule it stands for is the sessions pack\'s', () => {
  assert.equal(`${BOOKKEEPING.pack}.${BOOKKEEPING.rule}`, 'sessions.bookkeeping');
});
