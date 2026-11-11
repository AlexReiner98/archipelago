// Types are never lost across versions and time (task e_aawum35n): what an archived version of a pack added stays in
// the type table, dormant, so its items stay typed; a registry at a past position reads the islands setting and the
// workspace's own types as they were then; and every manifest a pack fact names has its text on the log.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { freshWith, human, make, packsWith } from './map.ts';
import { newId } from '../src/db.ts';
import { append, headOf } from '../src/log.ts';
import { Registry } from '../src/packs.ts';
import { setIslands, syncPacks } from '../src/packstate.ts';
import { Archipelago, type Op } from '../src/pelago.ts';
import { asOf } from '../src/rebuild.ts';
import { registryAt } from '../src/registry-at.ts';
import { syncTypes } from '../src/typetable.ts';

const tick = () => new Promise((r) => setTimeout(r, 5)); // the logs' times are to the millisecond

const plain = {
  id: 'plain', version: '1.0.0', title: 'Plain', description: 'A pack to try versions with.', requires: ['core'],
  types: [{ id: 'plain.thing', title: 'Thing', description: 'A thing.', extends: 'work' }],
};

test('an archived version leaves what it added in the type table, dormant, and its items typed', async () => {
  const dir = packsWith(plain);
  const l = await freshWith(new Registry(dir));
  await setIslands(l, human, true);
  const { trial } = await make(l, [{ op: 'create', ref: 'trial', type: 'island', title: 'Trial', props: { pack: 'plain' } }]);
  const { v } = await make(l, [{ op: 'create', ref: 'v', type: 'pack', title: 'Plain, with parts', props: { version_of: 'plain', version: '1.1.0', manifest: {
    types: [...plain.types, { id: 'plain.part', title: 'Part', description: 'A part of a thing.', extends: 'work' }],
  } } } as Op]);
  await make(l, [{ op: 'update', id: trial, props: { pack_version: v } }]);
  await syncTypes(l);
  const { p } = await make(l, [{ op: 'create', ref: 'p', type: 'plain.part', title: 'Piston', props: { island: trial } }]);
  const row = async () => (await l.db.query<{ state: string; def: { retired?: boolean } }>(`select state, def from type_def where id = 'plain.part'`)).rows[0];
  assert.equal((await row())?.state, 'dormant', 'the type table keeps the added type, dormant, while the version is there');

  // The island rolled back and the version archived: the type stays, dormant and retired, and the item reads as before.
  await make(l, [{ op: 'update', id: trial, props: { pack_version: null } }]);
  await make(l, [{ op: 'archive', id: v }]);
  await syncTypes(l);
  assert.equal(l.registry.versions.size, 0);
  assert.ok(l.registry.type('plain.part')?.dormant && l.registry.type('plain.part')?.retired);
  const item = await l.entity(p);
  assert.equal(item?.type, 'plain.part');
  assert.equal(item?.status, 'todo');
  assert.equal((await row())?.state, 'dormant');
  assert.equal((await row())?.def.retired, true);

  // A server opening the map afresh reads it back from the table.
  const again = new Archipelago(l.db, new Registry(dir));
  await syncTypes(again);
  assert.ok(again.registry.type('plain.part')?.dormant && again.registry.type('plain.part')?.retired, 'kept across a restart');
  assert.equal(again.registry.starterOf('plain.part'), l.registry.starterOf('plain.part'));
});

test('a past registry reads islands and the workspace’s own types as they were then', async () => {
  const l = await freshWith(new Registry(packsWith()));
  await syncPacks(l);
  const before = (await headOf(l.db, 'facts')).pos;
  await tick();
  await make(l, [{ op: 'define_type', type: { id: 'local.chore', title: 'Chore', description: 'A small task that comes back.', extends: 'task' } } as Op]);
  const defined = (await headOf(l.db, 'facts')).pos;
  await tick();
  await setIslands(l, human, true);
  await tick();
  await make(l, [{ op: 'create', type: 'island', title: 'Plans', props: { pack: 'core' } }]);
  const after = (await headOf(l.db, 'facts')).pos;
  assert.ok(l.registry.onIslands);

  // A type defined now is a type item: the past registry takes it in with the items as they stood (asOf).
  const then = (await asOf(l.db, l.registry, l.workspace, before)).registry!.registry;
  assert.equal(then.onIslands, false, 'before islands were turned on, no islands');
  assert.equal(then.type('local.chore')?.dormant, true, 'not yet defined: today’s, dormant');
  const mid = (await asOf(l.db, l.registry, l.workspace, defined)).registry!.registry;
  assert.equal(mid.onIslands, false);
  assert.equal(mid.type('local.chore')?.dormant, undefined, 'defined by then');
  const now = (await asOf(l.db, l.registry, l.workspace, after)).registry!.registry;
  assert.equal(now.onIslands, true);
  assert.equal(now.type('local.chore')?.dormant, undefined);
  assert.equal((await registryAt(l.db, l.registry, before))!.registry.onIslands, false);
});

