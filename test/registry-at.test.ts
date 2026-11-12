// The registry as of a past position (docs/log.md section 8, packs/loader/kernel/registry-at.ts): a pack's manifest changes, the log
// keeps both texts by hash, and a read of the map before the change runs under the pack as it was, after it under the
// pack as it is.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { freshWith, make, PACKS, packsWith } from './map.ts';
import { newId } from '../packs/database/kernel/db.ts';
import { append, headOf } from '../packs/log/kernel/log.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { syncPacks } from '../packs/loader/kernel/packstate.ts';
import { asOf } from '../packs/log/kernel/rebuild.ts';
import { registryAt } from '../packs/loader/kernel/registry-at.ts';

test('a read before a pack changed reads its types as they were, and after it as they are', async () => {
  const dir = packsWith();
  const l = await freshWith(new Registry(dir));
  await syncPacks(l);
  const made = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Waiting on a reply', status: 'waiting' }]);
  const before = (await headOf(l.db, 'facts')).pos;

  // The core pack changes: a task gains a field, and waiting is no longer open.
  const file = join(dir, 'core', 'pack.json');
  const core = JSON.parse(readFileSync(file, 'utf8'));
  const task = core.types.find((t: { id: string }) => t.id === 'task');
  task.fields.effort = { type: 'number', description: 'Hours it takes.' };
  task.statuses = { open: ['todo', 'doing'], closed: ['waiting', 'done', 'dropped'] };
  writeFileSync(file, JSON.stringify(core, null, 2));
  l.registry.reload();
  const said = await syncPacks(l);
  assert.ok(said.some((f) => f[1] === 'pack:core' && (f[3] as { text?: string }).text), 'the new manifest text is kept on the log');
  const after = (await headOf(l.db, 'facts')).pos;

  // The registry at each position, from the manifests the log named then.
  const then = (await registryAt(l.db, l.registry, before))!;
  const now = (await registryAt(l.db, l.registry, after))!;
  assert.equal(then.packs.find((p) => p.id === 'core')?.from, 'log');
  assert.notEqual(then.packs.find((p) => p.id === 'core')?.manifest, now.packs.find((p) => p.id === 'core')?.manifest);
  assert.equal(then.registry.type('task')?.fields.effort, undefined, 'before: no effort field');
  assert.equal(now.registry.type('task')?.fields.effort?.type, 'number', 'after: the field is there');
  assert.ok(then.registry.isOpen('task', 'waiting'));
  assert.ok(!now.registry.isOpen('task', 'waiting'));
  assert.deepEqual(then.registry.check('task', undefined, { effort: 2 }).length, 1, 'before, the field is refused');
  assert.deepEqual(now.registry.check('task', undefined, { effort: 2 }), []);

  // asOf projects under the registry of its position: the same item reads open before, closed after.
  const past = await asOf(l.db, l.registry, l.workspace, before);
  const present = await asOf(l.db, l.registry, l.workspace, after);
  assert.equal(past.registry?.registry.type('task')?.fields.effort, undefined);
  assert.equal(present.registry?.registry.type('task')?.fields.effort?.type, 'number');
  assert.equal(past.rows.entity.find((e) => e.id === made.t)?.is_open, true);
  assert.equal(present.rows.entity.find((e) => e.id === made.t)?.is_open, false);

  // Before any pack fact there is no past registry: today's stands.
  assert.equal(await registryAt(l.db, l.registry, 0), undefined);
});

test('a type the packs then did not define is read as dormant, from today', async () => {
  const dir = packsWith();
  const l = await freshWith(new Registry(dir));
  await syncPacks(l);
  const before = (await headOf(l.db, 'facts')).pos;
  const file = join(dir, 'core', 'pack.json');
  const core = JSON.parse(readFileSync(file, 'utf8'));
  core.types.push({ id: 'chore', extends: 'task', title: 'Chore', description: 'A small task that comes back.' });
  writeFileSync(file, JSON.stringify(core, null, 2));
  l.registry.reload();
  await syncPacks(l);
  const then = (await registryAt(l.db, l.registry, before))!;
  assert.equal(then.registry.type('chore')?.dormant, true);
  assert.equal(l.registry.type('chore')?.dormant, undefined);
});

test('manifests that do not load under this code leave a past read under today’s registry, saying why', async () => {
  const l = await freshWith(new Registry(packsWith()));
  await syncPacks(l);
  const core = JSON.parse(readFileSync(join(PACKS, 'core', 'pack.json'), 'utf8'));
  core.types.find((t: { id: string }) => t.id === 'task').extends = 'no_such_type';
  const text = JSON.stringify(core);
  const manifest = createHash('sha256').update(text).digest('hex');
  await l.db.transaction((tx) => append(tx, l.workspace, 'facts', { id: newId('c'), actor: { id: 'system' }, authority: null, rule: { outcome: 'apply', spared: [] }, reason: 'A manifest this code refuses', source: null, action: 'pack.sync', undoes: null, keys: [] }, [['+', 'pack:core', 'pack', { version: core.version, manifest, text }]]));
  const head = (await headOf(l.db, 'facts')).pos;
  await assert.rejects(registryAt(l.db, l.registry, head), /no_such_type/);
  const read = await asOf(l.db, l.registry, l.workspace, head);
  assert.match(read.past_refused ?? '', /no_such_type/);
  assert.equal(read.registry, undefined);
});
