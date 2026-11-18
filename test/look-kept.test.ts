// A look kept past LOOK_MS (packs/look_draw/kernel/kept.ts): on a fake context whose transient store keeps by a fake
// clock, a look taken on a screen lapses at LOOK_MS while the same look kept is read again by anyone on the map, its
// picture at the address it was given; past KEPT_MOST the oldest is taken away.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { KEPT_MOST, KEPT_MS, keepLook, keptPicture, keptUrl } from '../packs/look_draw/kernel/kept.ts';
import { LOOK_MS, lookAt } from '../packs/look_draw/kernel/looks.ts';

function fake(workspace: string) {
  const clock = { now: 0 };
  const store = new Map<string, { value: unknown; data?: Buffer; until: number }>();
  const live = (key: string) => {
    const got = store.get(key);
    return got && got.until >= clock.now ? got : undefined;
  };
  const ctx = {
    workspace,
    call: async (name: string, ask: Record<string, any>) => {
      assert.equal(name, 'root.transient');
      if (ask.keep) return void store.set(ask.keep.key, { value: ask.keep.value, data: ask.keep.data, until: clock.now + ask.keep.ms });
      if (ask.take) {
        const got = live(ask.take);
        store.delete(ask.take);
        return got && { value: got.value, data: got.data };
      }
      const got = live(ask.kept);
      return ask.data ? got && { value: got.value, data: got.data } : got?.value;
    },
  } as unknown as KernelContext;
  return { ctx, store, clock };
}

const drawn = { scheme: 'dark', content_type: 'image/png', width: 560, height: 400, state: 'drawn', settled: true, hash: 'v?x', ms: 5, at: 'then', workspace: 'w1', checks: [{ rule: 'small_text', mark: 'span', said: 'span is drawn at 8 px, under 10' }] };

test('a kept look is read again past LOOK_MS, by anyone on the map; the screen’s own lapses', async () => {
  const { ctx, store, clock } = fake('w1');
  const sam = { workspace: 'w1', viewer: 'e_sam00001' };
  const png = Buffer.from('png bytes');
  // What takeLook keeps for the screen, and what it keeps when asked to keep.
  store.set('look:w1:e_sam00001:l_0123456789ab', { value: drawn, data: png, until: clock.now + LOOK_MS });
  const kept = await keepLook(ctx, { ...drawn, look: 'l_0123456789ab' }, png);
  assert.match(kept.id, /^k_[0-9a-f]{24}$/);
  assert.equal(kept.url, `/look/w1/${kept.id}`);
  assert.equal(kept.url, keptUrl('w1', kept.id));

  clock.now += LOOK_MS + 1;
  await assert.rejects(lookAt(ctx, sam, 'l_0123456789ab'), /No look/, 'the screen’s look has lapsed');
  for (const who of [sam, { workspace: 'w1', viewer: 'e_kim00001' }, { workspace: 'w1' }]) {
    const again = (await lookAt(ctx, who, kept.id)) as Record<string, any>;
    assert.equal(again.look, 'l_0123456789ab');
    assert.deepEqual(again.kept, kept);
    assert.equal(again.image.data, png.toString('base64'));
    assert.deepEqual(again.checks, drawn.checks, 'its checks are kept with it');
  }
  assert.deepEqual(await keptPicture(ctx, kept.id), { data: png, content_type: 'image/png' });
  assert.equal(await keptPicture(ctx, 'k_nope'), undefined, 'an id that is none is nothing');
  assert.equal(await keptPicture(ctx, `k_${'0'.repeat(24)}`), undefined, 'nor one never kept');

  clock.now += KEPT_MS;
  await assert.rejects(lookAt(ctx, sam, kept.id), /is kept here/, 'past KEPT_MS it is gone too');
});

test('a workspace keeps its last KEPT_MOST looks: a keep past them takes the oldest away', async () => {
  const { ctx, store } = fake('w2');
  const png = Buffer.from('p');
  const ids: string[] = [];
  for (let n = 0; n <= KEPT_MOST; n++) ids.push((await keepLook(ctx, { ...drawn, look: 'l_0123456789ab' }, png)).id);
  assert.equal(await keptPicture(ctx, ids[0]), undefined, 'the first is gone');
  assert.ok(await keptPicture(ctx, ids[1]), 'the second stays');
  assert.ok(await keptPicture(ctx, ids.at(-1)!));
  assert.equal([...store.keys()].filter((k) => k.startsWith('keptlook:k_')).length, KEPT_MOST);
  assert.equal((store.get('keptlook:index')!.value as string[]).length, KEPT_MOST);
});
