// A reading on a fake context: the watched types from a registry stub, the items from the reads API in memory. What
// it changes comes back as ops for the surface to apply (packs/surface/kernel/report-tool.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { health, readingPlan, sameAddress } from './report.ts';

const watch = { field: 'url', up: 'live', down: 'down', also: ['degraded'], idle: 'standby', commit: 'commit' };
const items = [
  { id: 'e_api00001', type: 'component', title: 'API', status: 'live', is_open: true, props: { url: 'https://API.example.com/' } },
  { id: 'e_web00001', type: 'component', title: 'Web', status: 'down', is_open: true, props: { url: 'https://web.example.com' } },
  { id: 'e_old00001', type: 'component', title: 'Old', status: 'live', is_open: false, props: { url: 'https://old.example.com' } },
];
const ctx = {
  registry: { having: () => ['component'], type: () => ({ capabilities: { watch } }) },
  reads: async (read: { items?: { type: string }; page?: { after?: string } }) => ({ rows: read.page?.after ? [] : items, ...(!read.page?.after && { next: 'n1' }) }),
} as unknown as KernelContext;

test('a monitor that fails moves the part it watches down, as ops to apply', async () => {
  assert.equal(sameAddress('HTTPS://Api.Example.com/x/'), 'https://api.example.com/x');
  const plan = await readingPlan(ctx, { up: false, addresses: ['https://api.example.com'], said: 'timeout' }, 'kuma');
  assert.deepEqual(plan.ops, [{ op: 'update', id: 'e_api00001', status: 'down' }]);
  assert.equal(plan.reason, 'kuma: API does not answer (timeout)');
  assert.deepEqual(plan.changed, [{ id: 'e_api00001', title: 'API', from: 'live', to: 'down' }]);
  const none = await readingPlan(ctx, { up: false, addresses: ['https://old.example.com'], said: '' }, 'kuma');
  assert.deepEqual([none.ops, none.matched], [[], []], 'a closed part is not watched');
});

test('a deploy says what is live at which commit; a test from Kuma is only heard', async () => {
  const answer = (await health(ctx, { given: { live: { at: 'https://web.example.com', commit: 'abcdef1' } }, by: 'deploy' })) as { ops: unknown[]; reason: string };
  assert.deepEqual(answer.ops, [{ op: 'update', id: 'e_web00001', status: 'live', props: { commit: 'abcdef1' } }]);
  assert.equal(answer.reason, 'deploy: https://web.example.com is live at abcdef1');
  assert.deepEqual(await health(ctx, { given: {}, by: 'kuma' }), { heard: true, note: 'Nothing measured: nothing to report.' });
});