test('a type the workspace defined before types were items is read as of when it was defined', async () => {
  const chore = { id: 'local.chore', title: 'Chore', description: 'A small task that comes back.', extends: 'task' };
  const l = await freshWith(new Registry(packsWith(), undefined, [chore]));
  await syncPacks(l);
  const before = (await headOf(l.db, 'facts')).pos;
  // As the log said it then: a type_def fact (src/change-apply.ts).
  await l.db.transaction((tx) => append(tx, l.workspace, 'facts', { id: newId('c'), actor: { id: 'test' }, authority: null, rule: { outcome: 'apply', spared: [] }, reason: 'An old define_type', source: null, action: null, undoes: null, keys: [] }, [['+', chore.id, 'type_def', chore]]));
  const after = (await headOf(l.db, 'facts')).pos;
  assert.equal(l.registry.type('local.chore')?.pack, 'local');
  assert.equal((await registryAt(l.db, l.registry, before))!.registry.type('local.chore')?.dormant, true, 'not yet defined');
  const now = (await registryAt(l.db, l.registry, after))!.registry.type('local.chore');
  assert.equal(now?.dormant, undefined, 'defined by then');
  assert.equal(now?.pack, 'local');
});

test('a pack fact keeps the text that was hashed, though the file changed since it was read', async () => {
  const dir = packsWith();
  const l = await freshWith(new Registry(dir));
  const file = join(dir, 'core', 'pack.json');
  const core = JSON.parse(readFileSync(file, 'utf8'));
  core.description = `${core.description} Changed on disk.`;
  writeFileSync(file, JSON.stringify(core, null, 2)); // before the registry reads it again
  const said = await syncPacks(l);
  const fact = said.find((f) => f[1] === 'pack:core')![3] as { manifest: string; text?: string };
  assert.equal(fact.manifest, l.registry.hashes.get('core'));
  assert.ok(fact.text && !fact.text.includes('Changed on disk.'), 'the text the registry read, not the file as it is now');
  const at = (await registryAt(l.db, l.registry, (await headOf(l.db, 'facts')).pos))!;
  assert.deepEqual(at.packs.filter((p) => p.from !== 'log'), [], 'no stand-in');
});

test('a pack said before texts were kept is said again with its text, once', async () => {
  const l = await freshWith(new Registry(packsWith()));
  const core = l.registry.found.find((p) => p.id === 'core')!;
  // As a log from before texts were kept says it: the hash alone.
  await l.db.transaction((tx) => append(tx, l.workspace, 'facts', { id: newId('c'), actor: { id: 'system' }, authority: null, rule: { outcome: 'apply', spared: [] }, reason: 'An old pack fact', source: null, action: 'pack.sync', undoes: null, keys: [] }, [['+', 'pack:core', 'pack', { version: core.version, manifest: l.registry.hashes.get('core') }]]));
  const said = await syncPacks(l);
  const fact = said.find((f) => f[1] === 'pack:core')?.[3] as { manifest: string; text?: string } | undefined;
  assert.equal(fact?.manifest, l.registry.hashes.get('core'));
  assert.ok(fact?.text, 'said again, with its text');
  assert.equal((await syncPacks(l)).length, 0, 'and not again after');
  const at = (await registryAt(l.db, l.registry, (await headOf(l.db, 'facts')).pos))!;
  assert.equal(at.packs.find((p) => p.id === 'core')?.from, 'log');
});
