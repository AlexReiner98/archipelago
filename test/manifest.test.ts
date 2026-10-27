// The pack manifest (Rule 8 of the target model): the shape a pack file has, the old keys read for one release, a
// server pack as a pack that asks for server reach, packs in space (requires, uses, and the reach a pack's code is
// kept to) and in time (a pack's presence a fact on the log, its registrations derived from the set of packs).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../src/db.ts';
import { entries } from '../src/log.ts';
import { LEGACY, MANIFEST_KEYS, parts, readManifest } from '../src/manifest.ts';
import { hostFor } from '../src/packtools.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { packsOff, setPack, syncPacks } from '../src/packstate.ts';
import { Archipelago } from '../src/pelago.ts';
import { decide } from '../src/rules.ts';
import { loadServerPacks, OWN_PACKS } from '../src/server-packs.ts';
import { callTool } from '../src/tools.ts';
import { syncTypes } from '../src/typetable.ts';
import { human } from './map.ts';

const ROOT = join(import.meta.dirname, '..');
const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

/** A copy of the packs, with more put beside them: a fixture's folder, or a pack file of its own. */
function packsWith(...more: (string | PackFile)[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-manifest-'));
  cpSync(join(ROOT, 'packs'), dir, { recursive: true });
  for (const m of more) {
    if (typeof m === 'string') cpSync(join(ROOT, 'test', 'packs', m), join(dir, m), { recursive: true });
    else (mkdirSync(join(dir, m.id)), writeFileSync(join(dir, m.id, 'pack.json'), JSON.stringify(m)));
  }
  return dir;
}

async function mapOf(dir: string) {
  const reg = new Registry(dir);
  registries.push(reg);
  const l = new Archipelago(await openDb(), reg);
  return (await syncTypes(l), l);
}

test('a manifest has its own keys and nothing else; the old keys are read for one release, then refused', () => {
  const now = readManifest(JSON.stringify({ id: 'x', version: '1', title: 'X', links: [], handlers: [{ event: 'repo.push' }], reach: { runs: ['get'] } }), 'x');
  assert.deepEqual(now.warnings, []);
  assert.throws(() => readManifest(JSON.stringify({ id: 'x', version: '1', title: 'X', colour: 'red' }), 'x'), /"colour" is not a key of a manifest/);
  assert.throws(() => readManifest(JSON.stringify({ id: 'x', version: '1', title: 'X', reach: { disk: true } }), 'x'), /"reach.disk" is not a key/);
  assert.throws(() => readManifest(JSON.stringify({ id: 'x', version: '1', title: 'X', handlers: [{ event: 'a.b', schedule: 'c' }] }), 'x'), /a handler runs on one of/);

  const old = {
    id: 'x', version: '1', title: 'X', contract: 1, tier: 'server',
    relations: [{ id: 'x.r' }], extend: { person: { fields: { rate: { type: 'number' } } } }, trees: [{ id: 'x.t' }], screens: [{ id: 'x.s' }], verbs: [{ id: 'capture' }],
    schedules: [{ id: 'tick', every_minutes: 5 }], hears: [{ event: 'repo.push' }], webhooks: [{ id: 'x.hook', secret: 's' }], events: ['x.heard'],
    hosts: [{ id: 'api', base: 'https://a.test' }], secrets: [{ name: 's' }], via: [{ pack: 'p', host: 'api' }], runs: ['get'],
    acts: ['mail.send'], entries: [{ id: 'e' }], pages: [{ id: 'p', file: 'p.html' }], connect: { status: 's', start: 't' }, aliases: { '/a': 'e' }, agreements: 'e',
  };
  assert.deepEqual(Object.keys(old).filter((k) => !['id', 'version', 'title'].includes(k)).sort(), Object.keys(LEGACY).sort(), 'every old key is tried here');
  const { manifest, warnings } = readManifest(JSON.stringify(old), 'x', '0.1.0');
  assert.equal(warnings.length, Object.keys(LEGACY).length, 'each old key is warned of');
  const p = parts(manifest);
  assert.deepEqual([p.relations.map((r) => r.id), Object.keys(p.adds), p.trees.map((t) => t.id), p.screens.map((s) => s.id), p.verbs.map((v) => v.id)], [['x.r'], ['person'], ['x.t'], ['x.s'], ['capture']]);
  assert.deepEqual([p.schedules, p.hears.map((h) => h.event), p.events], [[{ id: 'tick', every_minutes: 5, at_start: undefined, limit_ms: undefined }], ['repo.push'], ['x.heard']]);
  assert.deepEqual([p.hosts.length, p.secrets.length, p.webhooks.length, p.via.length, p.runs], [1, 1, 1, 1, ['get']]);
  assert.deepEqual(Object.keys(p.server!).sort(), ['acts', 'agreements', 'aliases', 'connect', 'entries', 'pages']);
  assert.ok(!('contract' in manifest), 'contract goes: nothing read it');
  assert.throws(() => readManifest(JSON.stringify(old), 'x', '0.2.0'), /keys of the shape before the manifest, refused since 0\.1\.0/);
});

test('every pack here is in the manifest shape, and reads as it did', () => {
  const reg = new Registry(join(ROOT, 'packs'));
  registries.push(reg);
  for (const p of reg.found) for (const key of Object.keys(p)) assert.ok((MANIFEST_KEYS as readonly string[]).includes(key), `${p.id}: ${key}`);
  assert.deepEqual(reg.verbs.map((v) => v.id), ['capture', 'assign', 'report', 'ask', 'settle', 'revise'], "core's verbs are actions marked kernel");
  assert.ok(reg.trees.has('software.roadmap'), 'a tree is a view of form tree');
  assert.ok(reg.type('company')!.fields.rate, 'time adds its fields to company as a types entry with of');
  const file = readFileSync(join(ROOT, 'packs', 'core', 'pack.json'), 'utf8');
  assert.equal(reg.hashes.get('core'), createHash('sha256').update(file).digest('hex'), 'the manifest is named by the hash of its file');
});

test('a server pack is a pack that asks for server reach: never a workspace pack, and read as the server’s', () => {
  const reg = new Registry(join(ROOT, 'packs'));
  registries.push(reg);
  assert.ok(!reg.found.some((p) => p.id === 'github_app'), "a workspace's registry leaves it out");
  const { packs } = loadServerPacks([OWN_PACKS]);
  assert.deepEqual(packs.map((p) => [p.file.id, Boolean(p.file.reach.server)]), [['github_app', true]]);
  assert.deepEqual(parts(packs[0].file).schedules.map((s) => s.id), ['refresh', 'recheck'], 'its schedules are handlers like any pack’s');
});

test('a pack waits while what it requires is missing, and what names a pack it uses registers only while that one is active', async () => {
  const tally: PackFile = {
    id: 'tally', version: '1', title: 'Tally', requires: ['core'], uses: ['time'],
    types: [{ id: 'tally.thing', title: 'Thing', description: 'A thing it counts.', extends: 'record' }, { of: 'time_entry', fields: { tally: { type: 'number' } } }],
    links: [{ id: 'tally.counts', extends: 'about', title: 'counts', inverse: 'is counted by', from: ['tally.thing'], to: ['time_entry'], description: 'What it counts.' }],
    views: [{ form: 'screen', id: 'tally.on_entry', title: 'Tally', on: ['time_entry'], pieces: [{ piece: 'note', text: 'Counted.' }] }],
  };
  const dir = packsWith(tally, { id: 'needy', version: '1', title: 'Needy', requires: ['core', 'nowhere'] });
  const reg = new Registry(dir);
  registries.push(reg);
  assert.deepEqual(reg.states.get('needy'), { state: 'waiting', why: 'needs nowhere, which is not on this server' });
  assert.ok(reg.relations.has('tally.counts') && reg.type('time_entry')!.fields.tally, 'with time active, what names it is registered');
  reg.turnOff(['time']);
  assert.equal(reg.states.get('tally')!.state, 'active', 'a pack it only uses is not one it waits for');
  assert.ok(reg.type('tally.thing'), 'its own type stays');
  assert.ok(!reg.relations.has('tally.counts'), 'a link type to a used pack’s type leaves with it');
  assert.ok(!reg.describe().screens.some((s) => s.id === 'tally.on_entry'), 'and a screen on its type');
  reg.turnOff([]);
  assert.ok(reg.relations.has('tally.counts'), 'and comes back with it');
});

test("a change a pack's action makes may touch only what the pack declares or requires", async () => {
  const l = await mapOf(packsWith('reacher'));
  const kept = (await callTool(l, human, 'reacher_keep', { title: 'Mine' })) as { status: string; changeset: string };
  assert.equal(kept.status, 'applied', 'its own type is inside its reach');
  const head = (await entries(l.db)).find((e) => e.id === kept.changeset)!;
  assert.deepEqual(head.pack, { id: 'reacher', manifest: l.registry.hashes.get('reacher'), action: 'reacher.keep' }, 'the entry names the pack, its manifest and the action');
  const task = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'task', title: 'Survey' }] })) as { created: Record<string, string> };
  await assert.rejects(callTool(l, human, 'reacher_rename', { id: task.created.t, title: 'Renamed' }), /The reacher pack touched "Survey", a task it neither declares nor requires/);
  assert.equal((await l.entity(task.created.t))!.title, 'Survey', 'refused whole');

  // A field another pack adds is that pack's: work requires core only, so time's rate on a company is outside it.
  const company = { op: 'create' as const, type: 'company', title: 'Acme', props: { rate: 120 } };
  assert.equal((await decide(l.db, l.registry, { human: true, pack: 'time' }, [company])).outcome, 'apply');
  assert.match((await decide(l.db, l.registry, { human: true, pack: 'work' }, [company])).refused.join(), /a company \(its field rate\)/);
  assert.equal((await decide(l.db, l.registry, { human: true }, [company])).outcome, 'apply', 'a change no pack makes is not under it');
});

