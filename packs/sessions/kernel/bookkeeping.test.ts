// The sessions pack's bookkeeping, without a database: each write is handed to the write path's root.bookkeep as it is,
// as its actor.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOOKKEEPING, bookkeep, operational, releaseAs } from './bookkeeping.ts';

const asking = () => {
  const seen: [string, unknown][] = [];
  const ctx = { call: async (name: string, input: unknown) => (seen.push([name, input]), name === 'root.bookkeep' ? { created: { run: 'e_1' }, released: 1 } : undefined) } as never;
  return { ctx, seen };
};

test('bookkeeping applies the change as it is made, as the actor it is for', async () => {
  const { ctx, seen } = asking();
  const input = { ops: [{ op: 'update', id: 'e_1', status: 'running' }], reason: 'Session taken up again' };
  assert.deepEqual(await bookkeep(ctx, 'agent:a', input), { created: { run: 'e_1' }, released: 1 });
  assert.deepEqual(seen, [['root.bookkeep', { apply: { actor: 'agent:a', input } }]]);
});

test('the operational write and a release go to the write path by name', async () => {
  const { ctx, seen } = asking();
  await operational(ctx, 'e_1', { props: { last_seen: 'now' } });
  await releaseAs(ctx, { kind: 'agent', name: 'a' }, { resource: 'e_2', holder: 'e_1', reason: 'done' });
  assert.deepEqual(seen.map(([, input]) => Object.keys(input as object)[0]), ['operational', 'give_back']);
});

test('the rule it stands for is the sessions pack\'s', () => {
  assert.equal(`${BOOKKEEPING.pack}.${BOOKKEEPING.rule}`, 'sessions.bookkeeping');
});
