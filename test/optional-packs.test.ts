// An internal pack is required or optional (decision e_cenjpmrf, the owner, 12 Nov 2026; docs/kernel-packs.md, "The
// manifest key kernel"): a required one is always on, an optional one a map may switch off as it switches a plain pack.
// Sessions is optional. The automations pack runs in the sandbox, so it stays plain; its triggers (automation_triggers)
// are required, and do nothing on a map where automations is off. What a watched query's edge met stays under the
// prefix the clock kept it under, `due_on:` (decision e_a8dh8fg3): nothing is migrated and nothing fires again.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as duePack from '../packs/clocks/kernel/due.ts';
import { isOptional, isRequired, memoryPrefix, readManifest } from '../packs/loader/kernel/manifest.ts';
import { INTERNAL_PACKS, packVersions } from '../packs/loader/kernel/pack-versions.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setPack } from '../packs/loader/kernel/packstate.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import { freshWith, human, make, PACKS, packsWith } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

const manifest = (kernel: unknown) => () => readManifest(JSON.stringify({ id: 'k', version: '1', title: 'K', kernel }), 'k');
const service = { trust: 'service', internal: true };

test('kernel.optional: a service pack may say it, a root pack never; an optional pack fills only the write path', () => {
  assert.ok(isOptional(manifest({ ...service, optional: true, hooks: { 'write.validate': 'a.ts#v' } })()));
  assert.ok(isRequired(manifest(service)()), 'absent, it is required');
  assert.throws(manifest({ trust: 'root', internal: true, optional: true }), /a root pack is never optional/);
  assert.throws(manifest({ ...service, optional: 'yes' }), /kernel.optional is true/);
  assert.throws(manifest({ ...service, optional: true, provides: { 'answer.x': { run: 'a.ts#x' } } }), /an optional pack fills only the write path's points.*kernel.provides/);
  assert.throws(manifest({ ...service, optional: true, hooks: { 'open.ready': 'a.ts#o' } }), /not open.ready/);
  assert.throws(manifest({ ...service, optional: true, timers: [{ run: 'a.ts#t', every_ms: 60000 }] }), /kernel.timers/);
});

test('kernel.memory: a legacy settings prefix a service pack declares, else its own', () => {
  assert.equal(memoryPrefix(manifest({ ...service, memory: 'due_on:' })()), 'due_on:');
  assert.equal(memoryPrefix(manifest(service)()), 'pack:k:');
  assert.throws(manifest({ ...service, memory: 'pack:other:' }), /kernel.memory is a settings prefix/);
  assert.throws(manifest({ ...service, memory: 'due_on' }), /ending in a colon/);
  assert.throws(manifest({ trust: 'root', internal: true, memory: 'x:' }), /a service pack's/);
});

test('sessions is internal and optional: on by default, off where the map turns it off, recorded as its own entry', () => {
  const reg = new Registry(PACKS);
  const sessions = reg.found.find((p) => p.id === 'sessions')!;
  assert.ok(reg.internal.has('sessions') && isOptional(sessions));
  assert.equal(reg.states.get('sessions')?.state, 'active');
  const on = packVersions(reg);
  assert.deepEqual(on.find((v) => v.id === 'sessions'), { id: 'sessions', version: sessions.version, manifest: reg.hashes.get('sessions') });
  const together = on.find((v) => v.id === INTERNAL_PACKS)!;

  reg.turnOff(['sessions', 'mentions']);
  assert.equal(reg.states.get('sessions')?.state, 'off');
  assert.match(reg.states.get('sessions')!.why!, /turned off here/);
  assert.equal(reg.states.get('mentions')?.state, 'active', 'a required one stays on');
  const off = packVersions(reg);
  assert.equal(off.find((v) => v.id === 'sessions'), undefined, 'off: no entry');
  assert.deepEqual(off.find((v) => v.id === INTERNAL_PACKS), together, 'the required ones are one entry, the same either way');
});

test("an optional pack is found where its folder is read, as a plain pack is: never added from the server's own", () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-core-only-'));
  cpSync(join(PACKS, 'core'), join(dir, 'core'), { recursive: true });
  const reg = new Registry(dir);
  assert.ok(reg.found.some((p) => p.id === 'mentions'), 'a required one is');
  assert.ok(!reg.found.some((p) => p.id === 'sessions'));
});

test('the Packs screen: a required internal pack is never taken out; an optional one is', async () => {
  const l = await freshWith(new Registry(packsWith()));
  await assert.rejects(setPack(l, human, { pack: 'mentions', on: false }), /server's own and required/);
  const { packs } = await setPack(l, human, { pack: 'sessions', on: false });
  assert.equal(packs.find((p) => p.id === 'sessions')?.state, 'off');
  assert.equal(packs.find((p) => p.id === 'mentions')?.required, true);
  assert.equal(packs.find((p) => p.id === 'sessions')?.required, undefined);
});

// Query triggers, as test/due-on.test.ts makes them.
const SIGNUPS = {
  id: 'signups', version: '0.1.0', title: 'Sign-ups', description: 'Made-up sign-ups for testing query triggers.', requires: ['core'],
  types: [{ id: 'signup', title: 'Sign-up', description: 'Someone who signed up.', extends: 'record', fields: { region: { type: 'string' } } }],
};
const map = () => freshWith(new Registry(packsWith(SIGNUPS as never)));
const NOW = Date.parse('2030-01-07T13:00:00Z');
const signups = { query: { filter: { find: ['type signup'] } } };
const pass = async (l: Archipelago, i: number) => (await duePack.duePass(kernelContext(l, 'clocks'), (NOW + i * 60_000))).filter((d) => d.edge);
const ABOUT = [{ op: 'create', ref: 'subject', type: 'task', title: 'Regulated regions' }, { op: 'link', type: 'about', from: 'auto', to: 'subject' }] as never[];
const automation = (on: unknown) => ({ op: 'create', ref: 'auto', type: 'automation', title: 'Watch', status: 'enabled', props: { on, action: 'notify', message: 'Started to match' } });
const settings = async (l: Archipelago, like: string) => (await l.db.query<{ key: string; value: unknown }>(`select key, value from setting where key like $1 order by key`, [like])).rows;

test('automation_triggers does nothing where the automations pack is off: no pass, no memory, no check', async () => {
  const l = await map();
  const ids = await make(l, [automation({ ...signups, edge: 'each' }) as never, ...ABOUT]);
  await setPack(l, human, { pack: 'automations', on: false });
  assert.equal(l.registry.states.get('automation_triggers')?.state, 'active', 'required: on');
  await make(l, [{ op: 'create', type: 'signup', title: 'Ada' }]);
  assert.deepEqual(await pass(l, 0), []);
  assert.deepEqual(await settings(l, 'due_on:%'), [], 'nothing remembered');
  assert.deepEqual(await settings(l, 'pack:automation_triggers:%'), []);
  await make(l, [{ ...automation({ ...signups, edge: 'never' }), ref: 'bad' } as never, { op: 'link', type: 'about', from: 'bad', to: ids.subject } as never]);

  await setPack(l, human, { pack: 'automations', on: true });
  await assert.rejects(l.change(human, { reason: 'test', ops: [automation({ ...signups, edge: 'never' }) as never, ...ABOUT] }), /on.edge must be/, 'on again: checked');
  assert.deepEqual(await pass(l, 1), [], 'on again: the first pass only learns');
  assert.equal((await settings(l, 'due_on:%')).length, 1);
});

test('due_on: memory a map kept before the move is read where it was: nothing migrated, nothing fires again', async () => {
  const l = await map();
  const first = { ...signups, edge: 'first' };
  const each = { ...signups, query: { filter: { find: ['type signup'] }, limit: 50 }, edge: 'each' };
  const a = await make(l, [{ op: 'create', ref: 'a', type: 'signup', title: 'Ada' }]);
  const f = await make(l, [automation(first) as never, ...ABOUT]);
  const e = await make(l, [automation(each) as never, ...ABOUT]);
  // As the clock left them before the pack took its memory over: under due_on:<automation>, at an older position.
  const kept = [[f.auto, { on: JSON.stringify(first), pos: 1, done: true }], [e.auto, { on: JSON.stringify(each), pos: 1, seen: [a.a] }]] as const;
  for (const [id, memo] of kept) await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb)`, [`due_on:${id}`, JSON.stringify(memo)]);

  assert.deepEqual(await pass(l, 0), [], 'what was met stays met: no first again, no each for Ada');
  const b = await make(l, [{ op: 'create', ref: 'b', type: 'signup', title: 'Ben' }]);
  assert.deepEqual((await pass(l, 1)).map((m) => [m.item, m.edge, m.matched]), [[e.auto, 'each', [b.b]]], 'only what is new');
  const now = await settings(l, 'due_on:%');
  assert.deepEqual(now.map((r) => r.key), [`due_on:${f.auto}`, `due_on:${e.auto}`].sort());
  assert.ok(now.every((r) => (r.value as { pos: number }).pos > 1), 'kept up to date where it was');
  assert.equal((now.find((r) => r.key === `due_on:${f.auto}`)!.value as { done?: boolean }).done, true);
  assert.deepEqual(await settings(l, 'pack:%'), [], 'nothing under the pack prefix');
});