test("adding and taking out a pack is a fact on the log; its registrations follow, and its items stay", async () => {
  const l = await mapOf(packsWith());
  const first = await syncPacks(l);
  assert.deepEqual(first.map((f) => f[1]).sort(), l.registry.found.map((p) => `pack:${p.id}`).sort(), 'every pack the server starts a workspace with is asserted when it opens');
  const time = first.find((f) => f[1] === 'pack:time')![3] as { version: string; manifest: string; text: string };
  assert.deepEqual([time.version, time.manifest, createHash('sha256').update(time.text).digest('hex')], ['0.1.0', l.registry.hashes.get('time'), l.registry.hashes.get('time')], 'the log keeps the manifest itself, the first time it meets it');
  assert.deepEqual(await syncPacks(l), [], 'and only once');
  const entry = await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'e', type: 'time_entry', title: 'Drafting', props: { date: '2026-10-16', hours: 3 } }] }) as { created: Record<string, string> };

  await setPack(l, human, { pack: 'time', on: false });
  const last = (await entries(l.db)).at(-1)!;
  assert.deepEqual([last.facts, last.actor.id, last.action], [[['-', 'pack:time', 'pack']], 'human:test', 'pack.off']);
  assert.deepEqual(await packsOff(l), ['time'], 'which packs are off is read from the log');
  assert.ok(l.registry.type('time_entry')!.dormant && !l.registry.tools.has('time_log'), 'what it registered unwinds');
  assert.equal((await l.entity(entry.created.e))!.title, 'Drafting', 'its items stay');
  assert.deepEqual(await syncPacks(l), [], 'a pack taken out stays out');

  await assert.rejects(setPack(l, human, { pack: 'work', on: false }), /require the work pack: take them out first/);
  await assert.rejects(setPack(l, human, { pack: 'core', on: false }), /the kernel's own/);
  await setPack(l, human, { pack: 'time', on: true });
  assert.ok(!l.registry.type('time_entry')!.dormant && l.registry.tools.has('time_log'), 'and adding it back brings it all back');
  assert.deepEqual((await entries(l.db)).at(-1)!.facts, [['+', 'pack:time', 'pack', { version: '0.1.0', manifest: l.registry.hashes.get('time') }]], 'a manifest the log keeps already is named, not kept again');

  l.registry.hashes.set('time', 'f'.repeat(64));
  assert.deepEqual(await syncPacks(l), [['+', 'pack:time', 'pack', { version: '0.1.0', manifest: 'f'.repeat(64) }]], 'a manifest that changed on the server is asserted again');
});

test('a new workspace starts with the kernel alone, and a pack the log never added waits for the owner', async () => {
  const was = process.env.PELAGO_START_PACKS;
  delete process.env.PELAGO_START_PACKS;
  try {
    const l = await mapOf(packsWith());
    assert.deepEqual((await syncPacks(l)).map((f) => f[1]), ['pack:core'], 'only the kernel is asserted');
    assert.deepEqual((await packsOff(l)).sort(), l.registry.found.map((p) => p.id).filter((p) => p !== 'core').sort(), 'every other pack is off');
    assert.deepEqual(await syncPacks(l), [], 'and opening it again adds none');
    await setPack(l, human, { pack: 'work', on: true });
    assert.ok(!(await packsOff(l)).includes('work') && (await packsOff(l)).includes('time'), 'the owner adds one');

    // A workspace made before packs were facts holds items: it is said to have every pack it had.
    const old = await mapOf(packsWith());
    await old.change(human, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Made long ago' }] });
    assert.equal((await syncPacks(old)).length, old.registry.found.length);
  } finally {
    if (was === undefined) delete process.env.PELAGO_START_PACKS;
    else process.env.PELAGO_START_PACKS = was;
  }
});
