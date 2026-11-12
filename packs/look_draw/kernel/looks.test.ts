// Looks on a fake context: the roots' part (root.look) and the transient store (root.transient) in memory. Drawing
// needs Chrome and is tried in test/looks.test.ts; here, the count and a kept look read again.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { countLook, lookAt, looksBy, looksThisHour } from './looks.ts';

function fake(workspace: string, refused?: string) {
  const store = new Map<string, { value: unknown; data?: Buffer }>();
  const ctx = {
    workspace,
    call: async (name: string, ask: Record<string, any>) => {
      if (name === 'root.look') return { most: 2, ...(ask.room?.had >= 2 && refused && { refused }) };
      assert.equal(name, 'root.transient');
      if (ask.keep) return void store.set(ask.keep.key, { value: ask.keep.value, data: ask.keep.data });
      const kept = store.get(ask.kept);
      return ask.data ? kept : kept?.value;
    },
  } as unknown as KernelContext;
  return { ctx, store };
}

test('a workspace has its looks an hour, and the plan says no past them', async () => {
  const { ctx } = fake('plan1', 'Plan Co has room for 2 looks an hour, and has 2: read one again with query picture, or wait.');
  await countLook(ctx, 'e_sam00001');
  await countLook(ctx, 'e_sam00001');
  await assert.rejects(countLook(ctx), /Plan Co has room for 2 looks/);
  assert.equal(looksThisHour('plan1'), 2);
  assert.deepEqual([...looksBy('plan1')], [['e_sam00001', 2]]);
  const { ctx: plain } = fake('plain1');
  await countLook(plain);
  await countLook(plain);
  await assert.rejects(countLook(plain), /This workspace has had 2 looks in the last hour/, 'with no plan, its own words');
});

test('a look kept on this screen is read again, and none other', async () => {
  const { ctx, store } = fake('w1');
  const w = { workspace: 'w1', viewer: 'e_sam00001' };
  store.set('look:w1:e_sam00001:l_0123456789ab', { value: { scheme: 'dark', content_type: 'image/png', width: 10, height: 10, state: 'drawn', settled: true, hash: 'v?x', ms: 5, at: 'now', workspace: 'w1' }, data: Buffer.from('png') });
  const again = (await lookAt(ctx, w, 'l_0123456789ab')) as Record<string, any>;
  assert.equal(again.again, true);
  assert.equal(again.image.data, Buffer.from('png').toString('base64'));
  await assert.rejects(lookAt(ctx, { workspace: 'w1' }, 'l_0123456789ab'), /No look/, 'another screen');
  await assert.rejects(lookAt(ctx, w, 'nope'), /is not a look/);
});
