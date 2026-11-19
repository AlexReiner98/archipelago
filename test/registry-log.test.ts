// The registry as a projection of the log (packs/loader/kernel/registry-log.ts, pack-source.ts): built from the seed and the
// system items, cached by the fact position it was built at, built again only when a fact after it touches a system
// item, and the pack files read only to seed it.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fresh, freshWith, make, PACKS, packsWith, WORDS } from './map.ts';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { builtAt, factsHead, followRegistry } from '../packs/loader/kernel/registry-log.ts';
import { setPackModel, systemKinds } from '../packs/loader/kernel/pack-source.ts';

/** Count the registry's builds from items. */
const counted = (l: Archipelago) => {
  const take = l.registry.takeItems.bind(l.registry), n = { builds: 0 };
  l.registry.takeItems = (items) => (n.builds++, take(items));
  return n;
};

test('a follow builds again only when a fact since touches a system item', async () => {
  const l = await fresh();
  await followRegistry(l);
  assert.equal(builtAt(l), await factsHead(l), 'built at the head');
  const n = counted(l), types = l.registry.types;

  await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Paint the fence', status: 'todo' }]);
  assert.equal(await followRegistry(l), false, 'a task is no system item');
  assert.equal(builtAt(l), await factsHead(l), 'the position moves on all the same');
  assert.equal(await followRegistry(l), false, 'nothing since: nothing read');
  assert.equal(n.builds, 0);
  assert.equal(l.registry.types, types, 'the same registry, not built again');

  // Another server on the same map makes a type: this one sees it on its next follow.
  const other = new Archipelago(l.db, new Registry([PACKS, WORDS]));
  await make(other, [{ op: 'create', type: 'type', title: 'Site visit', props: { name: 'local.site_visit', extends: 'event' } }]);
  assert.equal(l.registry.type('local.site_visit'), undefined);
  assert.equal(await followRegistry(l), true, 'a type item made: built again');
  assert.deepEqual(l.registry.type('local.site_visit')!.lineage, ['local.site_visit', 'event', 'occurrence']);
  assert.equal(n.builds, 1);
});

test('a link to a system item is a touch; a change made here is already built', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'ty', type: 'type', title: 'Recipe', props: { name: 'local.recipe', extends: 'record' } }, { op: 'create', ref: 'n', type: 'task', title: 'Write it up', status: 'todo' }]);
  assert.ok(l.registry.type('local.recipe'), 'the change that made it built it');
  assert.equal(await followRegistry(l), false, 'already built at that position');
  await make(l, [{ op: 'link', type: 'about', from: made.n, to: made.ty }]);
  const n = counted(l);
  assert.equal(await followRegistry(l), false, 'touched, read again, and the items are as they were: not built again');
  assert.equal(n.builds, 0);
  assert.equal(builtAt(l), await factsHead(l));
});

test('a rebuild reads no pack file; a reload seeds again, and a trial keeps its registry\'s seed', async () => {
  const dir = packsWith();
  const l = await freshWith(new Registry(dir));
  const file = join(dir, 'core', 'pack.json'), was = l.registry.hashes.get('core');
  const core = JSON.parse(readFileSync(file, 'utf8'));
  core.types.find((t: { id: string }) => t.id === 'task').fields.effort = { type: 'number', description: 'Hours it takes.' };
  writeFileSync(file, JSON.stringify(core, null, 2));

  l.registry.rebuild();
  assert.equal(l.registry.hashes.get('core'), was, 'built from the seed it read');
  assert.equal(l.registry.type('task')!.fields.effort, undefined);
  assert.equal(l.registry.trial(l.registry.items).hashes.get('core'), was, 'a trial is built from the same seed');

  l.registry.reload();
  assert.notEqual(l.registry.hashes.get('core'), was, 'read again when asked');
  assert.ok(l.registry.type('task')!.fields.effort);
});

test('the pack model\'s manifests stand in for their files', async (t) => {
  t.after(() => setPackModel(undefined));
  const core = JSON.parse(readFileSync(join(PACKS, 'core', 'pack.json'), 'utf8'));
  core.types.find((x: { id: string }) => x.id === 'task').fields.effort = { type: 'number', description: 'Hours it takes.' };
  setPackModel({ kinds: [...systemKinds(), 'pack_part'], manifests: () => new Map([['core', { manifest: core, hash: 'from-the-map' }]]) });
  assert.ok(systemKinds().includes('pack_part'), 'the model names the kinds a follow watches');
  const reg = new Registry([PACKS, WORDS]);
  assert.equal(reg.hashes.get('core'), 'from-the-map');
  assert.ok(reg.type('task')!.fields.effort, 'the map\'s manifest, not the file');
});
