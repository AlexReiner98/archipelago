// A focus is its own island (feature e_u52abqr4, decision e_mqex8wrf): a change that makes an item of a type its pack
// marks as one that may be a focus (capability focus) says `focus: true`, and the item's island is its own id. It
// speaks its type's pack; what moves it forward lives on it; promoting an item later is not built yet.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import { Archipelago, type Op } from '../packs/write/kernel/pelago.ts';
import * as queryFlatPack from '../packs/query/kernel/query-flat.ts';
import { freshWith, human, make } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

/** A pack with a type that may be a focus and one that may not. */
const pack = (id: string) => ({
  id, version: '1', title: id, requires: ['core'],
  types: [
    { id: `${id}_feature`, title: 'Feature', extends: 'work', capabilities: { focus: true } },
    { id: `${id}_thing`, title: 'Thing', extends: 'work' },
  ],
});

async function focusMap() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-island-focus-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  for (const id of ['plain', 'other']) (mkdirSync(join(dir, id)), writeFileSync(join(dir, id, 'pack.json'), JSON.stringify(pack(id))));
  const l = await freshWith(new Registry(dir));
  await setIslands(l, human, true);
  return l;
}

const refused = (l: Archipelago, ops: Op[], said: RegExp) => assert.rejects(l.change(human, { reason: 'test', ops }), said);

test('a focus is its own island, speaking its type’s pack', async () => {
  const l = await focusMap();
  const { f } = await make(l, [{ op: 'create', ref: 'f', type: 'plain_feature', title: 'Billing', props: { focus: true } }]);
  assert.equal((await l.entity(f))!.props.island, f, 'naming no island, a focus names itself');
  const { t, s } = await make(l, [
    { op: 'create', ref: 't', type: 'plain_thing', title: 'Invoice run', props: { island: f } },
    { op: 'create', ref: 's', type: 'task', title: 'Shared task', props: { island: f } },
  ]);
  assert.ok(t && s, 'its pack’s types and the shared set live on it');
  await refused(l, [{ op: 'create', type: 'other_thing', title: 'Abroad', props: { island: f } }], /other_thing is other’s, and the island .* speaks plain/);
  await refused(l, [{ op: 'create', type: 'plain_thing', title: 'Not one', props: { focus: true } }], /no field "focus"/);
  await refused(l, [{ op: 'create', type: 'plain_feature', title: 'No ref', props: { focus: true } }], /a focus is its own island: give it a ref/);
  await refused(l, [{ op: 'update', id: t, props: { focus: true } }], /no field "focus"|promoting one later/);
  await refused(l, [{ op: 'update', id: f, props: { island: t } }], /a focus is its own island/);
});

test('a focus and what is on it come back as one island, named by the focus', async () => {
  const l = await focusMap();
  const { f } = await make(l, [{ op: 'create', ref: 'f', type: 'plain_feature', title: 'Billing', props: { focus: true } }]);
  await make(l, [{ op: 'create', type: 'plain_thing', title: 'Invoice run', props: { island: f } }]);
  const answer = await queryFlatPack.flatRead(kernelContext(l, 'query'), { filter: { find: [`island ${f}`] } } as never) as { items: { title: string }[]; islands: { id: string; title?: string; focus?: boolean; pack?: { id: string } }[] };
  assert.deepEqual(answer.items.map((i) => i.title).sort(), ['Billing', 'Invoice run']);
  const [island] = answer.islands;
  assert.equal(island.id, f);
  assert.equal(island.title, 'Billing');
  assert.equal(island.focus, true);
  assert.equal(island.pack?.id, 'plain');
});
