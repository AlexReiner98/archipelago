// The pack manifest (Rule 8 of the target model): the shape a pack file has, the old keys read for one release, a
// server pack as a pack that asks for server reach, packs in space (requires, uses, and the reach a pack's code is
// kept to) and in time (a pack's presence a fact on the log, its registrations derived from the set of packs).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../src/db.ts';
import { entries } from '../src/log.ts';
import { LEGACY, MANIFEST_KEYS, parts, readManifest } from '../src/manifest.ts';
import { hostFor } from '../src/packtools.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { splitFromKernel } from '../src/packorder.ts';
import { packsOff, setPack, syncPacks } from '../src/packstate.ts';
import { Archipelago } from '../src/pelago.ts';
import { decide } from '../src/rules.ts';
import { loadServerPacks, OWN_PACKS } from '../src/server-packs.ts';
import { callTool } from '../src/tools.ts';
import { syncTypes } from '../src/typetable.ts';
import { human, packsWith } from './map.ts';

const ROOT = join(import.meta.dirname, '..');
const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

/** A pack that keeps hours and adds an hourly rate to a company, and one that requires it. */
const CLOCK: PackFile = {
  id: 'clock', version: '0.1.0', title: 'Clock', requires: ['core'],
  types: [{ id: 'clock.entry', title: 'Entry', description: 'Hours kept.', extends: 'record', fields: { hours: { type: 'number' } } }, { of: 'company', fields: { hourly: { type: 'number' } } }],
};
const LEANS: PackFile = { id: 'leans', version: '0.1.0', title: 'Leans', requires: ['core', 'clock'] };

/** A copy of the packs, with more put beside them: a fixture's folder, or a pack file of its own. */
async function mapOf(dir: string) {
  const reg = new Registry(dir);
  registries.push(reg);
  const l = new Archipelago(await openDb(), reg);
  return (await syncTypes(l), l);
}

test('a manifest has its own keys and nothing else; the old keys are refused, each with where it went', () => {
  const now = readManifest(JSON.stringify({ id: 'x', version: '1', title: 'X', links: [], handlers: [{ event: 'repo.push' }], reach: { via: [{ pack: 'p', host: 'api' }] } }), 'x');
  assert.deepEqual(now.links, []);
  assert.throws(() => readManifest(JSON.stringify({ id: 'x', version: '1', title: 'X', colour: 'red' }), 'x'), /"colour" is not a key of a manifest/);
  assert.throws(() => readManifest(JSON.stringify({ id: 'x', version: '1', title: 'X', reach: { disk: true } }), 'x'), /"reach.disk" is not a key/);
  assert.throws(() => readManifest(JSON.stringify({ id: 'x', version: '1', title: 'X', handlers: [{ event: 'a.b', schedule: 'c' }] }), 'x'), /a handler runs on one of/);
  for (const key of Object.keys(LEGACY))
    assert.throws(() => readManifest(JSON.stringify({ id: 'x', version: '1', title: 'X', [key]: [] }), 'x'), new RegExp(`keys of the shape before the manifest, refused since 0\.1\.0: ${key} is `));
});

test('every pack here is in the manifest shape, and reads as it did', () => {
  const added = new Registry(packsWith(CLOCK));
  registries.push(added);
  assert.ok(added.type('company')!.fields.hourly, 'a pack adds its fields to company as a types entry with of');
  const reg = new Registry(join(ROOT, 'packs'));
  registries.push(reg);
  for (const p of reg.found) for (const key of Object.keys(p)) assert.ok((MANIFEST_KEYS as readonly string[]).includes(key), `${p.id}: ${key}`);
  assert.deepEqual(reg.verbs.map((v) => v.id), ['capture', 'assign', 'report', 'ask', 'settle', 'revise'], "core's verbs are actions marked kernel");
  const file = readFileSync(join(ROOT, 'packs', 'core', 'pack.json'), 'utf8');
  assert.equal(reg.hashes.get('core'), createHash('sha256').update(file).digest('hex'), 'the manifest is named by the hash of its file');
});

