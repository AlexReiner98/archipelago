// islands.make's first item (bug e_n2a6f2p5): a pack that makes an island in a change may make, in that same change,
// an item of the island's own pack on it, though that pack is outside its reach; anywhere else core's pack_reach still
// refuses a type the pack neither declares nor requires.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PackFile } from '../packs/loader/kernel/packs.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

const STORES = {
  id: 'stores', version: '1', title: 'Stores', description: 'What is on hand.', requires: ['core'],
  types: [{ id: 'stores.stock', title: 'Stock', description: 'How much is on hand.', extends: 'record' }],
} as unknown as PackFile;
const SHOP = {
  id: 'shop', version: '1', title: 'Shop', description: 'What is sold.', requires: ['core'],
  types: [{ id: 'shop.sale', title: 'Sale', description: 'A thing sold.', extends: 'record' }],
} as unknown as PackFile;

async function map() {
  const l = await freshWith(new Registry(packsWith(STORES, SHOP)), { create: 'auto', update: 'auto', link: 'auto' });
  await setIslands(l, human, true);
  return l;
}
const asIslands = (l: Awaited<ReturnType<typeof map>>, ops: unknown[]) => l.change(agent, { reason: 'test', pack: 'islands', ops } as never);

test("a pack making an island makes its first item of the island's own pack", async () => {
  const l = await map();
  const made = await asIslands(l, [
    { op: 'create', ref: 'island', type: 'island', title: 'Stores', props: { pack: 'stores' } },
    { op: 'create', ref: 'first', type: 'stores.stock', title: 'Oak dowels', props: { island: '{island}' } },
  ]);
  assert.equal((made as { status: string }).status, 'applied');
});

test("only the island's own pack, and only on the island it makes", async () => {
  const l = await map();
  await assert.rejects(asIslands(l, [
    { op: 'create', ref: 'island', type: 'island', title: 'Stores', props: { pack: 'stores' } },
    { op: 'create', ref: 'first', type: 'shop.sale', title: 'A chair', props: { island: '{island}' } },
  ]), /speaks stores/, 'another pack\'s type is no island\'s first item');
  const { s } = await make(l, [{ op: 'create', ref: 's', type: 'island', title: 'Stores', props: { pack: 'stores' } }]);
  await assert.rejects(asIslands(l, [{ op: 'create', ref: 'x', type: 'stores.stock', title: 'Pine dowels', props: { island: s } }]), /neither declares nor requires/);
});
