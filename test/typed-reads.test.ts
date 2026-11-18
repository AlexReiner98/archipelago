// A typed item read across islands (task e_gq5dcsh5, typed islands e_f56ds3ww, the owner, 17 Nov 2026): reads points to
// any type that promises fields to its readers (has:promised), not only a finding, so a typed fact crosses as an item of
// its own type, checked by the write path as every item is. A reading may name the type it relies on (props.expects),
// and a target not of it is refused.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PackFile } from '../packs/loader/kernel/packs.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import { freshWith, human, make, packsWith } from './map.ts';

/** An island pack with one type that promises its fields: how much of a part is on hand. */
const STORES = {
  id: 'stores', version: '1', title: 'Stores', description: 'What is on hand.', requires: ['core'],
  types: [{
    id: 'stock', title: 'Stock', description: 'How much of a part is on hand.', extends: 'record',
    capabilities: { promised: { fields: ['sku', 'qty'], published: 'published' } },
    fields: { sku: { type: 'string' }, qty: { type: 'number' }, published: { type: 'boolean' } },
  }],
} as unknown as PackFile;

async function twoIslands() {
  const l = await freshWith(new Registry(packsWith(STORES)));
  await setIslands(l, human, true);
  const { a, b, c } = await make(l, [
    { op: 'create', ref: 'a', type: 'island', title: 'Stores', props: { pack: 'stores' } },
    { op: 'create', ref: 'c', type: 'island', title: 'Sales', props: { pack: 'findings' } }, // finding is the tests' words now
    { op: 'create', ref: 'b', type: 'island', title: 'Orders', props: { pack: 'core' } },
  ]);
  const { s, f, away } = await make(l, [
    { op: 'create', ref: 's', type: 'stock', title: 'Oak dowel stock', props: { sku: 'OAK-12', qty: 40, island: a } },
    { op: 'create', ref: 'f', type: 'finding', title: 'Dowels sell 10 a week', props: { value: 10, value_type: 'number', published: true, island: c } },
    { op: 'create', ref: 'away', type: 'task', title: 'Plan the next order', props: { island: b } },
  ]);
  return { l, s: s!, f: f!, away: away! };
}

test('an item of any promised type is read from another island once published', async () => {
  const { l, s, away } = await twoIslands();
  await assert.rejects(make(l, [{ op: 'link', type: 'reads', from: away, to: s }]), /reads only what it marks published/);
  await make(l, [{ op: 'update', id: s, props: { published: true } }, { op: 'link', type: 'reads', from: away, to: s }]);
});

test('reads still points only to what promises fields', async () => {
  const { l, away } = await twoIslands();
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Count the dowels', props: { island: (await l.entity(away))!.props.island } }]);
  await assert.rejects(make(l, [{ op: 'link', type: 'reads', from: away, to: t! }]), /"reads" must point to has:promised, not task/);
});

test('a reading names the type it expects, and a target not of it is refused', async () => {
  const { l, s, f, away } = await twoIslands();
  await make(l, [{ op: 'update', id: s, props: { published: true } }]);
  await make(l, [{ op: 'link', type: 'reads', from: away, to: s, props: { expects: 'stock' } }]);
  await assert.rejects(make(l, [{ op: 'link', type: 'reads', from: away, to: f, props: { expects: 'stock' } }]), /"reads" expects a stock, and what it reads is a finding/);
  await assert.rejects(make(l, [{ op: 'link', type: 'reads', from: away, to: f, props: { expects: 'no.such' } }]), /props\.expects names a type the packs define/);
  await make(l, [{ op: 'link', type: 'reads', from: away, to: f, props: { expects: 'record' } }]); // a flavour of what it expects holds
});

test('only a link that crosses islands says what it expects', async () => {
  const { l, away } = await twoIslands();
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Count the dowels', props: { island: (await l.entity(away))!.props.island } }]);
  await assert.rejects(make(l, [{ op: 'link', type: 'depends_on', from: away, to: t!, props: { expects: 'task' } }]), /props\.expects is said only on a link that crosses islands/);
});