test('a server pack is a pack that asks for server reach: never a workspace pack, and read as the server’s', () => {
  const dir = packsWith({ id: 'hub', version: '1', title: 'Hub', reach: { server: {} } } as unknown as PackFile);
  const reg = new Registry(dir);
  registries.push(reg);
  assert.ok(!reg.found.some((p) => p.id === 'hub'), "a workspace's registry leaves it out");
  assert.deepEqual(loadServerPacks([dir]).packs.map((p) => [p.file.id, Boolean(p.file.reach.server)]), [['claude_code', true], ['hub', true], ['reader', true]]);
  assert.deepEqual(loadServerPacks([OWN_PACKS]).packs.map((p) => p.file.id), ['claude_code', 'reader'], 'the kernel ships two of its own, the Claude Code adapter and the reader');
});

test('a pack waits while what it requires is missing, and what names a pack it uses registers only while that one is active', async () => {
  const tally: PackFile = {
    id: 'tally', version: '1', title: 'Tally', requires: ['core'], uses: ['clock'],
    types: [{ id: 'tally.thing', title: 'Thing', description: 'A thing it counts.', extends: 'record' }, { of: 'clock.entry', fields: { tally: { type: 'number' } } }],
    links: [{ id: 'tally.counts', extends: 'about', title: 'counts', inverse: 'is counted by', from: ['tally.thing'], to: ['clock.entry'], description: 'What it counts.' }],
    views: [{ form: 'screen', id: 'tally.on_entry', title: 'Tally', on: ['clock.entry'], pieces: [{ piece: 'note', text: 'Counted.' }] }],
  };
  const dir = packsWith(CLOCK, tally, { id: 'needy', version: '1', title: 'Needy', requires: ['core', 'nowhere'] });
  const reg = new Registry(dir);
  registries.push(reg);
  assert.deepEqual(reg.states.get('needy'), { state: 'waiting', why: 'needs nowhere, which is not on this server' });
  assert.ok(reg.relations.has('tally.counts') && reg.type('clock.entry')!.fields.tally, 'with clock active, what names it is registered');
  reg.turnOff(['clock']);
  assert.equal(reg.states.get('tally')!.state, 'active', 'a pack it only uses is not one it waits for');
  assert.ok(reg.type('tally.thing'), 'its own type stays');
  assert.ok(!reg.relations.has('tally.counts'), 'a link type to a used pack’s type leaves with it');
  assert.ok(!reg.describe().screens.some((s) => s.id === 'tally.on_entry'), 'and a screen on its type');
  reg.turnOff([]);
  assert.ok(reg.relations.has('tally.counts'), 'and comes back with it');
});

test("a change a pack's action makes may touch only what the pack declares or requires", async () => {
  const l = await mapOf(packsWith('reacher', CLOCK));
  const kept = (await callTool(l, human, 'reacher_keep', { title: 'Mine' })) as { status: string; changeset: string };
  assert.equal(kept.status, 'applied', 'its own type is inside its reach');
  const head = (await entries(l.db)).find((e) => e.id === kept.changeset)!;
  assert.deepEqual(head.pack, { id: 'reacher', manifest: l.registry.hashes.get('reacher'), action: 'reacher.keep' }, 'the entry names the pack, its manifest and the action');
  const task = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'clock.entry', title: 'Survey' }] })) as { created: Record<string, string> };
  await assert.rejects(callTool(l, human, 'reacher_rename', { id: task.created.t, title: 'Renamed' }), /The reacher pack touched "Survey", a clock.entry it neither declares nor requires/);
  assert.equal((await l.entity(task.created.t))!.title, 'Survey', 'refused whole');

  // A field another pack adds is that pack's: reacher requires core only, so clock's hourly on a company is outside it.
  const company = { op: 'create' as const, type: 'company', title: 'Acme', props: { hourly: 120 } };
  assert.equal((await decide(l.db, l.registry, { human: true, pack: 'clock' }, [company])).outcome, 'apply');
  assert.match((await decide(l.db, l.registry, { human: true, pack: 'reacher' }, [company])).refused.join(), /a company \(its field hourly\)/);
  assert.equal((await decide(l.db, l.registry, { human: true }, [company])).outcome, 'apply', 'a change no pack makes is not under it');
});

