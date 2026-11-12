// Sources run without a database: a query that answers from a few rows in memory, what rides out. The whole of it
// against a real map is test/follow-rides.test.ts and test/changes.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { follow, type Q } from './sources.ts';

const ctx = (types: string[]) => ({ registry: { type: (id: string) => (types.includes(id) ? { id } : undefined) } }) as unknown as KernelContext;
const q = (known: Record<string, string>): Q => ({ query: async <T>(_sql: string, params?: unknown[]) => ({ rows: (known[params?.[0] as string] ? [{ id: known[params?.[0] as string] }] : []) as T[] }) });

test('a source named for the first time is made, its ref the uri; one known is found', async () => {
  const ride = { q: q({ 'https://a': 'e_known' }), place: 'source' };
  assert.deepEqual(await follow(ctx(['source']), [], { ...ride, source: { uri: 'https://b', kind: 'web', excerpt: 'said' } }), {
    is: 'source https://b',
    ops: [{ op: 'create', ref: 'source https://b', type: 'source', title: 'https://b', body: 'said', status: 'recorded', props: { uri: 'https://b', kind: 'web' } }],
  });
  assert.deepEqual(await follow(ctx(['source']), [], { ...ride, source: { uri: 'https://a' } }), { is: 'e_known' });
});

test('after an op, or on a map with no sources, nothing rides', async () => {
  assert.deepEqual(await follow(ctx(['source']), [], { q: q({}), place: 'after' }), {});
  assert.deepEqual(await follow(ctx([]), [], { q: q({}), place: 'source', source: { uri: 'https://a' } }), {});
});
