// A system's request for its token on the connect pack's context, without a database: a fake context keeps the
// transient store in memory and makes the token. Against a server, test/token-ask.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { askForToken, pollForToken, type Ask } from './token-ask.ts';

function fake() {
  const store = new Map<string, unknown>();
  const made: unknown[] = [];
  const ctx = {
    call: async (name: string, input: Record<string, any>) => {
      if (name === 'root.token') return (made.push(input), { token: 'pel_default_x', name: input.name });
      if (input.keep) return void store.set(input.keep.key, input.keep.value);
      if (input.kept) return store.get(input.kept);
      if (input.take) { const value = store.get(input.take); store.delete(input.take); return value && { value }; }
      if (input.scan) return [...store].filter(([k]) => input.scan.prefixes.some((p: string) => k.startsWith(p))).map(([key, value]) => ({ key, value }));
      throw new Error(`no ${name}`);
    },
  } as unknown as KernelContext;
  return { ctx, store, made };
}

test('a request names the system and the addresses it reports on, and nothing else', async () => {
  const { ctx } = fake();
  for (const bad of [{}, { name: '  ', address: 'https://a.example' }, { name: 'x' }, { name: 'x', address: 'ab' }, { name: 'x', addresses: [] }, { name: 'x', address: 'https://a.example', may: 'change' }, { name: 'x', address: 'https://a.example', extra: 1 }, { name: 'x'.repeat(61), address: 'https://a.example' }])
    await assert.rejects(askForToken(ctx, bad), /^Error: A request names the system \(name\)/, JSON.stringify(bad));
  await assert.rejects(askForToken(ctx, { name: 'x', extra: 1, address: 'https://a.example' }), /Unrecognized key: "extra"/);
  const asked = await askForToken(ctx, { name: ' deploy ', addresses: ['HTTPS://App.example/health/', 'https://app.example/health'] });
  assert.match(asked.code, /^[B-Z]{4}-[B-Z]{4}$/);
});

test('approved, the token is made by identity once, for the person and the items, and the poll is then told it is gone', async () => {
  const { ctx, store, made } = fake();
  const asked = await askForToken(ctx, { name: 'deploy', address: 'https://app.example/health' });
  const key = `connect:${asked.id}`;
  const ask = store.get(key) as Ask;
  assert.deepEqual([ask.name, ask.addresses, ask.state], ['deploy', ['https://app.example/health'], 'pending']);
  assert.deepEqual(await pollForToken(ctx, asked.id, asked.secret), { state: 'pending' });
  assert.deepEqual(await pollForToken(ctx, asked.id, '0'.repeat(48)), { state: 'gone' }, 'without the secret');
  store.set(key, { ...ask, state: 'approved', person: 'e_person00', items: ['e_item0000'] });
  assert.deepEqual(await pollForToken(ctx, asked.id, asked.secret), { state: 'approved', token: 'pel_default_x', name: 'deploy', may: 'report' });
  assert.deepEqual(made, [{ name: 'deploy', person: 'e_person00', within: ['e_item0000'] }]);
  assert.deepEqual(await pollForToken(ctx, asked.id, asked.secret), { state: 'gone' }, 'handed once');
});