test("adding and taking out a pack is a fact on the log; its registrations follow, and its items stay", async () => {
  const l = await mapOf(packsWith(CLOCK, LEANS, 'reacher'));
  const first = await syncPacks(l);
  assert.deepEqual(first.map((f) => f[1]).sort(), l.registry.found.map((p) => `pack:${p.id}`).sort(), 'every pack the server starts a workspace with is asserted when it opens');
  const reacher = first.find((f) => f[1] === 'pack:reacher')![3] as { version: string; manifest: string; text: string; code: string; files: Record<string, string>; texts: Record<string, string> };
  // Its code is named by its files' hashes beside it, their texts kept the first time too (src/pack-code.ts).
  const code = { code: reacher.code, files: reacher.files };
  assert.deepEqual(Object.keys(reacher.texts).sort(), [...new Set(Object.values(reacher.files))].sort(), 'and its code, file by file');
  assert.deepEqual([reacher.version, reacher.manifest, createHash('sha256').update(reacher.text).digest('hex')], ['0.1.0', l.registry.hashes.get('reacher'), l.registry.hashes.get('reacher')], 'the log keeps the manifest itself, the first time it meets it');
  assert.deepEqual(await syncPacks(l), [], 'and only once');
  const note = await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'e', type: 'reacher.note', title: 'Drafting' }] }) as { created: Record<string, string> };

  await setPack(l, human, { pack: 'reacher', on: false });
  const last = (await entries(l.db)).at(-1)!;
  assert.deepEqual([last.facts, last.actor.id, last.action], [[['-', 'pack:reacher', 'pack']], 'human:test', 'pack.off']);
  assert.deepEqual(await packsOff(l), ['reacher'], 'which packs are off is read from the log');
  assert.ok(l.registry.type('reacher.note')!.dormant && !l.registry.tools.has('reacher_keep'), 'what it registered unwinds');
  assert.equal((await l.entity(note.created.e))!.title, 'Drafting', 'its items stay');
  assert.deepEqual(await syncPacks(l), [], 'a pack taken out stays out');

  const out = await setPack(l, human, { pack: 'clock', on: false });
  assert.deepEqual(out.waiting, [{ id: 'leans', why: 'needs clock, which is off' }], 'what requires it waits instead of refusing');
  assert.deepEqual((await setPack(l, human, { pack: 'clock', on: true })).woken, ['leans']);
  await assert.rejects(setPack(l, human, { pack: 'core', on: false }), /the kernel's own/);
  await setPack(l, human, { pack: 'reacher', on: true });
  assert.ok(!l.registry.type('reacher.note')!.dormant && l.registry.tools.has('reacher_keep'), 'and adding it back brings it all back');
  assert.deepEqual((await entries(l.db)).at(-1)!.facts, [['+', 'pack:reacher', 'pack', { version: '0.1.0', manifest: l.registry.hashes.get('reacher'), ...code }]], 'a manifest and code the log keeps already are named, not kept again');

  l.registry.hashes.set('reacher', 'f'.repeat(64));
  assert.deepEqual(await syncPacks(l), [['+', 'pack:reacher', 'pack', { version: '0.1.0', manifest: 'f'.repeat(64), ...code }]], 'a manifest that changed on the server is asserted again');
});

test('a pack renamed takes the place of the one the owner added: inquiry is grove now', async () => {
  // A map that had the inquiry pack: the grove pack as it was, under its old name and without its newest type.
  const guess = { id: 'guess', title: 'Guess', description: 'A guess to try.', extends: 'record' } as const;
  const old = await mapOf(packsWith({ id: 'inquiry', version: '0.1.0', title: 'Inquiry', requires: ['core'], types: [guess] }));
  await syncPacks(old);
  await syncTypes(old);
  const h = (await old.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'h', type: 'guess', title: 'Replay is fast' }] })) as { created: Record<string, string> };

  const reg = new Registry(packsWith({ id: 'grove', version: '0.2.0', title: 'Grove', requires: ['core'], types: [guess, { id: 'hunch', title: 'Hunch', description: 'A guess not yet put.', extends: 'record' }] }));
  registries.push(reg);
  const now = new Archipelago(old.db, reg);
  const facts = await syncPacks(now);
  assert.deepEqual(facts.filter((f) => /inquiry|grove/.test(f[1])).map((f) => [f[0], f[1]]), [['+', 'pack:grove'], ['-', 'pack:inquiry']]);
  assert.ok(!(await packsOff(now)).includes('grove'), 'on, as inquiry was');
  now.registry.turnOff(await packsOff(now));
  await syncTypes(now);
  assert.ok(!now.registry.type('guess')!.dormant && now.registry.type('hunch'), 'its types live, and the new ones with them');
  assert.equal((await now.entity(h.created.h))!.type, 'guess');
  assert.deepEqual(await syncPacks(now), [], 'once');
});

test('a pack that took over words a pack the owner added held is added with them: hub’s sprout is stem’s now', async () => {
  // A map that had the hub pack while it still declared sprout and probe, before stem and leaf held them.
  const sprout = { id: 'sprout', title: 'Sprout', description: 'A piece of work.', extends: 'work' } as const;
  const probe = { id: 'probe', title: 'Probe', description: 'A check kept.', extends: 'record' } as const;
  const hub = (types: PackFile['types']): PackFile => ({ id: 'hub', version: '0.0.1', title: 'Hub', requires: ['core'], types });
  const old = await mapOf(packsWith(hub([sprout, probe])));
  await syncPacks(old);
  await syncTypes(old);
  assert.ok(!(await packsOff(old)).includes('hub'), 'the owner has hub');
  const f = (await old.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'f', type: 'sprout', title: 'Sun study', status: 'doing' }] })) as { created: Record<string, string> };

  const reg = new Registry(packsWith(hub([]), { id: 'stem', version: '0.1.0', title: 'Stem', requires: ['core'], types: [sprout] }, { id: 'leaf', version: '0.1.0', title: 'Leaf', requires: ['core'], types: [probe] }, { id: 'other', version: '0.1.0', title: 'Other', requires: ['core'] }));
  registries.push(reg);
  const now = new Archipelago(old.db, reg);
  const added = (await syncPacks(now)).filter((x) => x[0] === '+' && /pack:(stem|leaf|other)$/.test(x[1])).map((x) => x[1]).sort();
  assert.deepEqual(added, ['pack:leaf', 'pack:stem'], 'the packs that hold its words now, and no other new one');
  now.registry.turnOff(await packsOff(now));
  await syncTypes(now);
  assert.equal(now.registry.type('sprout')?.pack, 'stem');
  assert.equal(now.registry.states.get('hub')?.state, 'active', 'hub runs over them, as before');
  assert.deepEqual([(await now.entity(f.created.f))!.type, (await now.entity(f.created.f))!.status], ['sprout', 'doing']);
  assert.deepEqual((await syncPacks(now)).filter((x) => /pack:(stem|leaf)$/.test(x[1])), [], 'once');
});

test('a new workspace starts with the kernel alone, and a pack the log never added waits for the owner', async () => {
  const was = process.env.PELAGO_START_PACKS;
  delete process.env.PELAGO_START_PACKS;
  try {
    const l = await mapOf(packsWith(CLOCK, 'reacher'));
    // The kernel, and the packs split out of it (they keep its names: every map had what they hold).
    const kernel = l.registry.found.filter((p) => p.id === 'core' || splitFromKernel(p)).map((p) => p.id);
    assert.deepEqual((await syncPacks(l)).map((f) => f[1]).sort(), kernel.map((p) => `pack:${p}`).sort(), 'only the kernel is asserted');
    assert.deepEqual((await packsOff(l)).sort(), l.registry.found.map((p) => p.id).filter((p) => !kernel.includes(p)).sort(), 'every other pack is off');
    assert.deepEqual(await syncPacks(l), [], 'and opening it again adds none');
    await setPack(l, human, { pack: 'clock', on: true });
    assert.ok(!(await packsOff(l)).includes('clock') && (await packsOff(l)).includes('reacher'), 'the owner adds one');

    // A workspace made before packs were facts holds items: it is said to have every pack it had.
    const old = await mapOf(packsWith());
    await old.change(human, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Made long ago' }] });
    assert.equal((await syncPacks(old)).length, old.registry.found.length);
  } finally {
    if (was === undefined) delete process.env.PELAGO_START_PACKS;
    else process.env.PELAGO_START_PACKS = was;
  }
});
